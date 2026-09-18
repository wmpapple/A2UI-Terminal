use crate::a2ui::{validate_surface, A2uiNode, A2uiSurfaceState};
use crate::domain::result::{
    validate_title, CreateTextResultInput, RestoreResultRevisionInput, ResultAppliedReview,
    ResultDetail, ResultDocument, ResultRecoveryDraft, ResultRevision, ResultRevisionSummary,
    ResultStorageKind, ResultSummary, ResultType, SaveResultDocumentInput, SaveResultDraftInput,
    TextResultFormat,
};
use crate::error::AppError;
use crate::repository::result::{detail_from_row, ResultRepository};
use crate::storage::{A2uiSurfaceRow, NewManagedResultRow, ResultSourceRow, Storage};
use crate::workspace::{self, WorkspaceDocument, MAX_TEXT_FILE_BYTES};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

const MANAGED_RESULTS_DIRECTORY: &str = "my-results";
const MANAGED_RESULTS_WORKSPACE_ID: &str = "00000000-0000-4000-8000-000000000001";

enum ReviewResultLink<'a> {
    None,
    Apply {
        review_id: &'a str,
        expected_status: &'a str,
    },
}

struct ManagedResultDraft<'a> {
    title: &'a str,
    file_name: &'a str,
    result_type: ResultType,
    format: TextResultFormat,
    content: &'a str,
    review_link: ReviewResultLink<'a>,
}

