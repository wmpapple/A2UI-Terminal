use crate::application::workspace as workspace_service;
use crate::document_source::{self, DocumentSourceKind};
use crate::domain::import::{
    ConfirmImportInput, ImportBatch, ImportBatchStatus, ImportCapability, ImportConfirmation,
    ImportDropTarget, ImportItem, ImportItemStatus, SetImportDropTargetInput,
};
use crate::error::AppError;
use crate::security::{is_hidden_path, is_sensitive_path};
use crate::storage::{NewWorkspaceFileRow, Storage, WorkspaceFileRow};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const MAX_IMPORT_FILES: usize = 20;
pub const MAX_IMPORT_BATCH_BYTES: u64 = 100 * 1024 * 1024;
pub const MAX_IMPORT_DROP_TARGETS: usize = 8;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 2_000;
const MAX_ARCHIVE_EXPANDED_BYTES: u64 = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES: u64 = 25 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 100;

#[derive(Debug, Clone)]
pub struct PendingImportSource {
    pub item_id: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct PendingImportBatch {
    pub batch: ImportBatch,
    pub workspace_id: Option<String>,
    pub sources: Vec<PendingImportSource>,
}

pub struct ConfirmedImport {
    pub response: ImportConfirmation,
    pub authorized_paths: Vec<(String, PathBuf)>,
}

struct AttachedImportSources {
    documents: Vec<crate::workspace::WorkspaceDocument>,
    sources: Vec<crate::document_source::DocumentSource>,
    authorized_paths: Vec<(String, PathBuf)>,
}

struct PreparedAttachedSource {
    absolute_path: String,
    proposed_source_id: String,
    virtual_path: String,
    source: crate::document_source::DocumentSource,
    document: Option<crate::workspace::WorkspaceDocument>,
}

pub fn update_drop_target(
    targets: &mut HashMap<String, ImportDropTarget>,
    input: SetImportDropTargetInput,
) -> Result<(), AppError> {
    let (target_id, target) = input.into_target()?;
    if let Some(target) = target {
        if !targets.contains_key(&target_id) && targets.len() >= MAX_IMPORT_DROP_TARGETS {
            return Err(AppError::InvalidInput(format!(
                "最多只能注册 {MAX_IMPORT_DROP_TARGETS} 个拖放目标"
            )));
        }
        targets.insert(target_id, target);
    } else {
        targets.remove(&target_id);
    }
    Ok(())
}

pub fn find_drop_target(
    targets: &HashMap<String, ImportDropTarget>,
    x: f64,
    y: f64,
) -> Option<ImportDropTarget> {
    targets
        .values()
        .filter(|target| target.contains(x, y))
        .min_by(|left, right| left.area().total_cmp(&right.area()))
        .cloned()
}

pub fn inspect_paths(
    paths: Vec<PathBuf>,
    workspace_id: Option<String>,
) -> Result<PendingImportBatch, AppError> {
    if paths.is_empty() {
        return Err(AppError::InvalidInput("导入批次不能为空".into()));
    }
    if paths.len() > MAX_IMPORT_FILES {
        return Err(AppError::InvalidInput(format!(
            "一次最多选择 {MAX_IMPORT_FILES} 个文件"
        )));
    }

    let mut sources = Vec::with_capacity(paths.len());
    let mut items = Vec::with_capacity(paths.len());
    let mut seen = HashSet::new();
    let mut total_size_bytes = 0_u64;
    for path in paths {
        let canonical = path.canonicalize()?;
        if !canonical.is_file() || !seen.insert(canonical.clone()) {
            continue;
        }
        let item_id = Uuid::new_v4().to_string();
        let item = inspect_source(&canonical, &item_id)?;
        total_size_bytes = total_size_bytes
            .checked_add(item.size_bytes)
            .ok_or_else(|| AppError::InvalidInput("导入批次大小溢出".into()))?;
        sources.push(PendingImportSource {
            item_id: item_id.clone(),
            path: canonical,
        });
        items.push(item);
    }
    if items.is_empty() {
        return Err(AppError::InvalidInput("没有可检查的本地文件".into()));
    }

    let over_batch_limit = total_size_bytes > MAX_IMPORT_BATCH_BYTES;
    let ready_count = items
        .iter()
        .filter(|item| item.status == ImportItemStatus::Ready)
        .count();
    let can_confirm = ready_count > 0 && !over_batch_limit;
    let (failure_code, failure_reason) = if over_batch_limit {
        (
            Some("BATCH_TOO_LARGE".into()),
            Some("所选文件总大小超过 100 MB；请拆分为多个批次".into()),
        )
    } else if ready_count == 0 {
        (
            Some("NO_READY_SOURCE".into()),
            Some("当前批次没有可在本阶段读取的文件；请查看每项替代方式".into()),
        )
    } else {
        (None, None)
    };
    Ok(PendingImportBatch {
        batch: ImportBatch {
            id: Uuid::new_v4().to_string(),
            status: if can_confirm {
                ImportBatchStatus::AwaitingConfirmation
            } else {
                ImportBatchStatus::Blocked
            },
            items,
            total_size_bytes,
            max_files: MAX_IMPORT_FILES,
            max_batch_bytes: MAX_IMPORT_BATCH_BYTES,
            can_confirm,
            failure_code,
            failure_reason,
        },
        workspace_id,
        sources,
    })
}

pub fn confirm(
    storage: &Storage,
    pending: &PendingImportBatch,
    input: ConfirmImportInput,
) -> Result<ConfirmedImport, AppError> {
    if input.batch_id != pending.batch.id {
        return Err(AppError::InvalidInput("导入批次不存在或已经失效".into()));
    }
    if !input.confirmed {
        let mut batch = pending.batch.clone();
        batch.status = ImportBatchStatus::Cancelled;
        batch.can_confirm = false;
        return Ok(ConfirmedImport {
            response: ImportConfirmation {
                batch,
                workspace: None,
                documents: Vec::new(),
                sources: Vec::new(),
            },
            authorized_paths: Vec::new(),
        });
    }
    if !pending.batch.can_confirm || pending.batch.status != ImportBatchStatus::AwaitingConfirmation
    {
        return Err(AppError::InvalidInput("当前导入批次不能确认".into()));
    }
    if input.accepted_item_ids.is_empty() || input.accepted_item_ids.len() > MAX_IMPORT_FILES {
        return Err(AppError::InvalidInput("请至少确认一个可读取文件".into()));
    }
    let accepted: HashSet<_> = input.accepted_item_ids.iter().collect();
    if accepted.len() != input.accepted_item_ids.len() {
        return Err(AppError::InvalidInput("导入文件标识不能重复".into()));
    }
    let items: HashMap<_, _> = pending
        .batch
        .items
        .iter()
        .map(|item| (&item.id, item))
        .collect();
    for item_id in &input.accepted_item_ids {
        let item = items
            .get(item_id)
            .ok_or_else(|| AppError::InvalidInput("导入文件不属于当前批次".into()))?;
        if item.status != ImportItemStatus::Ready || !item.readable {
            return Err(AppError::InvalidInput(format!(
                "{} 当前不可读取，不能加入资料",
                item.name
            )));
        }
    }

    let mut confirmed_sources = Vec::with_capacity(accepted.len());
    let mut confirmed_size = 0_u64;
    for source in &pending.sources {
        if !accepted.contains(&source.item_id) {
            continue;
        }
        let current = inspect_source(&source.path, &source.item_id)?;
        if current.status != ImportItemStatus::Ready || !current.readable {
            return Err(AppError::InvalidInput(format!(
                "{} 在确认前发生变化，已停止导入",
                current.name
            )));
        }
        confirmed_size = confirmed_size
            .checked_add(current.size_bytes)
            .ok_or_else(|| AppError::InvalidInput("确认的文件总大小溢出".into()))?;
        confirmed_sources.push(source);
    }
    if confirmed_size > MAX_IMPORT_BATCH_BYTES {
        return Err(AppError::InvalidInput(
            "文件在确认前发生变化且总大小超过 100 MB，已停止导入".into(),
        ));
    }
    let workspace =
        workspace_service::resolve_context_workspace(storage, pending.workspace_id.as_deref())?;
    let attached = attach_confirmed_sources(storage, &workspace.id, &confirmed_sources)?;
    let mut batch = pending.batch.clone();
    batch.status = ImportBatchStatus::Confirmed;
    batch.can_confirm = false;
    Ok(ConfirmedImport {
        response: ImportConfirmation {
            batch,
            workspace: Some(workspace),
            documents: attached.documents,
            sources: attached.sources,
        },
        authorized_paths: attached.authorized_paths,
    })
}

fn attach_confirmed_sources(
    storage: &Storage,
    workspace_id: &str,
    confirmed_sources: &[&PendingImportSource],
) -> Result<AttachedImportSources, AppError> {
    let mut prepared = Vec::with_capacity(confirmed_sources.len());
    for source in confirmed_sources {
        let canonical = source.path.canonicalize()?;
        let absolute_path = canonical.to_string_lossy().into_owned();
        let source_id = Uuid::new_v4().to_string();
        let name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("selected-file");
        let virtual_path = format!("selected/{source_id}/{name}");
        let proposed_row = WorkspaceFileRow {
            source_id: source_id.clone(),
            workspace_id: workspace_id.to_string(),
            absolute_path: absolute_path.clone(),
            virtual_path: virtual_path.clone(),
        };
        let described = document_source::describe_authorized_source(&proposed_row)?;
        let document = if described.kind == DocumentSourceKind::Text {
            Some(crate::workspace::read_selected_file(
                &canonical, &source_id,
            )?)
        } else {
            None
        };
        prepared.push(PreparedAttachedSource {
            absolute_path,
            proposed_source_id: source_id,
            virtual_path,
            source: described,
            document,
        });
    }
    let inputs = prepared
        .iter()
        .map(|prepared| NewWorkspaceFileRow {
            source_id: &prepared.proposed_source_id,
            absolute_path: &prepared.absolute_path,
            virtual_path: &prepared.virtual_path,
        })
        .collect::<Vec<_>>();
    let rows = storage.attach_workspace_files(workspace_id, &inputs)?;
    let mut documents = Vec::new();
    let mut sources = Vec::with_capacity(rows.len());
    let mut authorized_paths = Vec::with_capacity(rows.len());
    for (row, prepared) in rows.into_iter().zip(prepared) {
        let path = PathBuf::from(&row.absolute_path);
        let mut source = prepared.source;
        source.id = row.source_id.clone();
        source.workspace_id = row.workspace_id.clone();
        if let Some(mut document) = prepared.document {
            document.source_id = Some(row.source_id.clone());
            document.path = row.virtual_path.clone();
            documents.push(document);
        }
        authorized_paths.push((row.source_id.clone(), path));
        sources.push(source);
    }
    Ok(AttachedImportSources {
        documents,
        sources,
        authorized_paths,
    })
}

fn inspect_source(path: &Path, item_id: &str) -> Result<ImportItem, AppError> {
    let metadata = fs::metadata(path)?;
    let size_bytes = metadata.len();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("selected-file")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let base = |capability, status, readable, editable| ImportItem {
        id: item_id.to_string(),
        name: name.clone(),
        extension: extension.clone(),
        size_bytes,
        capability,
        status,
        readable,
        editable,
        reason_code: None,
        reason: None,
        alternative: None,
        warnings: Vec::new(),
    };
    if is_sensitive_path(path) || is_hidden_path(path) || has_hidden_attribute(&metadata) {
        return Ok(rejected(
            base(
                ImportCapability::Unsupported,
                ImportItemStatus::Rejected,
                false,
                false,
            ),
            "SENSITIVE_OR_HIDDEN_PATH",
            "隐藏文件、密钥或敏感路径不会加入导入批次",
            "请改用不包含密钥的脱敏副本",
        ));
    }

    match extension.as_str() {
        "css" | "html" | "js" | "json" | "jsx" | "md" | "mjs" | "py" | "toml" | "ts" | "tsx"
        | "txt" | "yaml" | "yml" => {
            if size_bytes > MAX_TEXT_BYTES {
                return Ok(too_large(
                    base(
                        ImportCapability::EditableText,
                        ImportItemStatus::Rejected,
                        false,
                        false,
                    ),
                    MAX_TEXT_BYTES,
                ));
            }
            let bytes = fs::read(path)?;
            if std::str::from_utf8(&bytes).is_err() {
                return Ok(rejected(
                    base(
                        ImportCapability::EditableText,
                        ImportItemStatus::Rejected,
                        false,
                        false,
                    ),
                    "INVALID_UTF8",
                    "文本文件不是有效 UTF-8",
                    "请另存为 UTF-8 文本后重试",
                ));
            }
            Ok(base(
                ImportCapability::EditableText,
                ImportItemStatus::Ready,
                true,
                true,
            ))
        }
        "docx" => {
            let item = inspect_zip_document(
                path,
                base(
                    ImportCapability::ReadOnlyText,
                    ImportItemStatus::Ready,
                    true,
                    false,
                ),
                "word/document.xml",
            )?;
            if item.status == ImportItemStatus::Rejected {
                Ok(item)
            } else if crate::workspace::read_selected_file(path, item_id).is_err() {
                Ok(rejected(
                    item,
                    "DOCX_EXTRACTION_FAILED",
                    "DOCX 正文无法安全读取",
                    "请使用可信应用重新保存，或导出为 UTF-8 文本/PDF",
                ))
            } else {
                Ok(item)
            }
        }
        "pdf" => {
            if size_bytes > MAX_DOCUMENT_BYTES {
                return Ok(too_large(
                    base(
                        ImportCapability::ReadOnlyText,
                        ImportItemStatus::Rejected,
                        false,
                        false,
                    ),
                    MAX_DOCUMENT_BYTES,
                ));
            }
            let mut file = fs::File::open(path)?;
            let mut header = [0_u8; 5];
            if file.read_exact(&mut header).is_err() || &header != b"%PDF-" {
                return Ok(rejected(
                    base(
                        ImportCapability::ReadOnlyText,
                        ImportItemStatus::Rejected,
                        false,
                        false,
                    ),
                    "INVALID_PDF",
                    "文件扩展名是 PDF，但内容签名无效",
                    "请使用有效 PDF，扫描件可保留作后续只读/OCR 上下文",
                ));
            }
            let bytes = fs::read(path)?;
            let extracted = match pdf_extract::extract_text_from_mem(&bytes) {
                Ok(text) => text,
                Err(_) => {
                    return Ok(rejected(
                        base(
                            ImportCapability::ReadOnlyText,
                            ImportItemStatus::Rejected,
                            false,
                            false,
                        ),
                        "PDF_EXTRACTION_FAILED",
                        "PDF 文本层无法安全读取",
                        "请重新导出 PDF；扫描件需要后续 OCR/视觉上下文能力",
                    ))
                }
            };
            if extracted.trim().is_empty() {
                return Ok(rejected(
                    base(
                        ImportCapability::ReadOnlyText,
                        ImportItemStatus::Rejected,
                        false,
                        false,
                    ),
                    "PDF_TEXT_LAYER_MISSING",
                    "PDF 没有可提取文本层，可能是扫描文档",
                    "请使用带文本层的 PDF，或等待后续 OCR/图片上下文能力",
                ));
            }
            let mut item = base(
                ImportCapability::ReadOnlyText,
                ImportItemStatus::Ready,
                true,
                false,
            );
            item.warnings
                .push("PDF 仅提取文本层；扫描页、公式和版式不会无损复刻".into());
            Ok(item)
        }
        "csv" => inspect_table(
            path,
            base(
                ImportCapability::StructuredData,
                ImportItemStatus::Ready,
                true,
                false,
            ),
        ),
        "xlsx" => {
            let item = base(
                ImportCapability::StructuredData,
                ImportItemStatus::Ready,
                true,
                false,
            );
            let item = inspect_zip_document(path, item, "xl/workbook.xml")?;
            if item.status == ImportItemStatus::Rejected {
                Ok(item)
            } else {
                inspect_table(path, item)
            }
        }
        "png" | "jpg" | "jpeg" | "gif" | "webp" => inspect_image(
            path,
            base(
                ImportCapability::VisualContext,
                ImportItemStatus::Ready,
                true,
                false,
            ),
        ),
        _ => Ok(rejected(
            base(
                ImportCapability::Unsupported,
                ImportItemStatus::Rejected,
                false,
                false,
            ),
            "UNSUPPORTED_FORMAT",
            "当前不支持这种文件格式",
            "请转换为 UTF-8 文本、DOCX 或带文本层的 PDF",
        )),
    }
}

#[cfg(windows)]
fn has_hidden_attribute(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x2 != 0
}

#[cfg(not(windows))]
fn has_hidden_attribute(_: &fs::Metadata) -> bool {
    false
}

fn inspect_table(path: &Path, mut item: ImportItem) -> Result<ImportItem, AppError> {
    let limit = if item.extension == "csv" {
        document_source::MAX_CSV_BYTES
    } else {
        document_source::MAX_XLSX_BYTES
    };
    if item.size_bytes > limit {
        return Ok(too_large(item, limit));
    }
    match document_source::validate_table(path) {
        Ok(summary) => {
            item.warnings.push(format!(
                "基础数据读取上限：{} 个工作表、每表 {} 行/{} 列、共 {} 个单元格、单元格 {} 字符",
                summary.limits.max_sheets,
                summary.limits.max_rows_per_sheet,
                summary.limits.max_columns_per_sheet,
                summary.limits.max_cells_total,
                summary.limits.max_cell_chars
            ));
            item.warnings
                .push("只读基础数据；公式不计算，宏不执行，外部链接不访问".into());
            if summary.formula_injection_risk_cell_count > 0 {
                item.warnings.push(format!(
                    "检测到 {} 个公式或公式注入风险单元格；原值保留，未来导出必须转义",
                    summary.formula_injection_risk_cell_count
                ));
            }
            Ok(item)
        }
        Err(error) => Ok(rejected(
            item,
            "TABLE_PARSE_FAILED",
            &error.public_message(),
            "请缩小表格或使用可信应用重新保存为 UTF-8 CSV / 标准 XLSX",
        )),
    }
}

fn inspect_image(path: &Path, item: ImportItem) -> Result<ImportItem, AppError> {
    if item.size_bytes > MAX_IMAGE_BYTES {
        return Ok(too_large(item, MAX_IMAGE_BYTES));
    }
    let mut file = fs::File::open(path)?;
    let mut header = [0_u8; 12];
    let read = file.read(&mut header)?;
    let valid = match item.extension.as_str() {
        "png" => read >= 8 && header[..8] == [137, 80, 78, 71, 13, 10, 26, 10],
        "jpg" | "jpeg" => read >= 3 && header[..3] == [0xff, 0xd8, 0xff],
        "gif" => read >= 6 && (&header[..6] == b"GIF87a" || &header[..6] == b"GIF89a"),
        "webp" => read >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP",
        _ => false,
    };
    if !valid {
        return Ok(rejected(
            item,
            "INVALID_IMAGE",
            "图片扩展名与文件内容不匹配",
            "请使用有效 PNG、JPEG、GIF 或 WebP 文件",
        ));
    }
    match document_source::validate_image(path) {
        Ok(summary) => {
            let mut item = item;
            item.warnings.push(format!(
                "原始视觉信息将按 {}×{} 保留；不使用 OCR 文本假装理解图片",
                summary.width, summary.height
            ));
            item.warnings
                .push("当前未连接视觉模型；图片不会发送，后续发送前仍需确认上下文范围".into());
            Ok(item)
        }
        Err(error) => Ok(rejected(
            item,
            "IMAGE_METADATA_INVALID",
            &error.public_message(),
            "请使用尺寸不超过 32768 像素边长和 4000 万像素的有效图片",
        )),
    }
}

fn inspect_zip_document(
    path: &Path,
    mut item: ImportItem,
    required_entry: &str,
) -> Result<ImportItem, AppError> {
    if item.size_bytes > MAX_DOCUMENT_BYTES {
        return Ok(too_large(item, MAX_DOCUMENT_BYTES));
    }
    let file = fs::File::open(path)?;
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(_) => {
            return Ok(rejected(
                item,
                "INVALID_OFFICE_PACKAGE",
                "Office 文件不是有效的压缩包",
                "请重新保存为有效 DOCX/XLSX，或导出为文本/CSV",
            ))
        }
    };
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Ok(rejected(
            item,
            "ARCHIVE_TOO_MANY_ENTRIES",
            "压缩包条目数超过 2000 个安全上限",
            "请移除异常嵌入内容后重新保存",
        ));
    }
    let mut total_expanded = 0_u64;
    let mut total_compressed = 0_u64;
    let mut has_required = false;
    let mut has_macro = false;
    let mut has_external = false;
    let mut has_embedded = false;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| AppError::InvalidInput("无法检查 Office 压缩包".into()))?;
        if entry.enclosed_name().is_none() {
            return Ok(rejected(
                item,
                "ARCHIVE_UNSAFE_PATH",
                "压缩包包含路径穿越条目",
                "请使用可信应用重新保存该文件",
            ));
        }
        let name = entry.name().replace('\\', "/").to_ascii_lowercase();
        has_required |= name == required_entry.to_ascii_lowercase();
        has_macro |= name.ends_with("vbaproject.bin");
        has_external |= name.contains("externallinks") || name.ends_with(".rels");
        has_embedded |= name.contains("/embeddings/") || name.contains("/charts/");
        if entry.size() > MAX_ARCHIVE_ENTRY_BYTES {
            return Ok(rejected(
                item,
                "ARCHIVE_ENTRY_TOO_LARGE",
                "压缩包单个展开条目超过 25 MB",
                "请移除异常或超大嵌入内容后重试",
            ));
        }
        total_expanded = total_expanded
            .checked_add(entry.size())
            .ok_or_else(|| AppError::InvalidInput("压缩包展开大小溢出".into()))?;
        total_compressed = total_compressed
            .checked_add(entry.compressed_size())
            .ok_or_else(|| AppError::InvalidInput("压缩包压缩大小溢出".into()))?;
    }
    if total_expanded > MAX_ARCHIVE_EXPANDED_BYTES
        || (total_expanded > 1024 * 1024
            && total_expanded
                > total_compressed
                    .max(1)
                    .saturating_mul(MAX_COMPRESSION_RATIO))
    {
        return Ok(rejected(
            item,
            "ARCHIVE_BOMB_RISK",
            "压缩包展开量或压缩比超过安全上限",
            "请使用可信应用重新保存并移除异常内容",
        ));
    }
    if !has_required {
        return Ok(rejected(
            item,
            "OFFICE_STRUCTURE_MISSING",
            "Office 文件缺少必要的文档结构",
            "请使用可信应用重新保存为标准 DOCX/XLSX",
        ));
    }
    if has_macro {
        item.warnings.push("检测到宏内容；系统不会执行宏".into());
    }
    if has_external {
        item.warnings
            .push("可能包含外部关系；系统不会自动访问外部链接".into());
    }
    if has_embedded {
        item.warnings
            .push("嵌入对象或图表只读优先，不承诺结构化编辑或无损回写".into());
    }
    if item.capability == ImportCapability::ReadOnlyText {
        item.warnings
            .push("DOCX 只读取正文文本；复杂版式、公式和图表不会无损复刻".into());
    }
    Ok(item)
}

