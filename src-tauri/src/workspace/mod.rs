mod path_guard;

pub use path_guard::{
    canonicalize_root, is_supported_document_path, is_supported_text_path,
    is_supported_workspace_path, resolve_existing_file,
};

use crate::error::AppError;
use crate::storage::{
    DocumentVersionMetadata, DocumentVersionRecord, DraftRow, Storage, WorkspaceFileRow,
    WorkspaceRow,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};

pub const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_DOCUMENT_FILE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_WORKSPACE_FILES: usize = 20_000;
const MAX_WALK_DEPTH: usize = 32;
const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".next",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "secrets",
    "target",
    "venv",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileEntry {
    pub path: String,
    pub name: String,
    pub language: String,
    pub size_bytes: u64,
    pub readable: bool,
    pub editable: bool,
    pub extracted: bool,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftDocument {
    pub content: String,
    pub base_hash: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftSummary {
    pub relative_path: String,
    pub base_hash: String,
    pub updated_at: String,
    pub current_hash: Option<String>,
    pub conflict: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    pub path: String,
    pub name: String,
    pub language: String,
    pub content: String,
    pub content_hash: String,
    pub size_bytes: u64,
    pub draft: Option<DraftDocument>,
    pub editable: bool,
    pub extracted: bool,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub path: String,
    pub content_hash: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersionSummary {
    pub id: String,
    pub relative_path: String,
    pub content_hash: String,
    pub source: String,
    pub summary: Option<String>,
    pub version_kind: String,
    pub created_at: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersion {
    #[serde(flatten)]
    pub summary: DocumentVersionSummary,
    pub content: String,
}

pub fn register_workspace(
    storage: &Storage,
    selected_path: &Path,
) -> Result<WorkspaceSummary, AppError> {
    let root = canonicalize_root(selected_path)?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Workspace");
    let root_path = root.to_string_lossy().into_owned();
    let row = storage.upsert_workspace(&Uuid::new_v4().to_string(), name, &root_path)?;
    Ok(summary_from_row(&row))
}

pub fn register_standalone_workspace(storage: &Storage) -> Result<WorkspaceSummary, AppError> {
    let id = Uuid::new_v4().to_string();
    let row = storage.create_standalone_workspace(&id, "独立文件")?;
    Ok(summary_from_row(&row))
}

pub fn list_recent(storage: &Storage) -> Result<Vec<WorkspaceSummary>, AppError> {
    Ok(storage
        .recent_workspaces(10)?
        .iter()
        .map(summary_from_row)
        .collect())
}

pub fn restore_workspace(
    storage: &Storage,
    workspace_id: &str,
) -> Result<WorkspaceSummary, AppError> {
    let row = require_workspace(storage, workspace_id)?;
    if row.kind == "directory" {
        canonicalize_root(Path::new(&row.root_path))?;
    }
    storage.touch_workspace(workspace_id)?;
    Ok(summary_from_row(&row))
}

pub fn list_files(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<WorkspaceFileEntry>, AppError> {
    let workspace = require_workspace(storage, workspace_id)?;
    let mut files = Vec::new();
    if workspace.kind == "directory" {
        let root = canonicalize_root(Path::new(&workspace.root_path))?;
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .max_depth(MAX_WALK_DEPTH)
            .into_iter()
            .filter_entry(should_visit)
        {
            let entry = entry
                .map_err(|_| AppError::InvalidInput("工作区包含无法遍历的目录或文件".into()))?;
            if !entry.file_type().is_file() || !is_supported_workspace_path(entry.path()) {
                continue;
            }
            let metadata = fs::metadata(entry.path())?;
            let relative = relative_path(&root, entry.path())?;
            let extracted = is_supported_document_path(entry.path());
            let size_limit = if extracted {
                MAX_DOCUMENT_FILE_BYTES
            } else {
                MAX_TEXT_FILE_BYTES
            };
            files.push(WorkspaceFileEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                language: language_for_path(entry.path()).to_string(),
                path: relative,
                size_bytes: metadata.len(),
                readable: metadata.len() <= size_limit,
                editable: !extracted,
                extracted,
                source_id: None,
            });
            if files.len() >= MAX_WORKSPACE_FILES {
                return Err(AppError::InvalidInput(
                    "工作区文本文件数量超过 20000 个安全上限".into(),
                ));
            }
        }
    }
    for selected in storage.workspace_files(workspace_id)? {
        files.push(selected_file_entry(&selected));
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    storage.touch_workspace(workspace_id)?;
    Ok(files)
}

pub fn read_file(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
) -> Result<WorkspaceDocument, AppError> {
    if let Some(selected) = storage.workspace_file(workspace_id, relative_path)? {
        let mut document =
            read_selected_file(Path::new(&selected.absolute_path), &selected.source_id)?;
        document.path = selected.virtual_path;
        document.draft = if document.editable {
            reconciled_draft(storage, workspace_id, relative_path, &document.content_hash)?
        } else {
            None
        };
        return Ok(document);
    }
    let root = workspace_root(storage, workspace_id)?;
    let path = resolve_existing_file(&root, Path::new(relative_path))?;
    let extracted = is_supported_document_path(&path);
    let bytes = read_limited(
        &path,
        if extracted {
            MAX_DOCUMENT_FILE_BYTES
        } else {
            MAX_TEXT_FILE_BYTES
        },
    )?;
    let size_bytes = bytes.len() as u64;
    let content_hash = content_hash(&bytes);
    let content = if extracted {
        extract_document_text(&path, &bytes)?
    } else {
        String::from_utf8(bytes).map_err(|_| AppError::InvalidEncoding)?
    };
    validate_content_size(&content)?;
    let draft = if extracted {
        None
    } else {
        reconciled_draft(storage, workspace_id, relative_path, &content_hash)?
    };
    Ok(WorkspaceDocument {
        path: relative_path.to_string(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(relative_path)
            .to_string(),
        language: language_for_path(&path).to_string(),
        content,
        content_hash,
        size_bytes,
        draft,
        editable: !extracted,
        extracted,
        source_id: None,
    })
}

pub fn read_selected_file(path: &Path, source_id: &str) -> Result<WorkspaceDocument, AppError> {
    let path = path.canonicalize()?;
    if !path.is_file() || !is_supported_workspace_path(&path) {
        return Err(AppError::InvalidInput(
            "The selected file type is not supported".into(),
        ));
    }
    let extracted = is_supported_document_path(&path);
    let bytes = read_limited(
        &path,
        if extracted {
            MAX_DOCUMENT_FILE_BYTES
        } else {
            MAX_TEXT_FILE_BYTES
        },
    )?;
    let size_bytes = bytes.len() as u64;
    let content_hash = content_hash(&bytes);
    let content = if extracted {
        extract_document_text(&path, &bytes)?
    } else {
        String::from_utf8(bytes).map_err(|_| AppError::InvalidEncoding)?
    };
    validate_content_size(&content)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("selected-file")
        .to_string();
    Ok(WorkspaceDocument {
        path: format!("selected/{source_id}/{name}"),
        name,
        language: language_for_path(&path).to_string(),
        content,
        content_hash,
        size_bytes,
        draft: None,
        editable: !extracted,
        extracted,
        source_id: Some(source_id.to_string()),
    })
}

pub fn attach_selected_file(
    storage: &Storage,
    workspace_id: &str,
    path: &Path,
) -> Result<WorkspaceDocument, AppError> {
    require_workspace(storage, workspace_id)?;
    let canonical = path.canonicalize()?;
    let proposed_source_id = Uuid::new_v4().to_string();
    let proposed = read_selected_file(&canonical, &proposed_source_id)?;
    let row = storage.attach_workspace_file(
        workspace_id,
        &proposed_source_id,
        canonical.to_string_lossy().as_ref(),
        &proposed.path,
    )?;
    let mut document = if row.source_id == proposed_source_id {
        proposed
    } else {
        read_selected_file(&canonical, &row.source_id)?
    };
    document.path = row.virtual_path;
    storage.touch_workspace(workspace_id)?;
    Ok(document)
}

pub fn save_selected_file(
    path: &Path,
    content: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    let path = path.canonicalize()?;
    ensure_editable_path(path.to_string_lossy().as_ref())?;
    validate_content_size(content)?;
    let current = read_limited(&path, MAX_TEXT_FILE_BYTES)?;
    if content_hash(&current) != base_hash {
        return Err(AppError::FileConflict);
    }
    fs::write(&path, content.as_bytes())?;
    Ok(SaveOutcome {
        path: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("selected-file")
            .to_string(),
        content_hash: content_hash(content.as_bytes()),
        size_bytes: content.len() as u64,
    })
}

pub fn save_file(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    ensure_editable_path(relative_path)?;
    validate_content_size(content)?;
    if let Some(selected) = storage.workspace_file(workspace_id, relative_path)? {
        let mut outcome =
            save_selected_file(Path::new(&selected.absolute_path), content, base_hash)?;
        outcome.path = relative_path.to_string();
        storage.delete_draft(workspace_id, relative_path)?;
        storage.touch_workspace(workspace_id)?;
        return Ok(outcome);
    }
    let root = workspace_root(storage, workspace_id)?;
    let path = resolve_existing_file(&root, Path::new(relative_path))?;
    let current = read_limited(&path, MAX_TEXT_FILE_BYTES)?;
    if content_hash(&current) != base_hash {
        return Err(AppError::FileConflict);
    }
    fs::write(&path, content.as_bytes())?;
    let new_hash = content_hash(content.as_bytes());
    storage.delete_draft(workspace_id, relative_path)?;
    storage.touch_workspace(workspace_id)?;
    Ok(SaveOutcome {
        path: relative_path.to_string(),
        content_hash: new_hash,
        size_bytes: content.len() as u64,
    })
}

pub fn save_file_with_history(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    let before = read_file(storage, workspace_id, relative_path)?;
    if before.content_hash != base_hash {
        return Err(AppError::FileConflict);
    }
    let outcome = save_file(storage, workspace_id, relative_path, content, base_hash)?;
    if outcome.content_hash == before.content_hash {
        return Ok(outcome);
    }
    if let Err(error) = storage.record_file_save_versions(
        workspace_id,
        relative_path,
        &before.content,
        &before.content_hash,
        content,
        &outcome.content_hash,
        "autosave",
        "自动保存",
    ) {
        let _ = save_file(
            storage,
            workspace_id,
            relative_path,
            &before.content,
            &outcome.content_hash,
        );
        let _ = storage.save_draft(workspace_id, relative_path, content, &before.content_hash);
        return Err(error);
    }
    let _ = storage.cleanup_expired_versions();
    Ok(outcome)
}

pub fn list_document_versions(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
) -> Result<Vec<DocumentVersionSummary>, AppError> {
    let current = read_file(storage, workspace_id, relative_path)?;
    Ok(storage
        .document_versions(workspace_id, relative_path, 200)?
        .into_iter()
        .map(|version| version_summary(version, &current.content_hash))
        .collect())
}

pub fn read_document_version(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    version_id: &str,
) -> Result<DocumentVersion, AppError> {
    Uuid::parse_str(version_id).map_err(|_| AppError::InvalidInput("版本标识无效".into()))?;
    let current = read_file(storage, workspace_id, relative_path)?;
    let version = storage
        .document_version(workspace_id, relative_path, version_id)?
        .ok_or_else(|| AppError::InvalidInput("找不到指定文档版本".into()))?;
    let metadata = version_metadata(&version);
    Ok(DocumentVersion {
        summary: version_summary(metadata, &current.content_hash),
        content: version.content,
    })
}

pub fn restore_document_version(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    version_id: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    Uuid::parse_str(version_id).map_err(|_| AppError::InvalidInput("版本标识无效".into()))?;
    let target = storage
        .document_version(workspace_id, relative_path, version_id)?
        .ok_or_else(|| AppError::InvalidInput("找不到指定文档版本".into()))?;
    let current = read_file(storage, workspace_id, relative_path)?;
    if current.content_hash != base_hash {
        return Err(AppError::FileConflict);
    }
    if current.content_hash == target.content_hash {
        return Ok(SaveOutcome {
            path: relative_path.to_string(),
            content_hash: current.content_hash,
            size_bytes: current.size_bytes,
        });
    }
    let outcome = save_file(
        storage,
        workspace_id,
        relative_path,
        &target.content,
        &current.content_hash,
    )?;
    let summary = format!("恢复到 {} 的版本", target.created_at);
    if let Err(error) = storage.record_file_save_versions(
        workspace_id,
        relative_path,
        &current.content,
        &current.content_hash,
        &target.content,
        &target.content_hash,
        "restore",
        &summary,
    ) {
        let _ = save_file(
            storage,
            workspace_id,
            relative_path,
            &current.content,
            &outcome.content_hash,
        );
        return Err(error);
    }
    let _ = storage.cleanup_expired_versions();
    Ok(outcome)
}

fn version_metadata(version: &DocumentVersionRecord) -> DocumentVersionMetadata {
    DocumentVersionMetadata {
        id: version.id.clone(),
        workspace_id: version.workspace_id.clone(),
        relative_path: version.relative_path.clone(),
        content_hash: version.content_hash.clone(),
        source: version.source.clone(),
        summary: version.summary.clone(),
        version_kind: version.version_kind.clone(),
        created_at: version.created_at.clone(),
    }
}

fn version_summary(version: DocumentVersionMetadata, current_hash: &str) -> DocumentVersionSummary {
    DocumentVersionSummary {
        id: version.id,
        relative_path: version.relative_path,
        is_current: version.content_hash == current_hash,
        content_hash: version.content_hash,
        source: version.source,
        summary: version.summary,
        version_kind: version.version_kind,
        created_at: version.created_at,
    }
}

pub fn save_draft(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    base_hash: &str,
) -> Result<(), AppError> {
    ensure_editable_path(relative_path)?;
    validate_content_size(content)?;
    if let Some(selected) = storage.workspace_file(workspace_id, relative_path)? {
        let path = Path::new(&selected.absolute_path).canonicalize()?;
        if !path.is_file() {
            return Err(AppError::InvalidInput("独立文件已移动或删除".into()));
        }
    } else {
        let root = workspace_root(storage, workspace_id)?;
        resolve_existing_file(&root, Path::new(relative_path))?;
    }
    storage.save_draft(workspace_id, relative_path, content, base_hash)
}

pub fn list_recovery_drafts(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<RecoveryDraftSummary>, AppError> {
    require_workspace(storage, workspace_id)?;
    let mut drafts = Vec::new();
    for row in storage.workspace_draft_summaries(workspace_id)? {
        let current = read_file(storage, workspace_id, &row.relative_path);
        match current {
            Ok(document) => {
                if row.content_hash == document.content_hash {
                    storage.delete_draft(workspace_id, &row.relative_path)?;
                    continue;
                }
                drafts.push(RecoveryDraftSummary {
                    relative_path: row.relative_path,
                    conflict: row.base_hash != document.content_hash,
                    base_hash: row.base_hash,
                    updated_at: row.updated_at,
                    current_hash: Some(document.content_hash),
                    available: true,
                });
            }
            Err(_) => drafts.push(RecoveryDraftSummary {
                relative_path: row.relative_path,
                base_hash: row.base_hash,
                updated_at: row.updated_at,
                current_hash: None,
                conflict: true,
                available: false,
            }),
        }
    }
    Ok(drafts)
}

pub fn discard_draft(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
) -> Result<(), AppError> {
    require_workspace(storage, workspace_id)?;
    ensure_editable_path(relative_path)?;
    storage.delete_draft(workspace_id, relative_path)
}

fn workspace_root(storage: &Storage, workspace_id: &str) -> Result<PathBuf, AppError> {
    let row = require_workspace(storage, workspace_id)?;
    canonicalize_root(Path::new(&row.root_path))
}

fn require_workspace(storage: &Storage, workspace_id: &str) -> Result<WorkspaceRow, AppError> {
    storage
        .workspace(workspace_id)?
        .ok_or_else(|| AppError::InvalidInput("工作区不存在或授权记录已删除".into()))
}

fn summary_from_row(row: &WorkspaceRow) -> WorkspaceSummary {
    WorkspaceSummary {
        id: row.id.clone(),
        name: row.name.clone(),
        available: row.kind == "standalone" || Path::new(&row.root_path).is_dir(),
        kind: row.kind.clone(),
    }
}

fn selected_file_entry(row: &WorkspaceFileRow) -> WorkspaceFileEntry {
    let path = Path::new(&row.absolute_path);
    let extracted = is_supported_document_path(path);
    let metadata = fs::metadata(path).ok();
    let size_bytes = metadata.as_ref().map_or(0, fs::Metadata::len);
    let size_limit = if extracted {
        MAX_DOCUMENT_FILE_BYTES
    } else {
        MAX_TEXT_FILE_BYTES
    };
    WorkspaceFileEntry {
        path: row.virtual_path.clone(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("selected-file")
            .to_string(),
        language: language_for_path(path).to_string(),
        size_bytes,
        readable: metadata.is_some() && size_bytes <= size_limit,
        editable: !extracted,
        extracted,
        source_id: Some(row.source_id.clone()),
    }
}

fn draft_from_row(row: DraftRow) -> DraftDocument {
    DraftDocument {
        content: row.content,
        base_hash: row.base_hash,
        updated_at: row.updated_at,
    }
}

fn reconciled_draft(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    current_hash: &str,
) -> Result<Option<DraftDocument>, AppError> {
    let Some(row) = storage.draft(workspace_id, relative_path)? else {
        return Ok(None);
    };
    if content_hash(row.content.as_bytes()) == current_hash {
        storage.delete_draft(workspace_id, relative_path)?;
        Ok(None)
    } else {
        Ok(Some(draft_from_row(row)))
    }
}

fn should_visit(entry: &DirEntry) -> bool {
    entry.depth() == 0
        || !entry.file_type().is_dir()
        || !IGNORED_DIRECTORIES.contains(&entry.file_name().to_string_lossy().as_ref())
}

fn relative_path(root: &Path, path: &Path) -> Result<String, AppError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::InvalidInput("文件不在当前工作区内".into()))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn language_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("md") => "markdown",
        Some("ts") | Some("tsx") => "typescript",
        Some("js") | Some("jsx") | Some("mjs") => "javascript",
        Some("json") => "json",
        Some("py") => "python",
        Some("yaml") | Some("yml") => "yaml",
        Some("html") => "html",
        Some("css") => "css",
        Some("toml") => "toml",
        Some("docx") => "word",
        Some("pdf") => "pdf",
        _ => "text",
    }
}

fn validate_content_size(content: &str) -> Result<(), AppError> {
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(AppError::FileTooLarge);
    }
    Ok(())
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, AppError> {
    if path.metadata()?.len() > limit {
        return Err(AppError::FileTooLarge);
    }
    Ok(fs::read(path)?)
}

fn ensure_editable_path(relative_path: &str) -> Result<(), AppError> {
    if !is_supported_text_path(Path::new(relative_path)) {
        return Err(AppError::InvalidInput(
            "Word and PDF documents are read-only context sources".into(),
        ));
    }
    Ok(())
}

fn extract_document_text(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("docx") => extract_docx_text(bytes),
        Some("pdf") => {
            let text = pdf_extract::extract_text_from_mem(bytes).map_err(|error| {
                AppError::InvalidInput(format!("Unable to extract PDF text: {error}"))
            })?;
            if text.trim().is_empty() {
                return Err(AppError::InvalidInput(
                    "This PDF has no extractable text layer; OCR is required".into(),
                ));
            }
            Ok(text)
        }
        _ => Err(AppError::InvalidInput("Unsupported document type".into())),
    }
}

fn extract_docx_text(bytes: &[u8]) -> Result<String, AppError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|error| AppError::InvalidInput(format!("Invalid DOCX package: {error}")))?;
    let mut document = archive.by_name("word/document.xml").map_err(|_| {
        AppError::InvalidInput("DOCX package does not contain word/document.xml".into())
    })?;
    let mut xml = String::new();
    document.read_to_string(&mut xml).map_err(AppError::Io)?;
    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut output = String::new();
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::Text(text)) => {
                let decoded = text.xml_content().map_err(|error| {
                    AppError::InvalidInput(format!("Invalid DOCX text: {error}"))
                })?;
                output.push_str(&decoded);
            }
            Ok(quick_xml::events::Event::GeneralRef(reference)) => {
                let entity = format!("&{};", String::from_utf8_lossy(reference.as_ref()));
                let decoded = quick_xml::escape::unescape(&entity).map_err(|error| {
                    AppError::InvalidInput(format!("Invalid DOCX entity: {error}"))
                })?;
                output.push_str(&decoded);
            }
            Ok(quick_xml::events::Event::End(end)) if end.name().as_ref() == b"w:p" => {
                output.push('\n');
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(error) => {
                return Err(AppError::InvalidInput(format!(
                    "Unable to parse DOCX content: {error}"
                )))
            }
            _ => {}
        }
    }
    if output.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "This DOCX document contains no extractable body text".into(),
        ));
    }
    Ok(output.trim().to_string())
}

