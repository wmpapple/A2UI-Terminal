use crate::domain::result::{
    validate_title, CreateTextResultInput, RestoreResultRevisionInput, ResultDetail,
    ResultDocument, ResultRevision, ResultRevisionSummary, ResultStorageKind, ResultSummary,
    SaveResultDocumentInput, TextResultFormat,
};
use crate::error::AppError;
use crate::repository::result::{detail_from_row, ResultRepository};
use crate::storage::{A2uiSurfaceRow, NewManagedResultRow, ResultSourceRow, Storage};
use crate::workspace::{self, WorkspaceDocument, MAX_TEXT_FILE_BYTES};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

const MANAGED_RESULTS_DIRECTORY: &str = "my-results";
const MANAGED_RESULTS_WORKSPACE_ID: &str = "00000000-0000-4000-8000-000000000001";

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
    let file_name = validate_file_name(&input.file_name, input.format)?;
    let content = match input.format {
        TextResultFormat::Markdown => format!("# {title}\n\n"),
        TextResultFormat::PlainText => format!("{title}\n\n"),
    };
    create_managed_document(
        storage,
        managed_results_dir,
        MANAGED_RESULTS_WORKSPACE_ID,
        &title,
        &file_name,
        input.format,
        &content,
    )
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
    validate_content(&input.content)?;
    validate_hash(&input.base_hash)?;
    let source = result_source(storage, &input.result_id)?;
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
    read_document(storage, managed_results_dir, &input.result_id)
}

pub fn list_revisions(
    storage: &Storage,
    managed_results_dir: &Path,
    result_id: &str,
) -> Result<Vec<ResultRevisionSummary>, AppError> {
    let document = read_document(storage, managed_results_dir, result_id)?;
    let source = result_source(storage, result_id)?;
    Ok(storage
        .document_versions(&source.result.workspace_id, &source.source_ref, 200)?
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
    let revision = storage
        .document_version(&source.result.workspace_id, &source.source_ref, revision_id)?
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
    };
    let file_name = format!("{result_id}.{extension}");
    let title = format!("{} - 副本", source.result.summary.title);
    let title: String = title.chars().take(160).collect();
    create_managed_document(
        storage,
        managed_results_dir,
        MANAGED_RESULTS_WORKSPACE_ID,
        &title,
        &file_name,
        source.format,
        &source.content,
    )
}

fn create_managed_document(
    storage: &Storage,
    managed_results_dir: &Path,
    workspace_id: &str,
    title: &str,
    file_name: &str,
    format: TextResultFormat,
    content: &str,
) -> Result<ResultDocument, AppError> {
    validate_content(content)?;
    storage.ensure_managed_results_workspace(workspace_id)?;
    fs::create_dir_all(managed_results_dir)?;
    let output_path = managed_path(managed_results_dir, file_name, format, false)?;
    let result_id = Uuid::new_v4().to_string();
    let revision_id = Uuid::new_v4().to_string();
    let content_hash = content_hash(content.as_bytes());
    let storage_ref = format!("result://file/{result_id}");
    let managed_state = serde_json::to_string(&json!({ "format": format }))
        .map_err(|_| AppError::StateUnavailable)?;
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
            Err(AppError::InvalidInput(
                "同名成果已存在，未覆盖任何文件".into(),
            ))
        } else {
            let _ = fs::remove_file(&output_path);
            Err(AppError::Io(error))
        };
    }
    let row = match storage.create_managed_text_result(NewManagedResultRow {
        result_id: &result_id,
        workspace_id,
        title,
        storage_ref: &storage_ref,
        source_ref: file_name,
        managed_state_json: &managed_state,
        revision_id: &revision_id,
        content,
        content_hash: &content_hash,
    }) {
        Ok(row) => row,
        Err(error) => {
            let _ = fs::remove_file(&output_path);
            return Err(error);
        }
    };
    Ok(ResultDocument {
        result: detail_from_row(row)?,
        format,
        content: content.to_string(),
        content_hash,
        size_bytes: content.len() as u64,
        editable: true,
    })
}

fn read_from_source(
    storage: &Storage,
    managed_results_dir: &Path,
    source: ResultSourceRow,
) -> Result<ResultDocument, AppError> {
    if source.result.result_type != "document" {
        return Err(AppError::InvalidInput("成果不是文档类型".into()));
    }
    let (format, content, hash, size_bytes, editable) = match source.source_kind.as_str() {
        "managed_local" => {
            let format = format_for_file_name(&source.source_ref)?;
            let path = managed_path(managed_results_dir, &source.source_ref, format, true)?;
            let bytes = read_managed_file(&path)?;
            let content = String::from_utf8(bytes).map_err(|_| AppError::InvalidEncoding)?;
            validate_content(&content)?;
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
        _ => return Err(AppError::InvalidInput("成果不是可编辑的文档".into())),
    };
    let row = storage
        .result(&source.result.id)?
        .ok_or(AppError::StateUnavailable)?;
    Ok(ResultDocument {
        result: detail_from_row(row)?,
        format,
        content,
        content_hash: hash,
        size_bytes,
        editable,
    })
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

fn validate_result_id(value: &str) -> Result<(), AppError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput("成果或版本标识无效".into()))
}

fn validate_file_name(file_name: &str, format: TextResultFormat) -> Result<String, AppError> {
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

fn validate_content(content: &str) -> Result<(), AppError> {
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(AppError::FileTooLarge);
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
    ResultRepository::new(storage).ensure_file(
        &Uuid::new_v4().to_string(),
        workspace_id,
        &document.path,
        title,
        storage_kind,
        current_revision_id.as_deref(),
    )
}

pub fn ensure_surface_result(
    storage: &Storage,
    surface: &A2uiSurfaceRow,
) -> Result<ResultDetail, AppError> {
    let proposed_title = format!("交互成果 {}", surface.surface_id);
    let title = validate_title(&proposed_title)?;
    ResultRepository::new(storage).ensure_surface(
        &Uuid::new_v4().to_string(),
        &surface.id,
        &surface.workspace_id,
        &surface.surface_id,
        &surface.session_id,
        title,
        &surface.state_json,
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::result::{
        CreateTextResultInput, RestoreResultRevisionInput, SaveResultDocumentInput,
        TextResultFormat,
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
        let output = tempfile::tempdir().unwrap();
        let created = create_text(
            &storage,
            output.path(),
            CreateTextResultInput {
                title: "项目记录".into(),
                file_name: "项目记录.md".into(),
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
        assert_ne!(copy.result.summary.id, created.result.summary.id);
        assert_eq!(copy.content, restored.content);
        assert!(copy.result.summary.title.ends_with(" - 副本"));
        assert_eq!(storage.results(None, false).unwrap().len(), 2);
        assert!(storage.recent_workspaces(10).unwrap().is_empty());
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