pub fn prepare_managed_results_dir(app_data_dir: &Path) -> Result<PathBuf, AppError> {
    let directory = app_data_dir.join(MANAGED_RESULTS_DIRECTORY);
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

pub fn list(
    storage: &Storage,
    workspace_id: Option<&str>,
    include_archived: bool,
) -> Result<Vec<ResultSummary>, AppError> {
    if let Some(workspace_id) = workspace_id {
        if workspace_id.trim().is_empty() || workspace_id.chars().count() > 128 {
            return Err(AppError::InvalidInput("工作区标识无效".into()));
        }
    }
    ResultRepository::new(storage).list(workspace_id, include_archived)
}

pub fn get(storage: &Storage, result_id: &str) -> Result<ResultDetail, AppError> {
    Uuid::parse_str(result_id).map_err(|_| AppError::InvalidInput("成果标识无效".into()))?;
    ResultRepository::new(storage)
        .get(result_id)?
        .ok_or_else(|| AppError::InvalidInput("找不到指定成果".into()))
}

pub fn create_text(
    storage: &Storage,
    managed_results_dir: &Path,
    input: CreateTextResultInput,
) -> Result<ResultDocument, AppError> {
    let title = validate_title(&input.title)?.to_string();
    validate_adapter(input.result_type, input.format)?;
    let file_name = validate_file_name(&input.file_name, input.format)?;
    let content = match input.format {
        TextResultFormat::Markdown => format!("# {title}\n\n"),
        TextResultFormat::PlainText => format!("{title}\n\n"),
        TextResultFormat::Csv => "Column 1,Column 2\n,\n".into(),
        TextResultFormat::Json => initial_structured_content(input.result_type, &title)?,
    };
    create_managed_document(
        storage,
        managed_results_dir,
        ManagedResultDraft {
            title: &title,
            file_name: &file_name,
            result_type: input.result_type,
            format: input.format,
            content: &content,
            review_link: ReviewResultLink::None,
        },
    )
}

pub fn create_from_review(
    storage: &Storage,
    managed_results_dir: &Path,
    review_id: &str,
    title: &str,
    file_name: &str,
    format: TextResultFormat,
    content: &str,
) -> Result<ResultDocument, AppError> {
    let title = validate_title(title)?;
    let file_name = validate_file_name(file_name, format)?;
    create_managed_document(
        storage,
        managed_results_dir,
        ManagedResultDraft {
            title,
            file_name: &file_name,
            result_type: ResultType::Document,
            format,
            content,
            review_link: ReviewResultLink::Apply {
                review_id,
                expected_status: "accepted",
            },
        },
    )
}

pub fn create_conflict_copy(
    storage: &Storage,
    managed_results_dir: &Path,
    review_id: &str,
    title: &str,
    original_path: &str,
    content: &str,
) -> Result<ResultDocument, AppError> {
    let extension = Path::new(original_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let format = if extension.as_deref() == Some("txt") {
        TextResultFormat::PlainText
    } else {
        TextResultFormat::Markdown
    };
    let suffix = match format {
        TextResultFormat::Markdown => "md",
        TextResultFormat::PlainText => "txt",
        TextResultFormat::Csv => "csv",
        TextResultFormat::Json => "json",
    };
    let file_name = format!("{}.{suffix}", Uuid::new_v4());
    let title = format!("{} - AI 候选副本", title.trim());
    let title: String = title.chars().take(160).collect();
    create_managed_document(
        storage,
        managed_results_dir,
        ManagedResultDraft {
            title: &title,
            file_name: &file_name,
            result_type: ResultType::Document,
            format,
            content,
            review_link: ReviewResultLink::Apply {
                review_id,
                expected_status: "conflicted",
            },
        },
    )
}

pub fn undo_review_managed_result(
    storage: &Storage,
    managed_results_dir: &Path,
    review_id: &str,
    result_id: &str,
) -> Result<(), AppError> {
    let source = result_source(storage, result_id)?;
    if source.source_kind != "managed_local" {
        return Err(AppError::InvalidInput(
            "AI 创建的成果不是托管文本文件".into(),
        ));
    }
    let output_path = managed_path(
        managed_results_dir,
        &source.source_ref,
        format_for_file_name(&source.source_ref)?,
        true,
    )?;
    let bytes = fs::read(&output_path)?;
    let initial_hash = storage
        .review_managed_result_initial_hash(review_id, result_id)?
        .ok_or(AppError::StateUnavailable)?;
    if content_hash(&bytes) != initial_hash {
        return Err(AppError::FileConflict);
    }
    fs::remove_file(&output_path)?;
    if let Err(error) = storage.delete_review_managed_result(
        review_id,
        result_id,
        &source.result.workspace_id,
        &source.source_ref,
    ) {
        let _ = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)
            .and_then(|mut file| {
                file.write_all(&bytes)?;
                file.sync_all()
            });
        return Err(error);
    }
    Ok(())
}

pub fn read_document(
    storage: &Storage,
    managed_results_dir: &Path,
    result_id: &str,
) -> Result<ResultDocument, AppError> {
    validate_result_id(result_id)?;
    let source = result_source(storage, result_id)?;
    read_from_source(storage, managed_results_dir, source)
}

pub fn save_document(
    storage: &Storage,
    managed_results_dir: &Path,
    input: SaveResultDocumentInput,
) -> Result<ResultDocument, AppError> {
    validate_result_id(&input.result_id)?;
    validate_hash(&input.base_hash)?;
    let source = result_source(storage, &input.result_id)?;
    let result_type = result_type_from_storage(&source.result.result_type)?;
    validate_result_content(result_type, &input.content)?;
    storage.save_result_draft(
        &input.result_id,
        &input.base_hash,
        &input.content,
        &content_hash(input.content.as_bytes()),
    )?;
    match source.source_kind.as_str() {
        "managed_local" => save_managed_document(
            storage,
            managed_results_dir,
            &source,
            &input.content,
            &input.base_hash,
            "autosave",
            "保存成果",
        )?,
        "workspace_file" => {
            workspace::save_file_with_history(
                storage,
                &source.result.workspace_id,
                &source.source_ref,
                &input.content,
                &input.base_hash,
            )?;
        }
        _ => return Err(AppError::InvalidInput("成果不是可编辑的文档".into())),
    }
    storage.delete_result_draft(&input.result_id)?;
    read_document(storage, managed_results_dir, &input.result_id)
}

pub fn save_draft(
    storage: &Storage,
    managed_results_dir: &Path,
    input: SaveResultDraftInput,
) -> Result<ResultRecoveryDraft, AppError> {
    validate_result_id(&input.result_id)?;
    validate_hash(&input.base_hash)?;
    let document = read_document(storage, managed_results_dir, &input.result_id)?;
    if !document.editable {
        return Err(AppError::InvalidInput("成果不是可编辑的文档".into()));
    }
    validate_result_content(document.result.summary.result_type, &input.content)?;
    let content_hash = content_hash(input.content.as_bytes());
    let row = storage.save_result_draft(
        &input.result_id,
        &input.base_hash,
        &input.content,
        &content_hash,
    )?;
    Ok(ResultRecoveryDraft {
        content: row.content,
        content_hash: row.content_hash,
        base_hash: row.base_hash.clone(),
        conflicted: row.base_hash != document.content_hash,
        updated_at: row.updated_at,
    })
}

pub fn discard_draft(storage: &Storage, result_id: &str) -> Result<bool, AppError> {
    validate_result_id(result_id)?;
    storage.delete_result_draft(result_id)
}

pub fn list_revisions(
    storage: &Storage,
    managed_results_dir: &Path,
    result_id: &str,
) -> Result<Vec<ResultRevisionSummary>, AppError> {
    let document = read_document(storage, managed_results_dir, result_id)?;
    let source = result_source(storage, result_id)?;
    let revision_ref = revision_ref(&source);
    Ok(storage
        .document_versions(&source.result.workspace_id, revision_ref, 200)?
        .into_iter()
        .map(|revision| ResultRevisionSummary {
            id: revision.id,
            is_current: revision.content_hash == document.content_hash,
            content_hash: revision.content_hash,
            source: revision.source,
            summary: revision.summary,
            created_at: revision.created_at,
        })
        .collect())
}

pub fn read_revision(
    storage: &Storage,
    managed_results_dir: &Path,
    result_id: &str,
    revision_id: &str,
) -> Result<ResultRevision, AppError> {
    validate_result_id(result_id)?;
    validate_result_id(revision_id)?;
    let document = read_document(storage, managed_results_dir, result_id)?;
    let source = result_source(storage, result_id)?;
    let revision_ref = revision_ref(&source);
    let revision = storage
        .document_version(&source.result.workspace_id, revision_ref, revision_id)?
        .ok_or_else(|| AppError::InvalidInput("找不到指定成果版本".into()))?;
    Ok(ResultRevision {
        summary: ResultRevisionSummary {
            id: revision.id,
            is_current: revision.content_hash == document.content_hash,
            content_hash: revision.content_hash,
            source: revision.source,
            summary: revision.summary,
            created_at: revision.created_at,
        },
        content: revision.content,
    })
}

pub fn restore_revision(
    storage: &Storage,
    managed_results_dir: &Path,
    input: RestoreResultRevisionInput,
) -> Result<ResultDocument, AppError> {
    let revision = read_revision(
        storage,
        managed_results_dir,
        &input.result_id,
        &input.revision_id,
    )?;
    validate_hash(&input.base_hash)?;
    let source = result_source(storage, &input.result_id)?;
    match source.source_kind.as_str() {
        "managed_local" => save_managed_document(
            storage,
            managed_results_dir,
            &source,
            &revision.content,
            &input.base_hash,
            "restore",
            "恢复成果历史版本",
        )?,
        "workspace_file" => {
            workspace::restore_document_version(
                storage,
                &source.result.workspace_id,
                &source.source_ref,
                &input.revision_id,
                &input.base_hash,
            )?;
        }
        _ => return Err(AppError::InvalidInput("成果不是可编辑的文档".into())),
    }
    read_document(storage, managed_results_dir, &input.result_id)
}

pub fn duplicate(
    storage: &Storage,
    managed_results_dir: &Path,
    result_id: &str,
) -> Result<ResultDocument, AppError> {
    let source = read_document(storage, managed_results_dir, result_id)?;
    let result_id = Uuid::new_v4().to_string();
    let extension = match source.format {
        TextResultFormat::Markdown => "md",
        TextResultFormat::PlainText => "txt",
        TextResultFormat::Csv => "csv",
        TextResultFormat::Json => "json",
    };
    let file_name = format!("{result_id}.{extension}");
    let title = format!("{} - 副本", source.result.summary.title);
    let title: String = title.chars().take(160).collect();
    create_managed_document(
        storage,
        managed_results_dir,
        ManagedResultDraft {
            title: &title,
            file_name: &file_name,
            result_type: source.result.summary.result_type,
            format: source.format,
            content: &source.content,
            review_link: ReviewResultLink::None,
        },
    )
}

fn create_managed_document(
    storage: &Storage,
    managed_results_dir: &Path,
    draft: ManagedResultDraft<'_>,
) -> Result<ResultDocument, AppError> {
    let ManagedResultDraft {
        title,
        file_name,
        result_type,
        format,
        content,
        review_link,
    } = draft;
    validate_adapter(result_type, format)?;
    validate_result_content(result_type, content)?;
    storage.ensure_managed_results_workspace(MANAGED_RESULTS_WORKSPACE_ID)?;
    fs::create_dir_all(managed_results_dir)?;
    let output_path = managed_path(managed_results_dir, file_name, format, false)?;
    let result_id = Uuid::new_v4().to_string();
    let revision_id = Uuid::new_v4().to_string();
    let content_hash = content_hash(content.as_bytes());
    let storage_ref = format!("result://file/{result_id}");
    let managed_state = serde_json::to_string(&json!({
        "adapter": result_type,
        "format": format
    }))
    .map_err(|_| AppError::StateUnavailable)?;
    let (review_id, review_expected_status) = match review_link {
        ReviewResultLink::None => (None, None),
        ReviewResultLink::Apply {
            review_id,
            expected_status,
        } => (Some(review_id), Some(expected_status)),
    };
    let write_result = (|| -> Result<(), std::io::Error> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        return if error.kind() == std::io::ErrorKind::AlreadyExists {
            if review_id.is_some() {
                Err(AppError::FileConflict)
            } else {
                Err(AppError::InvalidInput(
                    "同名成果已存在，未覆盖任何文件".into(),
                ))
            }
        } else {
            let _ = fs::remove_file(&output_path);
            Err(AppError::Io(error))
        };
    }
    let row = match storage.create_managed_text_result(NewManagedResultRow {
        result_id: &result_id,
        workspace_id: MANAGED_RESULTS_WORKSPACE_ID,
        result_type: result_type.as_str(),
        title,
        storage_ref: &storage_ref,
        source_ref: file_name,
        managed_state_json: &managed_state,
        revision_id: &revision_id,
        content,
        content_hash: &content_hash,
        review_id,
        review_expected_status,
    }) {
        Ok(row) => row,
        Err(error) => {
            let _ = fs::remove_file(&output_path);
            return Err(error);
        }
    };
    let _ = super::telemetry::record(storage, super::telemetry::ProductEvent::ResultCreated);
    Ok(ResultDocument {
        result: detail_from_row(row)?,
        format,
        content: content.to_string(),
        content_hash,
        size_bytes: content.len() as u64,
        editable: true,
        applied_review: applied_review_for_result(storage, &result_id)?,
        recovery_draft: None,
    })
}

fn read_from_source(
    storage: &Storage,
    managed_results_dir: &Path,
    source: ResultSourceRow,
) -> Result<ResultDocument, AppError> {
    let result_type = result_type_from_storage(&source.result.result_type)?;
    let (format, content, hash, size_bytes, editable) = match source.source_kind.as_str() {
        "managed_local" => {
            let format = format_for_file_name(&source.source_ref)?;
            validate_adapter(result_type, format)?;
            let path = managed_path(managed_results_dir, &source.source_ref, format, true)?;
            let bytes = read_managed_file(&path)?;
            let content = String::from_utf8(bytes).map_err(|_| AppError::InvalidEncoding)?;
            validate_result_content(result_type, &content)?;
            let hash = content_hash(content.as_bytes());
            storage.ensure_managed_result_initial_revision(
                &source.result.id,
                &source.result.workspace_id,
                &source.source_ref,
                &Uuid::new_v4().to_string(),
                &content,
                &hash,
            )?;
            let size = content.len() as u64;
            (format, content, hash, size, true)
        }
        "workspace_file" => {
            if result_type != ResultType::Document {
                return Err(AppError::InvalidInput(
                    "只有文档成果可以直接绑定工作区文本文件".into(),
                ));
            }
            let document =
                workspace::read_file(storage, &source.result.workspace_id, &source.source_ref)?;
            (
                format_for_document_path(&source.source_ref),
                document.content,
                document.content_hash,
                document.size_bytes,
                document.editable,
            )
        }
        "a2ui_surface" if result_type == ResultType::Tool => {
            let state_json = source
                .result
                .managed_state_json
                .as_deref()
                .ok_or(AppError::StateUnavailable)?;
            let content = if let Some(snapshot) = surface_tool_snapshot(state_json)? {
                snapshot.content
            } else {
                serde_json::from_str::<serde_json::Value>(state_json)
                    .ok()
                    .and_then(|value| serde_json::to_string_pretty(&value).ok())
                    .ok_or(AppError::StateUnavailable)?
            };
            let hash = content_hash(content.as_bytes());
            let size = content.len() as u64;
            (TextResultFormat::Json, content, hash, size, false)
        }
        _ => return Err(AppError::InvalidInput("成果没有可用的内容适配器".into())),
    };
    let row = storage
        .result(&source.result.id)?
        .ok_or(AppError::StateUnavailable)?;
    let result = detail_from_row(row)?;
    let recovery_draft = if let Some(draft) = storage.result_draft(&source.result.id)? {
        if draft.content_hash == hash {
            storage.delete_result_draft(&source.result.id)?;
            None
        } else {
            Some(ResultRecoveryDraft {
                content: draft.content,
                content_hash: draft.content_hash,
                conflicted: draft.base_hash != hash,
                base_hash: draft.base_hash,
                updated_at: draft.updated_at,
            })
        }
    } else {
        None
    };
    Ok(ResultDocument {
        result,
        format,
        content,
        content_hash: hash,
        size_bytes,
        editable,
        applied_review: applied_review_for_result(storage, &source.result.id)?,
        recovery_draft,
    })
}

fn applied_review_for_result(
    storage: &Storage,
    result_id: &str,
) -> Result<Option<ResultAppliedReview>, AppError> {
    Ok(storage
        .applied_review_for_result(result_id)?
        .map(|(review_id, workspace_id)| ResultAppliedReview {
            review_id,
            workspace_id,
        }))
}

#[allow(clippy::too_many_arguments)]
fn save_managed_document(
    storage: &Storage,
    managed_results_dir: &Path,
    source: &ResultSourceRow,
    content: &str,
    base_hash: &str,
    revision_source: &str,
    summary: &str,
) -> Result<(), AppError> {
    let format = format_for_file_name(&source.source_ref)?;
    let path = managed_path(managed_results_dir, &source.source_ref, format, true)?;
    let before_bytes = read_managed_file(&path)?;
    let before = String::from_utf8(before_bytes).map_err(|_| AppError::InvalidEncoding)?;
    let before_hash = content_hash(before.as_bytes());
    if before_hash != base_hash {
        return Err(AppError::FileConflict);
    }
    let after_hash = content_hash(content.as_bytes());
    if after_hash == before_hash {
        return Ok(());
    }
    fs::write(&path, content.as_bytes())?;
    if let Err(error) = storage.record_managed_result_save_versions(
        &source.result.id,
        &source.result.workspace_id,
        &source.source_ref,
        &before,
        &before_hash,
        content,
        &after_hash,
        revision_source,
        summary,
    ) {
        let _ = fs::write(&path, before.as_bytes());
        return Err(error);
    }
    let _ = storage.cleanup_expired_versions();
    Ok(())
}

fn result_source(storage: &Storage, result_id: &str) -> Result<ResultSourceRow, AppError> {
    storage
        .result_source(result_id)?
        .ok_or_else(|| AppError::InvalidInput("找不到指定成果".into()))
}

fn revision_ref(source: &ResultSourceRow) -> &str {
    if source.source_kind == "a2ui_surface" {
        &source.result.storage_ref
    } else {
        &source.source_ref
    }
}

fn validate_result_id(value: &str) -> Result<(), AppError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput("成果或版本标识无效".into()))
}