fn too_large(item: ImportItem, limit: u64) -> ImportItem {
    rejected(
        item,
        "FILE_TOO_LARGE",
        &format!("文件超过 {} MB 的安全上限", limit / 1024 / 1024),
        "请拆分或压缩内容后重新选择",
    )
}

fn rejected(mut item: ImportItem, code: &str, reason: &str, alternative: &str) -> ImportItem {
    item.status = ImportItemStatus::Rejected;
    item.readable = false;
    item.editable = false;
    item.reason_code = Some(code.into());
    item.reason = Some(reason.into());
    item.alternative = Some(alternative.into());
    item
}

#[cfg(test)]
mod tests {
    use super::{
        confirm, find_drop_target, inspect_paths, update_drop_target, MAX_IMPORT_DROP_TARGETS,
        MAX_IMPORT_FILES,
    };
    use crate::domain::import::{
        ConfirmImportInput, ImportBatchStatus, ImportDropBounds, ImportItemStatus,
        SetImportDropTargetInput,
    };
    use crate::storage::Storage;
    use std::collections::HashMap;
    use std::fs;
    use std::io::Write;

    #[test]
    fn reports_ready_table_image_sensitive_and_unsupported_sources_without_paths() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("notes.md"), "# notes").unwrap();
        fs::write(directory.path().join("data.csv"), "name,value\na,1\n").unwrap();
        fs::write(directory.path().join(".env"), "API_KEY=secret").unwrap();
        fs::write(directory.path().join("tool.exe"), b"MZ").unwrap();
        let mut png = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
        png.extend_from_slice(&640_u32.to_be_bytes());
        png.extend_from_slice(&480_u32.to_be_bytes());
        fs::write(directory.path().join("image.png"), png).unwrap();
        let pending = inspect_paths(
            ["notes.md", "data.csv", ".env", "tool.exe", "image.png"]
                .map(|name| directory.path().join(name))
                .to_vec(),
            None,
        )
        .unwrap();
        assert_eq!(
            pending.batch.status,
            ImportBatchStatus::AwaitingConfirmation
        );
        assert_eq!(
            pending
                .batch
                .items
                .iter()
                .filter(|item| item.status == ImportItemStatus::Ready)
                .count(),
            3
        );
        assert_eq!(
            pending
                .batch
                .items
                .iter()
                .filter(|item| item.status == ImportItemStatus::Planned)
                .count(),
            0
        );
        let serialized = serde_json::to_string(&pending.batch).unwrap();
        assert!(!serialized.contains(directory.path().to_string_lossy().as_ref()));
        assert!(serialized.contains("SENSITIVE_OR_HIDDEN_PATH"));
        assert!(serialized.contains("UNSUPPORTED_FORMAT"));
    }

    #[test]
    fn rejects_invalid_office_packages_and_archive_bombs() {
        let directory = tempfile::tempdir().unwrap();
        let invalid = directory.path().join("invalid.docx");
        fs::write(&invalid, "not a zip").unwrap();
        let bomb = directory.path().join("bomb.docx");
        let file = fs::File::create(&bomb).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file(
                "word/document.xml",
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(&vec![b'a'; 2 * 1024 * 1024]).unwrap();
        writer.finish().unwrap();
        let pending = inspect_paths(vec![invalid, bomb], None).unwrap();
        assert!(pending
            .batch
            .items
            .iter()
            .all(|item| item.status == ImportItemStatus::Rejected));
        assert!(pending
            .batch
            .items
            .iter()
            .any(|item| item.reason_code.as_deref() == Some("ARCHIVE_BOMB_RISK")));
    }

    #[test]
    fn confirms_only_ready_items_and_cancel_has_zero_authorization() {
        let storage = Storage::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let notes = directory.path().join("notes.txt");
        fs::write(&notes, "safe text").unwrap();
        let pending = inspect_paths(vec![notes], None).unwrap();
        let item_id = pending.batch.items[0].id.clone();
        let cancelled = confirm(
            &storage,
            &pending,
            ConfirmImportInput {
                batch_id: pending.batch.id.clone(),
                accepted_item_ids: vec![item_id.clone()],
                confirmed: false,
            },
        )
        .unwrap();
        assert_eq!(
            cancelled.response.batch.status,
            ImportBatchStatus::Cancelled
        );
        assert!(cancelled.response.workspace.is_none());
        assert!(storage.recent_workspaces(10).unwrap().is_empty());

        let confirmed = confirm(
            &storage,
            &pending,
            ConfirmImportInput {
                batch_id: pending.batch.id.clone(),
                accepted_item_ids: vec![item_id],
                confirmed: true,
            },
        )
        .unwrap();
        assert_eq!(confirmed.response.documents.len(), 1);
        assert_eq!(confirmed.response.sources.len(), 1);
        assert_eq!(confirmed.authorized_paths.len(), 1);
        assert!(!confirmed.response.documents[0]
            .path
            .contains(directory.path().to_string_lossy().as_ref()));
    }

    #[test]
    fn confirms_table_only_batch_as_a_persistent_document_source_without_fake_text() {
        let storage = Storage::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("data.csv");
        fs::write(&table, "name,value\nAlice,10\n").unwrap();
        let pending = inspect_paths(vec![table], None).unwrap();
        let confirmed = confirm(
            &storage,
            &pending,
            ConfirmImportInput {
                batch_id: pending.batch.id.clone(),
                accepted_item_ids: vec![pending.batch.items[0].id.clone()],
                confirmed: true,
            },
        )
        .unwrap();

        assert!(confirmed.response.documents.is_empty());
        assert_eq!(confirmed.response.sources.len(), 1);
        assert_eq!(
            confirmed.response.sources[0].kind,
            crate::document_source::DocumentSourceKind::Table
        );
        let workspace_id = &confirmed.response.workspace.unwrap().id;
        let persisted = crate::document_source::list(&storage, workspace_id).unwrap();
        assert_eq!(persisted.len(), 1);
        let content = crate::document_source::read(&storage, &persisted[0].id).unwrap();
        assert_eq!(content.table_content.unwrap().sheets[0].rows.len(), 2);
    }

    #[test]
    fn rechecks_sources_at_confirmation_to_stop_time_of_check_changes() {
        let storage = Storage::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let notes = directory.path().join("notes.txt");
        fs::write(&notes, "safe text").unwrap();
        let pending = inspect_paths(vec![notes.clone()], None).unwrap();
        fs::write(&notes, [0xff, 0xfe, 0xfd]).unwrap();
        let result = confirm(
            &storage,
            &pending,
            ConfirmImportInput {
                batch_id: pending.batch.id.clone(),
                accepted_item_ids: vec![pending.batch.items[0].id.clone()],
                confirmed: true,
            },
        );
        assert!(result.is_err());
        assert!(storage.recent_workspaces(10).unwrap().is_empty());
    }

    #[test]
    fn enforces_batch_count_before_reading_files() {
        let paths = (0..=MAX_IMPORT_FILES)
            .map(|index| std::path::PathBuf::from(format!("missing-{index}.txt")))
            .collect();
        assert!(inspect_paths(paths, None).is_err());
    }

    #[test]
    fn registers_bounded_drop_targets_and_selects_the_smallest_containing_target() {
        let mut targets = HashMap::new();
        let outer_id = uuid::Uuid::new_v4().to_string();
        let inner_id = uuid::Uuid::new_v4().to_string();
        for (target_id, bounds) in [
            (
                outer_id.clone(),
                ImportDropBounds {
                    left: 10.0,
                    top: 10.0,
                    right: 500.0,
                    bottom: 500.0,
                },
            ),
            (
                inner_id.clone(),
                ImportDropBounds {
                    left: 100.0,
                    top: 100.0,
                    right: 200.0,
                    bottom: 200.0,
                },
            ),
        ] {
            update_drop_target(
                &mut targets,
                SetImportDropTargetInput {
                    target_id,
                    enabled: true,
                    workspace_id: None,
                    bounds: Some(bounds),
                },
            )
            .unwrap();
        }

        assert_eq!(
            find_drop_target(&targets, 150.0, 150.0).unwrap().target_id,
            inner_id
        );
        assert!(find_drop_target(&targets, 700.0, 700.0).is_none());

        update_drop_target(
            &mut targets,
            SetImportDropTargetInput {
                target_id: outer_id.clone(),
                enabled: false,
                workspace_id: None,
                bounds: None,
            },
        )
        .unwrap();
        assert!(!targets.contains_key(&outer_id));
    }

    #[test]
    fn rejects_invalid_or_excess_drop_targets() {
        let mut targets = HashMap::new();
        let invalid = update_drop_target(
            &mut targets,
            SetImportDropTargetInput {
                target_id: "browser-controlled-id".into(),
                enabled: true,
                workspace_id: None,
                bounds: Some(ImportDropBounds {
                    left: 10.0,
                    top: 10.0,
                    right: 5.0,
                    bottom: 20.0,
                }),
            },
        );
        assert!(invalid.is_err());

        for _ in 0..MAX_IMPORT_DROP_TARGETS {
            update_drop_target(
                &mut targets,
                SetImportDropTargetInput {
                    target_id: uuid::Uuid::new_v4().to_string(),
                    enabled: true,
                    workspace_id: None,
                    bounds: Some(ImportDropBounds {
                        left: 0.0,
                        top: 0.0,
                        right: 100.0,
                        bottom: 100.0,
                    }),
                },
            )
            .unwrap();
        }
        assert!(update_drop_target(
            &mut targets,
            SetImportDropTargetInput {
                target_id: uuid::Uuid::new_v4().to_string(),
                enabled: true,
                workspace_id: None,
                bounds: Some(ImportDropBounds {
                    left: 0.0,
                    top: 0.0,
                    right: 100.0,
                    bottom: 100.0,
                }),
            },
        )
        .is_err());
    }
}
