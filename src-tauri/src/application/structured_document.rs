use crate::{
    domain::{
        document::{DocumentTarget, SelectionSnapshot},
        structured_document::*,
    },
    error::AppError,
    parser::{hash, OffsetUnit},
    repository::structured_document as repository,
    storage::Storage,
};
use std::path::Path;

pub fn inspect(
    storage: &Storage,
    root: &Path,
    target: &DocumentTarget,
) -> Result<StructuredView, AppError> {
    let snapshot = super::document::snapshot(storage, root, target)?;
    if !snapshot.editable || snapshot.format != "markdown" {
        return Err(AppError::InvalidInput(
            "结构化编辑支持 Markdown 文档；PDF/Word 原件保持只读，请先导入副本".into(),
        ));
    }
    let document =
        if let Some(cached) = repository::find(storage, target, Some(&snapshot.content_hash))? {
            cached
        } else {
            let previous = repository::find(storage, target, None)?;
            let parsed = super::structured_markdown::parse(&snapshot.text, previous.as_ref())?;
            repository::put(storage, target, &snapshot.content_hash, &parsed)?;
            parsed
        };
    let warnings = if document
        .blocks
        .iter()
        .any(|b| matches!(b.node, Node::Unsupported { .. }))
    {
        vec!["部分 Markdown 语法以原文保留；复杂样式导出可能降级。".into()]
    } else {
        Vec::new()
    };
    Ok(StructuredView {
        snapshot,
        document,
        warnings,
    })
}

pub fn propose(
    storage: &Storage,
    root: &Path,
    patch: StructuredPatch,
) -> Result<crate::domain::review::ReviewRequest, AppError> {
    if patch.schema_version != 2 {
        return Err(AppError::InvalidInput("不支持的结构化修改协议".into()));
    }
    let current = inspect(storage, root, &patch.target)?;
    if current.snapshot.has_unsaved_draft
        || current.snapshot.content_hash != patch.base_hash
        || current.snapshot.revision_id != patch.base_revision_id
    {
        return Err(AppError::FileConflict);
    }
    let candidate = super::structured_markdown::patch(&current.document, &patch.operations)?;
    propose_document(storage, root, &current, &candidate)
}

pub fn propose_import(
    storage: &Storage,
    root: &Path,
    target: &DocumentTarget,
    base_hash: &str,
    revision: &Option<String>,
    markdown: &str,
) -> Result<crate::domain::review::ReviewRequest, AppError> {
    let current = inspect(storage, root, target)?;
    if current.snapshot.has_unsaved_draft
        || current.snapshot.content_hash != base_hash
        || &current.snapshot.revision_id != revision
    {
        return Err(AppError::FileConflict);
    }
    let document = super::structured_markdown::parse(markdown, None)?;
    propose_document(storage, root, &current, &document)
}

fn propose_document(
    storage: &Storage,
    root: &Path,
    current: &StructuredView,
    candidate: &StructuredDocument,
) -> Result<crate::domain::review::ReviewRequest, AppError> {
    let source = super::structured_markdown::render(candidate);
    let selection = SelectionSnapshot {
        target: current.snapshot.target.clone(),
        revision_id: current.snapshot.revision_id.clone(),
        content_hash: current.snapshot.content_hash.clone(),
        start: 0,
        end: current.snapshot.text.encode_utf16().count(),
        offset_unit: OffsetUnit::Utf16,
        selected_text_hash: hash(current.snapshot.text.as_bytes()),
    };
    // The existing Review pipeline owns acceptance, stale checks, write and Revision.
    let review = super::review::create_structured_replacement(
        storage,
        root,
        &current.snapshot,
        &selection,
        &source,
    )?;
    repository::put(
        storage,
        &current.snapshot.target,
        &hash(source.as_bytes()),
        candidate,
    )?;
    Ok(review)
}
