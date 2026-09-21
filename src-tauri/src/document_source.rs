use crate::error::AppError;
pub use crate::parser::table::{
    escape_spreadsheet_formula, TableCell, TableLimits, TableSheet, TableSourceContent,
    TableSourceSummary, MAX_CSV_BYTES, MAX_TABLE_CELLS, MAX_TABLE_CELL_CHARS, MAX_TABLE_COLUMNS,
    MAX_TABLE_ROWS, MAX_TABLE_SHEETS, MAX_XLSX_BYTES,
};
use crate::parser::table::{parse_table_bytes, summarize_table};
use crate::storage::{Storage, WorkspaceFileRow};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
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
    let format = extension(path);
    let limit = match format.as_str() {
        "csv" => MAX_CSV_BYTES,
        "xlsx" => MAX_XLSX_BYTES,
        _ => return Err(AppError::InvalidInput("不是受支持的表格来源".into())),
    };
    let bytes = crate::parser::read_bounded(path, limit)?;
    parse_table_bytes(&format, &bytes)
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