fn content_hash(content: &[u8]) -> String {
    let digest = Sha256::digest(content);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::{
        attach_selected_file, content_hash, language_for_path, list_document_versions, list_files,
        list_recovery_drafts, read_document_version, read_file, read_selected_file,
        register_standalone_workspace, register_workspace, restore_document_version,
        restore_workspace, save_draft, save_file, save_file_with_history, save_selected_file,
        MAX_TEXT_FILE_BYTES,
    };
    use crate::error::AppError;
    use crate::storage::Storage;
    use std::fs;
    use std::io::Write;
    use std::path::Path;

    #[test]
    fn hashes_are_deterministic() {
        assert_eq!(content_hash(b"hello"), content_hash(b"hello"));
        assert_ne!(content_hash(b"hello"), content_hash(b"changed"));
    }

    #[test]
    fn detects_editor_languages() {
        assert_eq!(language_for_path(Path::new("a.TS")), "typescript");
        assert_eq!(language_for_path(Path::new("a.yaml")), "yaml");
        assert_eq!(MAX_TEXT_FILE_BYTES, 2_097_152);
    }

    #[test]
    fn lists_one_thousand_files_and_ignores_dependency_directories() {
        let directory = tempfile::tempdir().unwrap();
        for index in 0..1_000 {
            fs::write(
                directory.path().join(format!("file-{index:04}.ts")),
                "export {};\n",
            )
            .unwrap();
        }
        fs::create_dir(directory.path().join("node_modules")).unwrap();
        fs::write(directory.path().join("node_modules/ignored.js"), "ignored").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace = register_workspace(&storage, directory.path()).unwrap();

        let files = list_files(&storage, &workspace.id).unwrap();

        assert_eq!(files.len(), 1_000);
        assert_eq!(files.first().unwrap().path, "file-0000.ts");
        assert_eq!(files.last().unwrap().path, "file-0999.ts");
    }

    #[test]
    fn extracts_docx_as_read_only_context() {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("notes.docx");
        let file = fs::File::create(&file_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file(
                "word/document.xml",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        archive
            .write_all(
                br#"<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Hello &amp; A2UI</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>"#,
            )
            .unwrap();
        archive.finish().unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace = register_workspace(&storage, directory.path()).unwrap();

        let entries = list_files(&storage, &workspace.id).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].editable);
        assert!(entries[0].extracted);
        let document = read_file(&storage, &workspace.id, "notes.docx").unwrap();
        assert_eq!(document.content, "Hello & A2UI\nSecond paragraph");
        assert!(!document.editable);
        assert!(document.extracted);
        assert!(document.draft.is_none());
        assert!(matches!(
            save_file(
                &storage,
                &workspace.id,
                "notes.docx",
                "replacement",
                &document.content_hash
            ),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn refuses_to_overwrite_external_changes_and_recovers_drafts() {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("example.json");
        fs::write(&file_path, "{\"value\":1}\n").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace = register_workspace(&storage, directory.path()).unwrap();
        let opened = read_file(&storage, &workspace.id, "example.json").unwrap();
        save_draft(
            &storage,
            &workspace.id,
            "example.json",
            "{\"value\":2}\n",
            &opened.content_hash,
        )
        .unwrap();
        assert_eq!(
            read_file(&storage, &workspace.id, "example.json")
                .unwrap()
                .draft
                .unwrap()
                .content,
            "{\"value\":2}\n"
        );

        fs::write(&file_path, "{\"external\":true}\n").unwrap();
        let result = save_file(
            &storage,
            &workspace.id,
            "example.json",
            "{\"value\":2}\n",
            &opened.content_hash,
        );

        assert!(matches!(result, Err(AppError::FileConflict)));
        assert_eq!(
            fs::read_to_string(file_path).unwrap(),
            "{\"external\":true}\n"
        );
    }

    #[test]
    fn crash_drafts_survive_restart_and_require_confirmation_for_external_changes() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        fs::create_dir(&project).unwrap();
        let file_path = project.join("notes.md");
        let database_path = root.path().join("recovery.sqlite3");
        fs::write(&file_path, "disk v1").unwrap();

        let storage = Storage::open(&database_path).unwrap();
        let workspace = register_workspace(&storage, &project).unwrap();
        let opened = read_file(&storage, &workspace.id, "notes.md").unwrap();
        save_draft(
            &storage,
            &workspace.id,
            "notes.md",
            "unsaved draft",
            &opened.content_hash,
        )
        .unwrap();
        drop(storage);

        fs::write(&file_path, "external v2").unwrap();
        let storage = Storage::open(&database_path).unwrap();
        let drafts = list_recovery_drafts(&storage, &workspace.id).unwrap();
        assert_eq!(drafts.len(), 1);
        assert!(drafts[0].available);
        assert!(drafts[0].conflict);
        assert_eq!(drafts[0].relative_path, "notes.md");

        let reopened = read_file(&storage, &workspace.id, "notes.md").unwrap();
        let draft = reopened.draft.unwrap();
        assert_eq!(draft.content, "unsaved draft");
        save_file_with_history(
            &storage,
            &workspace.id,
            "notes.md",
            &draft.content,
            &reopened.content_hash,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "unsaved draft");
        assert!(list_recovery_drafts(&storage, &workspace.id)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn startup_removes_a_stale_draft_when_the_disk_write_already_completed() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        fs::create_dir(&project).unwrap();
        let file_path = project.join("saved.md");
        let database_path = root.path().join("stale-draft.sqlite3");
        fs::write(&file_path, "before").unwrap();

        let storage = Storage::open(&database_path).unwrap();
        let workspace = register_workspace(&storage, &project).unwrap();
        let opened = read_file(&storage, &workspace.id, "saved.md").unwrap();
        save_draft(
            &storage,
            &workspace.id,
            "saved.md",
            "after",
            &opened.content_hash,
        )
        .unwrap();
        fs::write(&file_path, "after").unwrap();
        drop(storage);

        let storage = Storage::open(&database_path).unwrap();
        assert!(list_recovery_drafts(&storage, &workspace.id)
            .unwrap()
            .is_empty());
        assert!(storage.draft(&workspace.id, "saved.md").unwrap().is_none());
    }

    #[test]
    fn saves_text_content_to_the_real_file() {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("autosave.ts");
        fs::write(&file_path, "export const value = 1;\n").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace = register_workspace(&storage, directory.path()).unwrap();
        let opened = read_file(&storage, &workspace.id, "autosave.ts").unwrap();

        let saved = save_file(
            &storage,
            &workspace.id,
            "autosave.ts",
            "export const value = 2;\n",
            &opened.content_hash,
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(&file_path).unwrap(),
            "export const value = 2;\n"
        );
        assert_ne!(saved.content_hash, opened.content_hash);
    }

    #[test]
    fn autosave_history_survives_restart_and_restores_without_overwriting_conflicts() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        fs::create_dir(&project).unwrap();
        let file_path = project.join("history.md");
        let database_path = root.path().join("history.sqlite3");
        fs::write(&file_path, "# Original\n").unwrap();

        let storage = Storage::open(&database_path).unwrap();
        let workspace = register_workspace(&storage, &project).unwrap();
        let opened = read_file(&storage, &workspace.id, "history.md").unwrap();
        save_file_with_history(
            &storage,
            &workspace.id,
            "history.md",
            "# Saved\n",
            &opened.content_hash,
        )
        .unwrap();
        drop(storage);

        let storage = Storage::open(&database_path).unwrap();
        let versions = list_document_versions(&storage, &workspace.id, "history.md").unwrap();
        assert_eq!(versions.len(), 2);
        assert!(versions.iter().any(|version| version.source == "initial"));
        assert!(versions
            .iter()
            .any(|version| version.source == "autosave" && version.is_current));
        let original = versions
            .iter()
            .find(|version| version.source == "initial")
            .unwrap();
        let preview =
            read_document_version(&storage, &workspace.id, "history.md", &original.id).unwrap();
        assert_eq!(preview.content, "# Original\n");

        let current = read_file(&storage, &workspace.id, "history.md").unwrap();
        let restored = restore_document_version(
            &storage,
            &workspace.id,
            "history.md",
            &original.id,
            &current.content_hash,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "# Original\n");
        let restored_versions =
            list_document_versions(&storage, &workspace.id, "history.md").unwrap();
        assert!(restored_versions
            .iter()
            .any(|version| version.source == "restore" && version.is_current));

        fs::write(&file_path, "# External\n").unwrap();
        assert!(matches!(
            restore_document_version(
                &storage,
                &workspace.id,
                "history.md",
                &original.id,
                &restored.content_hash,
            ),
            Err(AppError::FileConflict)
        ));
        assert_eq!(fs::read_to_string(file_path).unwrap(), "# External\n");
    }

    #[test]
    fn selected_text_file_can_be_read_and_saved_without_a_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("standalone.md");
        fs::write(&file_path, "# Before\n").unwrap();

        let opened = read_selected_file(&file_path, "selection-1").unwrap();
        assert_eq!(opened.path, "selected/selection-1/standalone.md");
        assert_eq!(opened.source_id.as_deref(), Some("selection-1"));
        assert!(opened.editable);

        save_selected_file(&file_path, "# After\n", &opened.content_hash).unwrap();
        assert_eq!(fs::read_to_string(file_path).unwrap(), "# After\n");
    }

    #[test]
    fn standalone_workspace_persists_file_authorization_and_writes_to_the_real_path() {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("loose.json");
        fs::write(&file_path, "{\"before\":true}\n").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace = register_standalone_workspace(&storage).unwrap();

        let attached = attach_selected_file(&storage, &workspace.id, &file_path).unwrap();
        let restored = restore_workspace(&storage, &workspace.id).unwrap();
        let entries = list_files(&storage, &workspace.id).unwrap();
        let reopened = read_file(&storage, &workspace.id, &attached.path).unwrap();

        assert_eq!(restored.kind, "standalone");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "loose.json");
        assert_eq!(entries[0].source_id, attached.source_id);
        assert_eq!(reopened.content, "{\"before\":true}\n");

        save_file(
            &storage,
            &workspace.id,
            &attached.path,
            "{\"after\":true}\n",
            &reopened.content_hash,
        )
        .unwrap();
        storage.remove_workspace(&workspace.id).unwrap();

        assert_eq!(fs::read_to_string(file_path).unwrap(), "{\"after\":true}\n");
        assert!(storage
            .workspace_file_by_source(attached.source_id.as_deref().unwrap())
            .unwrap()
            .is_none());
    }
}
