//! Read/validate foundations only; no new write or model bypass.
use crate::{
    domain::{
        document::{DocumentSnapshot, DocumentTarget, SelectionSnapshot},
        result::{ResultType, TextResultFormat},
    },
    error::AppError,
    parser::hash,
    repository,
    storage::Storage,
    workspace,
};
use std::{ops::Range, path::Path};

fn validate_id(id: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput("Invalid document target ID".into()))
}

pub fn snapshot(
    storage: &Storage,
    managed_results_dir: &Path,
    target: &DocumentTarget,
) -> Result<DocumentSnapshot, AppError> {
    match target {
        DocumentTarget::WorkspaceFile {
            workspace_id,
            source_id,
        } => {
            validate_id(workspace_id)?;
            validate_id(source_id)?;
            let key = repository::document::workspace_target(storage, workspace_id, source_id)?;
            // Authorization is resolved before disk access; the existing workspace
            // reader retains path guards, read-only extraction and draft semantics.
            let document = workspace::read_file(storage, workspace_id, &key)?;
            Ok(DocumentSnapshot {
                target: target.clone(),
                revision_id: None,
                content_hash: document.content_hash,
                format: document.language,
                text: document.content,
                editable: document.editable,
                has_unsaved_draft: document.draft.is_some(),
            })
        }
        DocumentTarget::Result { result_id } => {
            validate_id(result_id)?;
            let document = super::result::read_document(storage, managed_results_dir, result_id)?;
            let format = match document.format {
                TextResultFormat::Markdown => "markdown",
                TextResultFormat::PlainText => "text",
                TextResultFormat::Csv => "csv",
                TextResultFormat::Json => "json",
            };
            Ok(DocumentSnapshot {
                target: target.clone(),
                revision_id: document.result.summary.current_revision_id,
                content_hash: document.content_hash,
                format: format.into(),
                text: document.content,
                editable: document.editable
                    && document.result.summary.result_type == ResultType::Document
                    && matches!(
                        document.format,
                        TextResultFormat::Markdown | TextResultFormat::PlainText
                    ),
                has_unsaved_draft: document.recovery_draft.is_some(),
            })
        }
    }
}

/// Convert JS UTF-16 offsets without slicing through a surrogate pair. Byte
/// boundaries also preserve the original CRLF sequence and combining characters.
pub fn utf16_range(text: &str, start: usize, end: usize) -> Result<Range<usize>, AppError> {
    if start >= end {
        return Err(AppError::InvalidInput(
            "Selection must not be empty or reversed".into(),
        ));
    }
    let mut units = 0;
    let mut first = None;
    let mut last = None;
    for (byte, ch) in text.char_indices() {
        if units == start {
            first = Some(byte);
        }
        if units == end {
            last = Some(byte);
        }
        units += ch.len_utf16();
    }
    if units == end {
        last = Some(text.len());
    }
    match (first, last) {
        (Some(first), Some(last)) => Ok(first..last),
        _ => Err(AppError::InvalidInput(
            "Selection offsets are outside the text or split a surrogate pair".into(),
        )),
    }
}

pub fn validate_selection(
    storage: &Storage,
    managed_results_dir: &Path,
    selection: &SelectionSnapshot,
) -> Result<DocumentSnapshot, AppError> {
    let current = snapshot(storage, managed_results_dir, &selection.target)?;
    if !current.editable || current.has_unsaved_draft {
        return Err(AppError::InvalidInput(
            "Save an editable text document before selecting a write target".into(),
        ));
    }
    if current.content_hash != selection.content_hash
        || current.revision_id != selection.revision_id
    {
        return Err(AppError::FileConflict);
    }
    let range = utf16_range(&current.text, selection.start, selection.end)?;
    if hash(current.text[range].as_bytes()) != selection.selected_text_hash {
        return Err(AppError::FileConflict);
    }
    Ok(current)
}