pub(crate) fn validate_file_name(
    file_name: &str,
    format: TextResultFormat,
) -> Result<String, AppError> {
    let file_name = file_name.trim();
    if file_name.is_empty() || file_name.chars().count() > 120 {
        return Err(AppError::InvalidInput(
            "文件名不能为空且不能超过 120 个字符".into(),
        ));
    }
    let path = Path::new(file_name);
    if path.is_absolute()
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
        || file_name.contains(['/', '\\', ':'])
        || file_name.contains("..")
        || file_name.ends_with(['.', ' '])
        || file_name
            .chars()
            .any(|character| "<>\"|?*\0".contains(character))
    {
        return Err(AppError::InvalidInput(
            "文件名必须是安全的单层相对名称".into(),
        ));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let valid_extension = match format {
        TextResultFormat::Markdown => matches!(extension.as_str(), "md" | "markdown"),
        TextResultFormat::PlainText => extension == "txt",
        TextResultFormat::Csv => extension == "csv",
        TextResultFormat::Json => extension == "json",
    };
    if !valid_extension {
        return Err(AppError::InvalidInput("成果扩展名与文本格式不匹配".into()));
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if stem.is_empty()
        || reserved
            .iter()
            .any(|value| stem.eq_ignore_ascii_case(value))
    {
        return Err(AppError::InvalidInput("文件名在当前系统中不可用".into()));
    }
    Ok(file_name.to_string())
}

fn format_for_file_name(file_name: &str) -> Result<TextResultFormat, AppError> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let format = match extension.as_str() {
        "md" | "markdown" => TextResultFormat::Markdown,
        "txt" => TextResultFormat::PlainText,
        "csv" => TextResultFormat::Csv,
        "json" => TextResultFormat::Json,
        _ => return Err(AppError::InvalidInput("托管成果文件类型不受支持".into())),
    };
    validate_file_name(file_name, format)?;
    Ok(format)
}

fn format_for_document_path(path: &str) -> TextResultFormat {
    if Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "md" | "markdown"))
    {
        TextResultFormat::Markdown
    } else {
        TextResultFormat::PlainText
    }
}

