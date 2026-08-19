use crate::error::AppError;
use crate::storage::{Storage, WorkspaceFileRow};
use base64::Engine;
use quick_xml::events::Event;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

pub const MAX_CSV_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_XLSX_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_TABLE_SHEETS: usize = 32;
pub const MAX_TABLE_ROWS: usize = 10_000;
pub const MAX_TABLE_COLUMNS: usize = 256;
pub const MAX_TABLE_CELLS: usize = 100_000;
pub const MAX_TABLE_CELL_CHARS: usize = 32_768;
const MAX_LOCAL_IMAGE_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;
const MAX_IMAGE_DIMENSION: u32 = 32_768;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DocumentSourceKind {
    Text,
    Table,
    Image,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DocumentSourceCapability {
    EditableText,
    ReadOnlyText,
    StructuredData,
    VisualContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableLimits {
    pub max_sheets: usize,
    pub max_rows_per_sheet: usize,
    pub max_columns_per_sheet: usize,
    pub max_cells_total: usize,
    pub max_cell_chars: usize,
}

impl Default for TableLimits {
    fn default() -> Self {
        Self {
            max_sheets: MAX_TABLE_SHEETS,
            max_rows_per_sheet: MAX_TABLE_ROWS,
            max_columns_per_sheet: MAX_TABLE_COLUMNS,
            max_cells_total: MAX_TABLE_CELLS,
            max_cell_chars: MAX_TABLE_CELL_CHARS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableSourceSummary {
    pub sheet_names: Vec<String>,
    pub row_count: usize,
    pub column_count: usize,
    pub cell_count: usize,
    pub formula_cell_count: usize,
    pub formula_injection_risk_cell_count: usize,
    pub limits: TableLimits,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageSourceSummary {
    pub width: u32,
    pub height: u32,
    pub animated: bool,
    pub original_preserved: bool,
    pub local_preview_available: bool,
    pub visual_model_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSource {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub extension: String,
    pub kind: DocumentSourceKind,
    pub capability: DocumentSourceCapability,
    pub mime_type: String,
    pub size_bytes: u64,
    pub content_hash: String,
    pub editable: bool,
    pub warnings: Vec<String>,
    pub table: Option<TableSourceSummary>,
    pub image: Option<ImageSourceSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableCell {
    pub value: String,
    pub formula: bool,
    pub formula_injection_risk: bool,
}

impl TableCell {
    fn plain(value: String) -> Self {
        let formula_injection_risk = has_formula_injection_risk(&value);
        Self {
            value,
            formula: false,
            formula_injection_risk,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableSheet {
    pub name: String,
    pub rows: Vec<Vec<TableCell>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableSourceContent {
    pub sheets: Vec<TableSheet>,
    pub limits: TableLimits,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSourceContent {
    pub source: DocumentSource,
    pub text_content: Option<String>,
    pub table_content: Option<TableSourceContent>,
    pub image_data_url: Option<String>,
    pub visual_model_available: bool,
    pub notice: String,
}

pub fn list(storage: &Storage, workspace_id: &str) -> Result<Vec<DocumentSource>, AppError> {
    storage
        .workspace_files(workspace_id)?
        .iter()
        .map(describe_authorized_source)
        .collect()
}

pub fn read(storage: &Storage, source_id: &str) -> Result<DocumentSourceContent, AppError> {
    let row = storage
        .workspace_file_by_source(source_id)?
        .ok_or_else(|| AppError::InvalidInput("资料来源不存在或未授权".into()))?;
    let source = describe_authorized_source(&row)?;
    let path = Path::new(&row.absolute_path);
    match source.kind {
        DocumentSourceKind::Text => {
            let document = crate::workspace::read_selected_file(path, source_id)?;
            Ok(DocumentSourceContent {
                source,
                text_content: Some(document.content),
                table_content: None,
                image_data_url: None,
                visual_model_available: false,
                notice: "这是本机已授权的文本来源；本操作不会把内容发送给模型。".into(),
            })
        }
        DocumentSourceKind::Table => Ok(DocumentSourceContent {
            source,
            text_content: None,
            table_content: Some(parse_table(path)?),
            image_data_url: None,
            visual_model_available: false,
            notice: "表格仅在本机受控解析；公式不会计算，外部链接不会访问。".into(),
        }),
        DocumentSourceKind::Image => {
            let bytes = fs::read(path)?;
            let data_url = if bytes.len() as u64 <= MAX_LOCAL_IMAGE_PREVIEW_BYTES {
                Some(format!(
                    "data:{};base64,{}",
                    source.mime_type,
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ))
            } else {
                None
            };
            let notice = if data_url.is_some() {
                "图片只在本机预览，尚未发送给 AI；使用视觉模型前仍需单独确认上下文范围。"
            } else {
                "图片原始视觉信息已保留，但文件超过 8 MB 本地预览上限；尚未发送给 AI。"
            };
            Ok(DocumentSourceContent {
                source,
                text_content: None,
                table_content: None,
                image_data_url: data_url,
                visual_model_available: false,
                notice: notice.into(),
            })
        }
    }
}

pub fn revoke(storage: &Storage, workspace_id: &str, source_id: &str) -> Result<(), AppError> {
    if workspace_id.trim().is_empty()
        || workspace_id.chars().count() > 128
        || source_id.trim().is_empty()
        || source_id.chars().count() > 128
    {
        return Err(AppError::InvalidInput("资料来源标识无效".into()));
    }
    if !storage.revoke_workspace_file(workspace_id, source_id)? {
        return Err(AppError::InvalidInput(
            "资料来源不存在或未获当前工作区授权".into(),
        ));
    }
    Ok(())
}

pub fn describe_authorized_source(row: &WorkspaceFileRow) -> Result<DocumentSource, AppError> {
    let path = Path::new(&row.absolute_path).canonicalize()?;
    if !path.is_file() {
        return Err(AppError::InvalidInput("已授权资料已不可用".into()));
    }
    let bytes = fs::read(&path)?;
    let size_bytes = bytes.len() as u64;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("selected-file")
        .to_string();
    let extension = extension(&path);
    let (kind, capability, mime_type, editable, table, image, warnings) = match extension.as_str() {
        "csv" | "xlsx" => {
            let table_content = parse_table(&path)?;
            let summary = summarize_table(&table_content);
            let mut warnings = vec![
                "表格按基础数据读取，不承诺公式、格式、图表或宏的无损回写".into(),
                "导出时必须对公式注入风险单元格进行转义".into(),
            ];
            if summary.formula_cell_count > 0 {
                warnings.push("检测到公式；只读取已有值，不执行或重新计算公式".into());
            }
            (
                DocumentSourceKind::Table,
                DocumentSourceCapability::StructuredData,
                if extension == "csv" {
                    "text/csv"
                } else {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
                .into(),
                false,
                Some(summary),
                None,
                warnings,
            )
        }
        "png" | "jpg" | "jpeg" | "gif" | "webp" => {
            let image = inspect_image_bytes(&extension, &bytes)?;
            let mime = match extension.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                _ => "image/webp",
            };
            (
                DocumentSourceKind::Image,
                DocumentSourceCapability::VisualContext,
                mime.into(),
                false,
                None,
                Some(image),
                vec![
                    "保留原始视觉信息，不用 OCR 文本假装理解图片".into(),
                    "当前未连接视觉模型；发送前必须在后续上下文确认中再次授权".into(),
                ],
            )
        }
        "docx" | "pdf" => (
            DocumentSourceKind::Text,
            DocumentSourceCapability::ReadOnlyText,
            if extension == "docx" {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            } else {
                "application/pdf"
            }
            .into(),
            false,
            None,
            None,
            vec!["只读取正文文本；复杂版式、公式和图表不会无损复刻".into()],
        ),
        _ => (
            DocumentSourceKind::Text,
            DocumentSourceCapability::EditableText,
            "text/plain; charset=utf-8".into(),
            true,
            None,
            None,
            Vec::new(),
        ),
    };
    Ok(DocumentSource {
        id: row.source_id.clone(),
        workspace_id: row.workspace_id.clone(),
        name,
        extension,
        kind,
        capability,
        mime_type,
        size_bytes,
        content_hash: sha256(&bytes),
        editable,
        warnings,
        table,
        image,
    })
}

pub fn validate_table(path: &Path) -> Result<TableSourceSummary, AppError> {
    Ok(summarize_table(&parse_table(path)?))
}

pub fn validate_image(path: &Path) -> Result<ImageSourceSummary, AppError> {
    let bytes = fs::read(path)?;
    inspect_image_bytes(&extension(path), &bytes)
}

pub fn parse_table(path: &Path) -> Result<TableSourceContent, AppError> {
    match extension(path).as_str() {
        "csv" => parse_csv(path),
        "xlsx" => parse_xlsx(path),
        _ => Err(AppError::InvalidInput("不是受支持的表格来源".into())),
    }
}

pub fn escape_spreadsheet_formula(value: &str) -> String {
    if has_formula_injection_risk(value) {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

fn parse_csv(path: &Path) -> Result<TableSourceContent, AppError> {
    let bytes = fs::read(path)?;
    if bytes.len() as u64 > MAX_CSV_BYTES {
        return Err(AppError::FileTooLarge);
    }
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(bytes.as_slice());
    let mut rows = Vec::new();
    let mut cells = 0_usize;
    for record in reader.records() {
        let record = record.map_err(|error| {
            AppError::InvalidInput(format!("CSV 不是有效的 UTF-8 或引号结构：{error}"))
        })?;
        if rows.len() >= MAX_TABLE_ROWS {
            return Err(table_limit_error("CSV 行数", MAX_TABLE_ROWS));
        }
        if record.len() > MAX_TABLE_COLUMNS {
            return Err(table_limit_error("CSV 列数", MAX_TABLE_COLUMNS));
        }
        cells = cells
            .checked_add(record.len())
            .ok_or_else(|| AppError::InvalidInput("CSV 单元格数量溢出".into()))?;
        if cells > MAX_TABLE_CELLS {
            return Err(table_limit_error("CSV 单元格数", MAX_TABLE_CELLS));
        }
        let row = record
            .iter()
            .map(|value| {
                if value.chars().count() > MAX_TABLE_CELL_CHARS {
                    return Err(table_limit_error("CSV 单元格字符数", MAX_TABLE_CELL_CHARS));
                }
                Ok(TableCell::plain(value.to_string()))
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        rows.push(row);
    }
    Ok(TableSourceContent {
        sheets: vec![TableSheet {
            name: "CSV".into(),
            rows,
        }],
        limits: TableLimits::default(),
    })
}

fn parse_xlsx(path: &Path) -> Result<TableSourceContent, AppError> {
    if path.metadata()?.len() > MAX_XLSX_BYTES {
        return Err(AppError::FileTooLarge);
    }
    let file = fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| AppError::InvalidInput("XLSX 不是有效的 Office 压缩包".into()))?;
    let shared_strings = match read_zip_entry(&mut archive, "xl/sharedStrings.xml")? {
        Some(xml) => parse_shared_strings(&xml)?,
        None => Vec::new(),
    };
    let sheet_names = match read_zip_entry(&mut archive, "xl/workbook.xml")? {
        Some(xml) => parse_sheet_names(&xml)?,
        None => return Err(AppError::InvalidInput("XLSX 缺少 workbook.xml".into())),
    };
    let mut worksheet_entries = (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|entry| entry.name().to_string())
        })
        .filter(|name| name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml"))
        .collect::<Vec<_>>();
    worksheet_entries.sort_by_key(|name| sheet_number(name));
    if worksheet_entries.is_empty() {
        return Err(AppError::InvalidInput("XLSX 没有可读取的工作表".into()));
    }
    if worksheet_entries.len() > MAX_TABLE_SHEETS {
        return Err(table_limit_error("XLSX 工作表数", MAX_TABLE_SHEETS));
    }
    let mut sheets = Vec::with_capacity(worksheet_entries.len());
    let mut total_cells = 0_usize;
    for (index, entry_name) in worksheet_entries.iter().enumerate() {
        let xml = read_zip_entry(&mut archive, entry_name)?
            .ok_or_else(|| AppError::InvalidInput("XLSX 工作表读取失败".into()))?;
        let name = sheet_names
            .get(index)
            .cloned()
            .unwrap_or_else(|| format!("Sheet {}", index + 1));
        let (sheet, grid_cells) = parse_worksheet(&xml, name, &shared_strings)?;
        total_cells = total_cells
            .checked_add(grid_cells)
            .ok_or_else(|| AppError::InvalidInput("XLSX 单元格数量溢出".into()))?;
        if total_cells > MAX_TABLE_CELLS {
            return Err(table_limit_error("XLSX 单元格数", MAX_TABLE_CELLS));
        }
        sheets.push(sheet);
    }
    Ok(TableSourceContent {
        sheets,
        limits: TableLimits::default(),
    })
}

fn parse_shared_strings(xml: &str) -> Result<Vec<String>, AppError> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut values = Vec::new();
    let mut current = String::new();
    let mut in_item = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) if start.name().as_ref() == b"si" => {
                in_item = true;
                current.clear();
            }
            Ok(Event::Text(text)) if in_item => current.push_str(
                &text
                    .xml_content()
                    .map_err(|_| AppError::InvalidInput("XLSX 共享文本编码无效".into()))?,
            ),
            Ok(Event::End(end)) if end.name().as_ref() == b"si" => {
                validate_cell_chars(&current)?;
                values.push(current.clone());
                in_item = false;
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(AppError::InvalidInput("XLSX 共享文本 XML 无效".into())),
            _ => {}
        }
    }
    Ok(values)
}

fn parse_sheet_names(xml: &str) -> Result<Vec<String>, AppError> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut names = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Empty(start)) | Ok(Event::Start(start))
                if start.name().as_ref() == b"sheet" =>
            {
                for attribute in start.attributes().flatten() {
                    if attribute.key.as_ref() == b"name" {
                        let value = attribute
                            .decode_and_unescape_value(reader.decoder())
                            .map_err(|_| AppError::InvalidInput("XLSX 工作表名称无效".into()))?;
                        names.push(value.chars().take(128).collect());
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(AppError::InvalidInput("XLSX workbook.xml 无效".into())),
            _ => {}
        }
    }
    Ok(names)
}

#[derive(Default)]
struct PendingCell {
    row: usize,
    column: usize,
    value_type: String,
    value: String,
    formula: bool,
}

fn parse_worksheet(
    xml: &str,
    name: String,
    shared_strings: &[String],
) -> Result<(TableSheet, usize), AppError> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut cells: BTreeMap<usize, BTreeMap<usize, TableCell>> = BTreeMap::new();
    let mut current: Option<PendingCell> = None;
    let mut capture_value = false;
    let mut max_row = 0_usize;
    let mut max_column = 0_usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) if start.name().as_ref() == b"c" => {
                let mut pending = PendingCell::default();
                for attribute in start.attributes().flatten() {
                    let value = attribute
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|_| AppError::InvalidInput("XLSX 单元格属性无效".into()))?;
                    match attribute.key.as_ref() {
                        b"r" => {
                            let (row, column) = cell_reference(&value)?;
                            pending.row = row;
                            pending.column = column;
                        }
                        b"t" => pending.value_type = value.into_owned(),
                        _ => {}
                    }
                }
                if pending.row == 0 || pending.column == 0 {
                    return Err(AppError::InvalidInput("XLSX 单元格缺少有效坐标".into()));
                }
                current = Some(pending);
            }
            Ok(Event::Start(start)) if current.is_some() && start.name().as_ref() == b"f" => {
                if let Some(cell) = current.as_mut() {
                    cell.formula = true;
                }
            }
            Ok(Event::Start(start))
                if current.is_some()
                    && (start.name().as_ref() == b"v" || start.name().as_ref() == b"t") =>
            {
                capture_value = true;
            }
            Ok(Event::Text(text)) if current.is_some() && capture_value => {
                let decoded = text
                    .xml_content()
                    .map_err(|_| AppError::InvalidInput("XLSX 单元格文本编码无效".into()))?;
                if let Some(cell) = current.as_mut() {
                    cell.value.push_str(&decoded);
                }
            }
            Ok(Event::End(end)) if end.name().as_ref() == b"v" || end.name().as_ref() == b"t" => {
                capture_value = false;
            }
            Ok(Event::End(end)) if end.name().as_ref() == b"c" => {
                let pending = current
                    .take()
                    .ok_or_else(|| AppError::InvalidInput("XLSX 单元格结构无效".into()))?;
                let value = if pending.value_type == "s" {
                    let index = pending
                        .value
                        .parse::<usize>()
                        .map_err(|_| AppError::InvalidInput("XLSX 共享文本索引无效".into()))?;
                    shared_strings
                        .get(index)
                        .cloned()
                        .ok_or_else(|| AppError::InvalidInput("XLSX 共享文本索引越界".into()))?
                } else if pending.value_type == "b" {
                    if pending.value == "1" {
                        "TRUE".into()
                    } else {
                        "FALSE".into()
                    }
                } else {
                    pending.value
                };
                validate_cell_chars(&value)?;
                max_row = max_row.max(pending.row);
                max_column = max_column.max(pending.column);
                if max_row > MAX_TABLE_ROWS {
                    return Err(table_limit_error("XLSX 行数", MAX_TABLE_ROWS));
                }
                if max_column > MAX_TABLE_COLUMNS {
                    return Err(table_limit_error("XLSX 列数", MAX_TABLE_COLUMNS));
                }
                let formula_injection_risk = pending.formula || has_formula_injection_risk(&value);
                cells.entry(pending.row).or_default().insert(
                    pending.column,
                    TableCell {
                        value,
                        formula: pending.formula,
                        formula_injection_risk,
                    },
                );
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(AppError::InvalidInput("XLSX 工作表 XML 无效".into())),
            _ => {}
        }
    }
    let grid_cells = max_row.saturating_mul(max_column);
    if grid_cells > MAX_TABLE_CELLS {
        return Err(table_limit_error("XLSX 稠密网格单元格数", MAX_TABLE_CELLS));
    }
    let mut rows = Vec::with_capacity(max_row);
    for row_index in 1..=max_row {
        let mut row = Vec::with_capacity(max_column);
        for column_index in 1..=max_column {
            row.push(
                cells
                    .get(&row_index)
                    .and_then(|columns| columns.get(&column_index))
                    .cloned()
                    .unwrap_or_else(|| TableCell::plain(String::new())),
            );
        }
        rows.push(row);
    }
    Ok((TableSheet { name, rows }, grid_cells))
}

fn summarize_table(content: &TableSourceContent) -> TableSourceSummary {
    let mut row_count = 0_usize;
    let mut column_count = 0_usize;
    let mut cell_count = 0_usize;
    let mut formula_cell_count = 0_usize;
    let mut formula_injection_risk_cell_count = 0_usize;
    for sheet in &content.sheets {
        row_count += sheet.rows.len();
        for row in &sheet.rows {
            column_count = column_count.max(row.len());
            cell_count += row.len();
            formula_cell_count += row.iter().filter(|cell| cell.formula).count();
            formula_injection_risk_cell_count += row
                .iter()
                .filter(|cell| cell.formula_injection_risk)
                .count();
        }
    }
    TableSourceSummary {
        sheet_names: content
            .sheets
            .iter()
            .map(|sheet| sheet.name.clone())
            .collect(),
        row_count,
        column_count,
        cell_count,
        formula_cell_count,
        formula_injection_risk_cell_count,
        limits: content.limits.clone(),
    }
}

fn inspect_image_bytes(extension: &str, bytes: &[u8]) -> Result<ImageSourceSummary, AppError> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(AppError::FileTooLarge);
    }
    let (width, height, animated) = match extension {
        "png" if bytes.len() >= 24 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" => {
            let animated = bytes.windows(4).any(|window| window == b"acTL");
            (
                u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
                u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
                animated,
            )
        }
        "gif" if bytes.len() >= 10 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") => {
            let animated = bytes
                .windows(11)
                .any(|window| window == b"NETSCAPE2.0" || window == b"ANIMEXTS1.0");
            (
                u16::from_le_bytes(bytes[6..8].try_into().unwrap()) as u32,
                u16::from_le_bytes(bytes[8..10].try_into().unwrap()) as u32,
                animated,
            )
        }
        "jpg" | "jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => {
            let (width, height) = jpeg_dimensions(bytes)?;
            (width, height, false)
        }
        "webp" if bytes.len() >= 30 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => {
            webp_dimensions(bytes)?
        }
        _ => return Err(AppError::InvalidInput("图片扩展名与内容签名不匹配".into())),
    };
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width).saturating_mul(u64::from(height)) > MAX_IMAGE_PIXELS
    {
        return Err(AppError::InvalidInput(
            "图片尺寸超过 32768 像素边长或 4000 万像素安全上限".into(),
        ));
    }
    Ok(ImageSourceSummary {
        width,
        height,
        animated,
        original_preserved: true,
        local_preview_available: bytes.len() as u64 <= MAX_LOCAL_IMAGE_PREVIEW_BYTES,
        visual_model_required: true,
    })
}

fn jpeg_dimensions(bytes: &[u8]) -> Result<(u32, u32), AppError> {
    let mut index = 2_usize;
    while index + 4 <= bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        index += 2;
        if marker == 0xd8 || marker == 0xd9 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if index + 2 > bytes.len() {
            break;
        }
        let length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if length < 2 || index + length > bytes.len() {
            break;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && length >= 7
        {
            let height = u16::from_be_bytes([bytes[index + 3], bytes[index + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            return Ok((width, height));
        }
        index += length;
    }
    Err(AppError::InvalidInput("JPEG 缺少有效尺寸信息".into()))
}

fn webp_dimensions(bytes: &[u8]) -> Result<(u32, u32, bool), AppError> {
    match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => {
            let animated = bytes[20] & 0x02 != 0;
            let width = 1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]);
            let height = 1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]);
            Ok((width, height, animated))
        }
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => {
            let bits = u32::from_le_bytes(bytes[21..25].try_into().unwrap());
            Ok(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1, false))
        }
        b"VP8 " if bytes.len() >= 30 && bytes[23..26] == [0x9d, 0x01, 0x2a] => Ok((
            u16::from_le_bytes(bytes[26..28].try_into().unwrap()) as u32 & 0x3fff,
            u16::from_le_bytes(bytes[28..30].try_into().unwrap()) as u32 & 0x3fff,
            false,
        )),
        _ => Err(AppError::InvalidInput(
            "WebP 编码类型暂不支持安全读取尺寸".into(),
        )),
    }
}

