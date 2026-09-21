use crate::error::AppError;
use quick_xml::events::Event;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Read};

pub const MAX_CSV_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_XLSX_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_TABLE_SHEETS: usize = 32;
pub const MAX_TABLE_ROWS: usize = 10_000;
pub const MAX_TABLE_COLUMNS: usize = 256;
pub const MAX_TABLE_CELLS: usize = 100_000;
pub const MAX_TABLE_CELL_CHARS: usize = 32_768;

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

pub fn parse_table_bytes(format: &str, bytes: &[u8]) -> Result<TableSourceContent, AppError> {
    match format {
        "csv" => parse_csv(bytes),
        "xlsx" => parse_xlsx(bytes),
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

fn parse_csv(bytes: &[u8]) -> Result<TableSourceContent, AppError> {
    if bytes.len() as u64 > MAX_CSV_BYTES {
        return Err(AppError::FileTooLarge);
    }
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(bytes);
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

fn parse_xlsx(bytes: &[u8]) -> Result<TableSourceContent, AppError> {
    if bytes.len() as u64 > MAX_XLSX_BYTES {
        return Err(AppError::FileTooLarge);
    }
    let file = std::io::Cursor::new(bytes);
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

pub(crate) fn summarize_table(content: &TableSourceContent) -> TableSourceSummary {
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