fn managed_path(
    directory: &Path,
    file_name: &str,
    format: TextResultFormat,
    require_existing: bool,
) -> Result<PathBuf, AppError> {
    let file_name = validate_file_name(file_name, format)?;
    let path = directory.join(file_name);
    if path.parent() != Some(directory) {
        return Err(AppError::InvalidInput("托管成果路径无效".into()));
    }
    if require_existing {
        let root = directory.canonicalize()?;
        let canonical = path.canonicalize()?;
        if !canonical.is_file() || !canonical.starts_with(&root) {
            return Err(AppError::InvalidInput("托管成果不在授权目录内".into()));
        }
        Ok(canonical)
    } else {
        Ok(path)
    }
}

fn read_managed_file(path: &Path) -> Result<Vec<u8>, AppError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(AppError::FileTooLarge);
    }
    Ok(fs::read(path)?)
}

pub(crate) fn validate_content(content: &str) -> Result<(), AppError> {
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(AppError::FileTooLarge);
    }
    Ok(())
}

fn validate_adapter(result_type: ResultType, format: TextResultFormat) -> Result<(), AppError> {
    let valid = matches!(
        (result_type, format),
        (
            ResultType::Document,
            TextResultFormat::Markdown | TextResultFormat::PlainText
        ) | (ResultType::Spreadsheet, TextResultFormat::Csv)
            | (
                ResultType::Checklist | ResultType::Form | ResultType::Tool,
                TextResultFormat::Json
            )
    );
    if valid {
        Ok(())
    } else {
        Err(AppError::InvalidInput("成果类型与内部格式不匹配".into()))
    }
}

fn result_type_from_storage(value: &str) -> Result<ResultType, AppError> {
    match value {
        "document" => Ok(ResultType::Document),
        "spreadsheet" => Ok(ResultType::Spreadsheet),
        "checklist" => Ok(ResultType::Checklist),
        "form" => Ok(ResultType::Form),
        "tool" => Ok(ResultType::Tool),
        _ => Err(AppError::StateUnavailable),
    }
}