fn cell_reference(reference: &str) -> Result<(usize, usize), AppError> {
    let mut column = 0_usize;
    let mut split = 0_usize;
    for (index, character) in reference.char_indices() {
        if character.is_ascii_alphabetic() {
            column = column
                .checked_mul(26)
                .and_then(|value| {
                    value.checked_add((character.to_ascii_uppercase() as u8 - b'A' + 1) as usize)
                })
                .ok_or_else(|| AppError::InvalidInput("XLSX 列坐标溢出".into()))?;
            split = index + character.len_utf8();
        } else {
            break;
        }
    }
    let row = reference[split..]
        .parse::<usize>()
        .map_err(|_| AppError::InvalidInput("XLSX 行坐标无效".into()))?;
    Ok((row, column))
}

fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<Option<String>, AppError> {
    let mut entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(_) => return Err(AppError::InvalidInput("XLSX 压缩包条目无法读取".into())),
    };
    if entry.size() > 25 * 1024 * 1024 {
        return Err(AppError::InvalidInput(
            "XLSX 单个 XML 条目超过 25 MB".into(),
        ));
    }
    let mut xml = String::new();
    entry
        .read_to_string(&mut xml)
        .map_err(|_| AppError::InvalidInput("XLSX XML 不是有效 UTF-8".into()))?;
    Ok(Some(xml))
}