fn initial_structured_content(result_type: ResultType, title: &str) -> Result<String, AppError> {
    let value = match result_type {
        ResultType::Checklist => json!({
            "items": [{ "id": "item-1", "text": title, "completed": false }]
        }),
        ResultType::Form => json!({
            "fields": [{ "id": "field-1", "label": title, "kind": "text", "required": false }]
        }),
        ResultType::Tool => json!({
            "settings": [{ "key": "title", "label": "Title", "value": title }]
        }),
        _ => return Err(AppError::InvalidInput("成果类型不使用结构化 JSON".into())),
    };
    serde_json::to_string_pretty(&value).map_err(|_| AppError::StateUnavailable)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChecklistContent {
    items: Vec<ChecklistItem>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChecklistItem {
    id: String,
    text: String,
    completed: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FormContent {
    fields: Vec<FormField>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FormField {
    id: String,
    label: String,
    kind: String,
    required: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ToolContent {
    settings: Vec<ToolSetting>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ToolSetting {
    key: String,
    label: String,
    value: String,
}

pub(crate) fn validate_result_content(
    result_type: ResultType,
    content: &str,
) -> Result<(), AppError> {
    validate_content(content)?;
    match result_type {
        ResultType::Document => Ok(()),
        ResultType::Spreadsheet => validate_csv_content(content),
        ResultType::Checklist => {
            let parsed: ChecklistContent = serde_json::from_str(content)
                .map_err(|_| AppError::InvalidInput("清单内容不是受支持的 JSON 结构".into()))?;
            validate_structured_entries(
                parsed.items.iter().map(|item| (&item.id, &item.text)),
                2_000,
                "清单",
            )?;
            let _completed_count = parsed.items.iter().filter(|item| item.completed).count();
            Ok(())
        }
        ResultType::Form => {
            let parsed: FormContent = serde_json::from_str(content)
                .map_err(|_| AppError::InvalidInput("表单内容不是受支持的 JSON 结构".into()))?;
            validate_structured_entries(
                parsed.fields.iter().map(|field| (&field.id, &field.label)),
                500,
                "表单",
            )?;
            if parsed.fields.iter().any(|field| {
                !matches!(field.kind.as_str(), "text" | "number" | "date" | "checkbox")
            }) {
                return Err(AppError::InvalidInput("表单字段类型不受支持".into()));
            }
            let _required_count = parsed.fields.iter().filter(|field| field.required).count();
            Ok(())
        }
        ResultType::Tool => {
            let parsed: ToolContent = serde_json::from_str(content)
                .map_err(|_| AppError::InvalidInput("工具配置不是受支持的 JSON 结构".into()))?;
            validate_structured_entries(
                parsed
                    .settings
                    .iter()
                    .map(|setting| (&setting.key, &setting.label)),
                500,
                "工具配置",
            )?;
            if parsed
                .settings
                .iter()
                .any(|setting| setting.value.chars().count() > 2_000)
            {
                return Err(AppError::InvalidInput(
                    "工具配置值不能超过 2000 个字符".into(),
                ));
            }
            Ok(())
        }
    }
}

fn validate_structured_entries<'a>(
    entries: impl Iterator<Item = (&'a String, &'a String)>,
    max_entries: usize,
    label: &str,
) -> Result<(), AppError> {
    let entries: Vec<_> = entries.collect();
    if entries.len() > max_entries {
        return Err(AppError::InvalidInput(format!("{label}条目数量超限")));
    }
    let mut ids = HashSet::new();
    for (id, text) in entries {
        if id.trim().is_empty()
            || id.chars().count() > 80
            || text.trim().is_empty()
            || text.chars().count() > 500
            || !ids.insert(id)
        {
            return Err(AppError::InvalidInput(format!("{label}包含无效或重复条目")));
        }
    }
    Ok(())
}

fn validate_csv_content(content: &str) -> Result<(), AppError> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(content.as_bytes());
    let mut rows = 0usize;
    let mut cells = 0usize;
    for record in reader.records() {
        let record = record.map_err(|_| AppError::InvalidInput("CSV 内容格式无效".into()))?;
        rows += 1;
        cells += record.len();
        if rows > 10_000
            || record.len() > 256
            || cells > 250_000
            || record.iter().any(|cell| cell.chars().count() > 32_768)
        {
            return Err(AppError::InvalidInput("CSV 内容超过编辑适配器限制".into()));
        }
    }
    Ok(())
}

fn validate_hash(hash: &str) -> Result<(), AppError> {
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::InvalidInput("成果基础版本 Hash 无效".into()));
    }
    Ok(())
}

fn content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

pub fn ensure_file_result(
    storage: &Storage,
    workspace_id: &str,
    document: &WorkspaceDocument,
) -> Result<ResultDetail, AppError> {
    let title = validate_title(&document.name)?;
    let workspace = storage
        .workspace(workspace_id)?
        .ok_or_else(|| AppError::InvalidInput("工作区不存在".into()))?;
    let storage_kind = if workspace.kind == "standalone" {
        ResultStorageKind::StandaloneFile
    } else {
        ResultStorageKind::WorkspaceFile
    };
    let current_revision_id = storage
        .document_versions(workspace_id, &document.path, 1)?
        .first()
        .map(|revision| revision.id.clone());
    let new_id = Uuid::new_v4().to_string();
    let result = ResultRepository::new(storage).ensure_file(
        &new_id,
        workspace_id,
        &document.path,
        title,
        storage_kind,
        current_revision_id.as_deref(),
    )?;
    if result.summary.id == new_id {
        let _ = super::telemetry::record(storage, super::telemetry::ProductEvent::ResultCreated);
    }
    Ok(result)
}

pub fn ensure_surface_result(
    storage: &Storage,
    surface: &A2uiSurfaceRow,
) -> Result<ResultDetail, AppError> {
    let snapshot = surface_tool_snapshot(&surface.state_json)?;
    let proposed_title = snapshot
        .as_ref()
        .map(|snapshot| snapshot.title.as_str())
        .unwrap_or("交互成果");
    let title = validate_title(proposed_title)?;
    let new_id = Uuid::new_v4().to_string();
    let result = ResultRepository::new(storage).ensure_surface(
        &new_id,
        &surface.id,
        &surface.workspace_id,
        &surface.surface_id,
        &surface.session_id,
        title,
        &surface.state_json,
        snapshot.as_ref().map(|snapshot| snapshot.content.as_str()),
        snapshot
            .as_ref()
            .map(|snapshot| snapshot.content_hash.as_str()),
    )?;
    if result.summary.id == new_id {
        let _ = super::telemetry::record(storage, super::telemetry::ProductEvent::ResultCreated);
    }
    Ok(result)
}

struct SurfaceToolSnapshot {
    title: String,
    content: String,
    content_hash: String,
}

fn surface_tool_snapshot(state_json: &str) -> Result<Option<SurfaceToolSnapshot>, AppError> {
    let raw: Value = serde_json::from_str(state_json).map_err(|_| AppError::StateUnavailable)?;
    if !json_contains_component(&raw, "ResultSummary") {
        return Ok(None);
    }
    let state: A2uiSurfaceState =
        serde_json::from_value(raw).map_err(|_| AppError::StateUnavailable)?;
    let Some(summary) = find_component(&state.root, "ResultSummary") else {
        return Ok(None);
    };
    validate_surface(&state).map_err(|_| AppError::StateUnavailable)?;
    let fields = summary
        .props
        .get("fields")
        .and_then(Value::as_array)
        .ok_or(AppError::StateUnavailable)?;
    let mut settings = Vec::with_capacity(fields.len());
    for field_name in fields.iter().filter_map(Value::as_str) {
        let input = find_input(&state.root, field_name).ok_or(AppError::StateUnavailable)?;
        settings.push(json!({
            "key": field_name,
            "label": input.props.get("label").and_then(Value::as_str).unwrap_or(field_name),
            "value": surface_field_value(&state, input)
        }));
    }
    let content = serde_json::to_string_pretty(&json!({"settings": settings}))
        .map_err(|_| AppError::StateUnavailable)?;
    validate_result_content(ResultType::Tool, &content)?;
    let title = find_title(&state.root)
        .unwrap_or_else(|| "交互小工具".into())
        .chars()
        .take(160)
        .collect::<String>();
    let content_hash = content_hash(content.as_bytes());
    Ok(Some(SurfaceToolSnapshot {
        title,
        content,
        content_hash,
    }))
}

fn json_contains_component(value: &Value, component: &str) -> bool {
    match value {
        Value::Object(map) => {
            map.get("component").and_then(Value::as_str) == Some(component)
                || map
                    .values()
                    .any(|value| json_contains_component(value, component))
        }
        Value::Array(items) => items
            .iter()
            .any(|value| json_contains_component(value, component)),
        _ => false,
    }
}

fn find_component<'a>(node: &'a A2uiNode, component: &str) -> Option<&'a A2uiNode> {
    if node.component == component {
        return Some(node);
    }
    node.children
        .iter()
        .find_map(|child| find_component(child, component))
}

fn find_input<'a>(node: &'a A2uiNode, name: &str) -> Option<&'a A2uiNode> {
    if node.props.get("name").and_then(Value::as_str) == Some(name) {
        return Some(node);
    }
    node.children
        .iter()
        .find_map(|child| find_input(child, name))
}

fn find_title(node: &A2uiNode) -> Option<String> {
    if node.component == "Text"
        && node.props.get("variant").and_then(Value::as_str) == Some("title")
    {
        return node
            .props
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    node.children.iter().find_map(find_title)
}

fn surface_field_value(state: &A2uiSurfaceState, node: &A2uiNode) -> String {
    let name = node
        .props
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let value = state
        .data
        .get(name)
        .or_else(|| node.props.get("value"))
        .or_else(|| node.props.get("checked"))
        .unwrap_or(&Value::Null);
    match node.component.as_str() {
        "Checklist" => checklist_result_value(node, value),
        "Select" => select_result_value(node, value),
        "Checkbox" => {
            if value.as_bool() == Some(true) {
                "是".into()
            } else {
                "否".into()
            }
        }
        _ => value.as_str().unwrap_or("未填写").to_string(),
    }
}

fn checklist_result_value(node: &A2uiNode, value: &Value) -> String {
    let selected = value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<HashSet<_>>();
    let items = node
        .props
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let labels = items
        .iter()
        .filter(|item| {
            item.get("key")
                .and_then(Value::as_str)
                .is_some_and(|key| selected.contains(key))
        })
        .filter_map(|item| item.get("label").and_then(Value::as_str))
        .collect::<Vec<_>>();
    if labels.is_empty() {
        format!("尚未完成（0/{}）", items.len())
    } else {
        format!("{}（{}/{}）", labels.join("、"), labels.len(), items.len())
    }
}

fn select_result_value(node: &A2uiNode, value: &Value) -> String {
    let selected = value.as_str().unwrap_or_default();
    node.props
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|option| option.get("value").and_then(Value::as_str) == Some(selected))
        .and_then(|option| option.get("label").and_then(Value::as_str))
        .unwrap_or(if selected.is_empty() {
            "未填写"
        } else {
            selected
        })
        .to_string()
}

pub fn ensure_surface_by_id(
    storage: &Storage,
    workspace_id: &str,
    surface_id: &str,
) -> Result<ResultDetail, AppError> {
    let surface = storage
        .a2ui_surface(workspace_id, surface_id)?
        .ok_or_else(|| AppError::InvalidInput("Surface 不存在或不属于当前工作区".into()))?;
    ensure_surface_result(storage, &surface)
}