fn sheet_number(name: &str) -> usize {
    name.trim_start_matches("xl/worksheets/sheet")
        .trim_end_matches(".xml")
        .parse()
        .unwrap_or(usize::MAX)
}

fn validate_cell_chars(value: &str) -> Result<(), AppError> {
    if value.chars().count() > MAX_TABLE_CELL_CHARS {
        Err(table_limit_error("表格单元格字符数", MAX_TABLE_CELL_CHARS))
    } else {
        Ok(())
    }
}

fn has_formula_injection_risk(value: &str) -> bool {
    value
        .trim_start_matches([' ', '\t', '\r', '\n'])
        .starts_with(['=', '+', '-', '@'])
}

fn table_limit_error(label: &str, limit: usize) -> AppError {
    AppError::InvalidInput(format!("{label}超过 {limit} 的安全上限"))
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::{
        escape_spreadsheet_formula, parse_table, revoke, validate_image, MAX_TABLE_COLUMNS,
        MAX_TABLE_ROWS,
    };
    use crate::storage::Storage;
    use std::fs;
    use std::io::Write;

    #[test]
    fn csv_preserves_quotes_and_marks_formula_injection_without_executing_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.csv");
        fs::write(&path, "name,note\nAlice,\"line 1\nline 2\"\nBob,=2+2\n").unwrap();
        let table = parse_table(&path).unwrap();
        assert_eq!(table.sheets[0].rows[1][1].value, "line 1\nline 2");
        assert!(table.sheets[0].rows[2][1].formula_injection_risk);
        assert_eq!(escape_spreadsheet_formula("=2+2"), "'=2+2");
        assert_eq!(escape_spreadsheet_formula("safe"), "safe");
    }

    #[test]
    fn csv_enforces_explicit_row_and_column_limits() {
        let directory = tempfile::tempdir().unwrap();
        let too_many_columns = directory.path().join("columns.csv");
        fs::write(
            &too_many_columns,
            vec!["x"; MAX_TABLE_COLUMNS + 1].join(","),
        )
        .unwrap();
        assert!(parse_table(&too_many_columns).is_err());
        let too_many_rows = directory.path().join("rows.csv");
        fs::write(&too_many_rows, "x\n".repeat(MAX_TABLE_ROWS + 1)).unwrap();
        assert!(parse_table(&too_many_rows).is_err());
    }

    #[test]
    fn png_dimensions_are_read_without_decoding_or_altering_pixels() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("image.png");
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
        bytes.extend_from_slice(&640_u32.to_be_bytes());
        bytes.extend_from_slice(&480_u32.to_be_bytes());
        fs::write(&path, bytes).unwrap();
        let summary = validate_image(&path).unwrap();
        assert_eq!((summary.width, summary.height), (640, 480));
        assert!(summary.original_preserved);
        assert!(summary.visual_model_required);
    }

    #[test]
    fn revoking_a_source_is_workspace_scoped_and_never_deletes_the_original_file() {
        let directory = tempfile::tempdir().unwrap();
        let first_path = directory.path().join("first.csv");
        let second_path = directory.path().join("second.csv");
        fs::write(&first_path, "name,value\nfirst,1\n").unwrap();
        fs::write(&second_path, "name,value\nsecond,2\n").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        storage
            .create_standalone_workspace("workspace-a", "A")
            .unwrap();
        storage
            .create_standalone_workspace("workspace-b", "B")
            .unwrap();
        storage
            .attach_workspace_file(
                "workspace-a",
                "source-a",
                first_path.to_str().unwrap(),
                "selected/source-a/first.csv",
            )
            .unwrap();
        storage
            .attach_workspace_file(
                "workspace-b",
                "source-b",
                second_path.to_str().unwrap(),
                "selected/source-b/second.csv",
            )
            .unwrap();

        let cross_workspace = revoke(&storage, "workspace-a", "source-b").unwrap_err();
        assert!(cross_workspace
            .to_string()
            .contains("不存在或未获当前工作区授权"));
        assert!(storage
            .workspace_file_by_source("source-b")
            .unwrap()
            .is_some());

        revoke(&storage, "workspace-a", "source-a").unwrap();
        assert!(storage
            .workspace_file_by_source("source-a")
            .unwrap()
            .is_none());
        assert!(first_path.exists());
        assert_eq!(
            fs::read_to_string(&first_path).unwrap(),
            "name,value\nfirst,1\n"
        );
        assert!(revoke(&storage, "workspace-a", "source-a").is_err());
    }

    #[test]
    fn xlsx_reads_cached_values_and_marks_formulas_without_evaluating_them() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("data.xlsx");
        let file = fs::File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("xl/workbook.xml", options).unwrap();
        writer
            .write_all(
                br#"<workbook><sheets><sheet name="Sales" sheetId="1"/></sheets></workbook>"#,
            )
            .unwrap();
        writer.start_file("xl/sharedStrings.xml", options).unwrap();
        writer
            .write_all(br#"<sst><si><t>Month</t></si><si><t>January</t></si></sst>"#)
            .unwrap();
        writer
            .start_file("xl/worksheets/sheet1.xml", options)
            .unwrap();
        writer
            .write_all(
                br#"<worksheet><sheetData>
                  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>10</v></c></row>
                  <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><f>SUM(B1:B1)</f><v>10</v></c></row>
                </sheetData></worksheet>"#,
            )
            .unwrap();
        writer.finish().unwrap();

        let table = parse_table(&path).unwrap();
        assert_eq!(table.sheets[0].name, "Sales");
        assert_eq!(table.sheets[0].rows[1][0].value, "January");
        assert_eq!(table.sheets[0].rows[1][1].value, "10");
        assert!(table.sheets[0].rows[1][1].formula);
        assert!(table.sheets[0].rows[1][1].formula_injection_risk);
    }
}