pub fn ensure_portable_surface_by_id(
    storage: &Storage,
    workspace_id: &str,
    surface_id: &str,
) -> Result<Option<ResultDetail>, AppError> {
    let surface = storage
        .a2ui_surface(workspace_id, surface_id)?
        .ok_or_else(|| AppError::InvalidInput("Surface 不存在或不属于当前工作区".into()))?;
    if surface_tool_snapshot(&surface.state_json)?.is_none() {
        return Ok(None);
    }
    ensure_surface_result(storage, &surface).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::result::{
        CreateTextResultInput, RestoreResultRevisionInput, SaveResultDocumentInput,
        SaveResultDraftInput, TextResultFormat,
    };
    use crate::storage::Storage;

    #[test]
    fn managed_results_directory_is_always_below_app_data() {
        let app_data = tempfile::tempdir().unwrap();
        let directory = prepare_managed_results_dir(app_data.path()).unwrap();

        assert!(directory.starts_with(app_data.path()));
        assert_eq!(directory.file_name().unwrap(), "my-results");
        assert!(directory.is_dir());
    }

    #[test]
    fn creates_reopens_saves_restores_and_duplicates_managed_text_results() {
        let storage = Storage::open_in_memory().unwrap();
        storage.set_telemetry_settings(true, false).unwrap();
        let output = tempfile::tempdir().unwrap();
        let created = create_text(
            &storage,
            output.path(),
            CreateTextResultInput {
                title: "项目记录".into(),
                file_name: "项目记录.md".into(),
                result_type: ResultType::Document,
                format: TextResultFormat::Markdown,
            },
        )
        .unwrap();
        assert!(output.path().join("项目记录.md").is_file());
        assert!(created.result.summary.current_revision_id.is_some());
        assert!(created.content.starts_with("# 项目记录"));

        let updated = save_document(
            &storage,
            output.path(),
            SaveResultDocumentInput {
                result_id: created.result.summary.id.clone(),
                content: "# 项目记录\n\n第二版".into(),
                base_hash: created.content_hash.clone(),
            },
        )
        .unwrap();
        assert_eq!(updated.content, "# 项目记录\n\n第二版");
        let revisions =
            list_revisions(&storage, output.path(), &created.result.summary.id).unwrap();
        assert_eq!(revisions.len(), 2);
        let initial = revisions
            .iter()
            .find(|item| item.source == "initial")
            .unwrap();
        let restored = restore_revision(
            &storage,
            output.path(),
            RestoreResultRevisionInput {
                result_id: created.result.summary.id.clone(),
                revision_id: initial.id.clone(),
                base_hash: updated.content_hash,
            },
        )
        .unwrap();
        assert_eq!(restored.content, created.content);

        let copy = duplicate(&storage, output.path(), &created.result.summary.id).unwrap();
        assert_eq!(
            super::super::telemetry::get_settings(&storage)
                .unwrap()
                .event_counts["result_created"],
            2
        );
        assert_ne!(copy.result.summary.id, created.result.summary.id);
        assert_eq!(copy.content, restored.content);
        assert!(copy.result.summary.title.ends_with(" - 副本"));
        assert_eq!(storage.results(None, false).unwrap().len(), 2);
        assert!(storage.recent_workspaces(10).unwrap().is_empty());
    }

    #[test]
    fn result_draft_survives_reopen_and_never_overwrites_an_external_change() {
        let storage = Storage::open_in_memory().unwrap();
        let output = tempfile::tempdir().unwrap();
        let created = create_text(
            &storage,
            output.path(),
            CreateTextResultInput {
                title: "恢复内容".into(),
                file_name: "recover.md".into(),
                result_type: ResultType::Document,
                format: TextResultFormat::Markdown,
            },
        )
        .unwrap();
        save_draft(
            &storage,
            output.path(),
            SaveResultDraftInput {
                result_id: created.result.summary.id.clone(),
                content: "# 尚未保存\n".into(),
                base_hash: created.content_hash.clone(),
            },
        )
        .unwrap();

        let reopened = read_document(&storage, output.path(), &created.result.summary.id).unwrap();
        assert_eq!(reopened.content, created.content);
        assert_eq!(
            reopened.recovery_draft.as_ref().unwrap().content,
            "# 尚未保存\n"
        );
        assert!(!reopened.recovery_draft.as_ref().unwrap().conflicted);

        fs::write(output.path().join("recover.md"), "# 外部修改\n").unwrap();
        let conflicted =
            read_document(&storage, output.path(), &created.result.summary.id).unwrap();
        assert_eq!(conflicted.content, "# 外部修改\n");
        assert!(conflicted.recovery_draft.unwrap().conflicted);
        assert_eq!(
            fs::read_to_string(output.path().join("recover.md")).unwrap(),
            "# 外部修改\n"
        );
    }

    #[test]
    fn registering_a_workspace_result_records_creation_once_only_when_enabled() {
        let storage = Storage::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("test.md"), "test").unwrap();
        let workspace = workspace::register_workspace(&storage, directory.path()).unwrap();
        let document = workspace::read_file(&storage, &workspace.id, "test.md").unwrap();
        storage.set_telemetry_settings(true, false).unwrap();
        let first = ensure_file_result(&storage, &workspace.id, &document).unwrap();
        let reopened = ensure_file_result(&storage, &workspace.id, &document).unwrap();
        assert_eq!(first.summary.id, reopened.summary.id);
        assert_eq!(
            super::super::telemetry::get_settings(&storage)
                .unwrap()
                .event_counts["result_created"],
            1
        );
        storage.set_telemetry_settings(false, false).unwrap();
        fs::write(directory.path().join("off.md"), "test").unwrap();
        let document = workspace::read_file(&storage, &workspace.id, "off.md").unwrap();
        ensure_file_result(&storage, &workspace.id, &document).unwrap();
        assert_eq!(
            super::super::telemetry::get_settings(&storage)
                .unwrap()
                .local_event_count,
            0
        );
    }

    #[test]
    fn all_result_adapters_share_save_revision_and_copy_protocols() {
        let storage = Storage::open_in_memory().unwrap();
        let output = tempfile::tempdir().unwrap();
        let cases = [
            (
                ResultType::Spreadsheet,
                TextResultFormat::Csv,
                "table.csv",
                "Name,Count\nAlpha,2\n",
            ),
            (
                ResultType::Checklist,
                TextResultFormat::Json,
                "checklist.json",
                r#"{"items":[{"id":"one","text":"核对合同","completed":true}]}"#,
            ),
            (
                ResultType::Form,
                TextResultFormat::Json,
                "form.json",
                r#"{"fields":[{"id":"name","label":"姓名","kind":"text","required":true}]}"#,
            ),
            (
                ResultType::Tool,
                TextResultFormat::Json,
                "tool.json",
                r#"{"settings":[{"key":"limit","label":"上限","value":"20"}]}"#,
            ),
        ];

        for (result_type, format, file_name, updated_content) in cases {
            let created = create_text(
                &storage,
                output.path(),
                CreateTextResultInput {
                    title: format!("{result_type:?}"),
                    file_name: file_name.into(),
                    result_type,
                    format,
                },
            )
            .unwrap();
            assert_eq!(created.result.summary.result_type, result_type);
            assert_eq!(created.format, format);

            let saved = save_document(
                &storage,
                output.path(),
                SaveResultDocumentInput {
                    result_id: created.result.summary.id.clone(),
                    content: updated_content.into(),
                    base_hash: created.content_hash,
                },
            )
            .unwrap();
            assert_eq!(saved.content, updated_content);
            assert_eq!(
                list_revisions(&storage, output.path(), &saved.result.summary.id)
                    .unwrap()
                    .len(),
                2
            );
            let copy = duplicate(&storage, output.path(), &saved.result.summary.id).unwrap();
            assert_eq!(copy.result.summary.result_type, result_type);
            assert_eq!(copy.content, updated_content);
        }
    }

    #[test]
    fn rejects_type_format_mismatches_and_invalid_structured_content() {
        let storage = Storage::open_in_memory().unwrap();
        let output = tempfile::tempdir().unwrap();
        assert!(matches!(
            create_text(
                &storage,
                output.path(),
                CreateTextResultInput {
                    title: "错误表格".into(),
                    file_name: "wrong.json".into(),
                    result_type: ResultType::Spreadsheet,
                    format: TextResultFormat::Json,
                },
            ),
            Err(AppError::InvalidInput(_))
        ));

        let checklist = create_text(
            &storage,
            output.path(),
            CreateTextResultInput {
                title: "安全清单".into(),
                file_name: "safe.json".into(),
                result_type: ResultType::Checklist,
                format: TextResultFormat::Json,
            },
        )
        .unwrap();
        assert!(matches!(
            save_document(
                &storage,
                output.path(),
                SaveResultDocumentInput {
                    result_id: checklist.result.summary.id,
                    content: r#"{"items":[{"id":"same","text":"一","completed":false},{"id":"same","text":"二","completed":false}]}"#.into(),
                    base_hash: checklist.content_hash,
                },
            ),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn opens_a2ui_tool_results_as_read_only_auto_saved_snapshots() {
        let storage = Storage::open_in_memory().unwrap();
        let output = tempfile::tempdir().unwrap();
        let workspace = storage
            .upsert_workspace("tool-workspace", "Tool", "C:\\tool")
            .unwrap();
        let session = storage
            .create_session(
                &workspace.id,
                "550e8400-e29b-41d4-a716-446655440090",
                "Tool session",
            )
            .unwrap();
        let state_json = r#"{"surfaceId":"tool","revision":1,"root":{"id":"root","component":"Text","text":"safe"},"data":{}}"#;
        storage
            .save_a2ui_surface(
                "surface-tool-row",
                "tool",
                &workspace.id,
                &session.id,
                "message-tool",
                "1.0",
                1,
                state_json,
                "{}",
                r#"{"valid":true,"errors":[],"warnings":[],"durationMs":1}"#,
                "inspection-tool",
                1,
            )
            .unwrap();
        let result = ensure_surface_by_id(&storage, &workspace.id, "tool").unwrap();
        let snapshot = read_document(&storage, output.path(), &result.summary.id).unwrap();
        assert_eq!(snapshot.result.summary.result_type, ResultType::Tool);
        assert_eq!(snapshot.format, TextResultFormat::Json);
        assert!(!snapshot.editable);
        assert!(snapshot.content.contains("surfaceId"));
    }

    #[test]
    fn portable_a2ui_tools_create_readable_revisions_for_export() {
        let storage = Storage::open_in_memory().unwrap();
        let output = tempfile::tempdir().unwrap();
        let workspace = storage
            .upsert_workspace("portable-tool-workspace", "Tool", "C:\\portable-tool")
            .unwrap();
        let session = storage
            .create_session(
                &workspace.id,
                "550e8400-e29b-41d4-a716-446655440091",
                "Portable tool session",
            )
            .unwrap();
        let state = |selected: serde_json::Value| {
            json!({
                "protocolVersion":"v0.9.1",
                "catalogId":"urn:a2ui-terminal:catalog:basic:v1",
                "surfaceId":"release-checklist",
                "revision":1,
                "root":{
                    "id":"root","component":"Column","props":{"gap":"md"},"children":[
                        {"id":"title","component":"Text","props":{"text":"发布检查表","variant":"title"}},
                        {"id":"items","component":"Checklist","props":{"name":"doneItems","label":"检查项目","items":[{"key":"review","label":"完成评审"},{"key":"release","label":"准备发布"}]},"actions":{"change":{"type":"set_state","target":"doneItems"}}},
                        {"id":"result","component":"ResultSummary","props":{"title":"当前检查结果","fields":["doneItems"]}}
                    ]
                },
                "data":{"doneItems":selected}
            })
            .to_string()
        };
        storage
            .save_a2ui_surface(
                "surface-portable-row",
                "release-checklist",
                &workspace.id,
                &session.id,
                "message-portable",
                "v0.9.1",
                1,
                &state(json!(["review"])),
                "{}",
                r#"{"valid":true,"errors":[],"warnings":[],"durationMs":1}"#,
                "inspection-portable",
                1,
            )
            .unwrap();

        let first = ensure_surface_by_id(&storage, &workspace.id, "release-checklist").unwrap();
        let first_revision = first.summary.current_revision_id.clone().unwrap();
        let first_document = read_document(&storage, output.path(), &first.summary.id).unwrap();
        assert_eq!(first_document.result.summary.title, "发布检查表");
        assert!(first_document.content.contains("完成评审（1/2）"));
        assert!(!first_document.content.contains("surfaceId"));
        assert!(!first_document.content.contains("ResultSummary"));

        storage
            .record_a2ui_action(
                "surface-portable-row",
                Some(&state(json!(["review", "release"]))),
                "event-portable",
                "items",
                "change",
                "set_state",
                "low",
                "allowed",
                r#"["review","release"]"#,
                1,
            )
            .unwrap();
        let second = ensure_surface_by_id(&storage, &workspace.id, "release-checklist").unwrap();
        assert_ne!(
            second.summary.current_revision_id.as_deref(),
            Some(first_revision.as_str())
        );
        let second_document = read_document(&storage, output.path(), &second.summary.id).unwrap();
        assert!(second_document
            .content
            .contains("完成评审、准备发布（2/2）"));
        assert_eq!(
            list_revisions(&storage, output.path(), &second.summary.id)
                .unwrap()
                .len(),
            2
        );

        let prepared = crate::application::export::prepare(
            &storage,
            output.path(),
            &crate::domain::export::ExportResultInput {
                export_id: Uuid::new_v4().to_string(),
                result_id: second.summary.id,
                revision_id: second.summary.current_revision_id.unwrap(),
                format: crate::domain::export::ExportFormat::Json,
            },
        )
        .unwrap();
        assert_eq!(prepared.content, second_document.content);

        let revision_ref = second.storage_ref.clone();
        assert!(storage
            .delete_a2ui_surface(&workspace.id, "release-checklist")
            .unwrap());
        assert!(storage
            .document_versions(&workspace.id, &revision_ref, 10)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_unsafe_names_wrong_extensions_conflicts_and_silent_overwrite() {
        let storage = Storage::open_in_memory().unwrap();
        let output = tempfile::tempdir().unwrap();
        for file_name in [
            "../secret.md",
            "nested/secret.md",
            "C:\\secret.md",
            "secret.exe",
            "CON.md",
        ] {
            assert!(matches!(
                create_text(
                    &storage,
                    output.path(),
                    CreateTextResultInput {
                        title: "安全测试".into(),
                        file_name: file_name.into(),
                        result_type: ResultType::Document,
                        format: TextResultFormat::Markdown,
                    },
                ),
                Err(AppError::InvalidInput(_))
            ));
        }
        let created = create_text(
            &storage,
            output.path(),
            CreateTextResultInput {
                title: "不可覆盖".into(),
                file_name: "不可覆盖.txt".into(),
                result_type: ResultType::Document,
                format: TextResultFormat::PlainText,
            },
        )
        .unwrap();
        assert!(matches!(
            create_text(
                &storage,
                output.path(),
                CreateTextResultInput {
                    title: "另一个成果".into(),
                    file_name: "不可覆盖.txt".into(),
                    result_type: ResultType::Document,
                    format: TextResultFormat::PlainText,
                },
            ),
            Err(AppError::InvalidInput(_))
        ));
        assert_eq!(
            fs::read_to_string(output.path().join("不可覆盖.txt")).unwrap(),
            created.content
        );
        assert!(matches!(
            save_document(
                &storage,
                output.path(),
                SaveResultDocumentInput {
                    result_id: created.result.summary.id,
                    content: "外部冲突后内容".into(),
                    base_hash: "0".repeat(64),
                },
            ),
            Err(AppError::FileConflict)
        ));
    }
}
