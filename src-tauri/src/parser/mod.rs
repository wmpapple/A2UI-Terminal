//! Local parsing only. Callers own file authorization and persistence.
mod formats;
pub mod table;
mod text;
pub use formats::{
    is_supported_document_path, is_supported_text_path, is_supported_workspace_path,
};
pub const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_DOCUMENT_FILE_BYTES: u64 = 25 * 1024 * 1024;

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

pub const PARSER_VERSION: &str = "local-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Locator {
    TextRange {
        start: usize,
        end: usize,
        offset_unit: OffsetUnit,
    },
    Unavailable {
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum OffsetUnit {
    #[serde(rename = "utf16")]
    Utf16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedBlock {
    pub id: String,
    pub text: String,
    pub locator: Locator,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    pub format: String,
    pub parser_version: String,
    pub raw_hash: String,
    pub extracted_hash: String,
    pub blocks: Vec<ParsedBlock>,
    pub warnings: Vec<String>,
}

impl ParsedDocument {
    pub fn text(&self) -> String {
        self.blocks
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, AppError> {
    let file = File::open(path)?;
    if file.metadata()?.len() > limit {
        return Err(AppError::FileTooLarge);
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(AppError::FileTooLarge);
    }
    Ok(bytes)
}

fn limit(path: &Path) -> Result<u64, AppError> {
    if is_supported_text_path(path) {
        return Ok(MAX_TEXT_FILE_BYTES);
    }
    if is_supported_document_path(path) {
        return Ok(MAX_DOCUMENT_FILE_BYTES);
    }
    match extension(path).as_str() {
        "csv" => Ok(table::MAX_CSV_BYTES),
        "xlsx" => Ok(table::MAX_XLSX_BYTES),
        _ => Err(AppError::InvalidInput("Unsupported document type".into())),
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// The path is internal and must already be authorized by the application layer.
pub fn parse(path: &Path) -> Result<ParsedDocument, AppError> {
    parse_bytes(path, &read_bounded(path, limit(path)?)?)
}

/// Parse one immutable byte snapshot so raw and extracted hashes cannot race.
pub fn parse_bytes(path: &Path, bytes: &[u8]) -> Result<ParsedDocument, AppError> {
    if bytes.len() as u64 > limit(path)? {
        return Err(AppError::FileTooLarge);
    }
    let format = extension(path);
    if matches!(format.as_str(), "docx" | "xlsx") {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|_| AppError::InvalidInput("Invalid Office package".into()))?;
        if archive.len() > 2_000 {
            return Err(AppError::FileTooLarge);
        }
        let mut total = 0_u64;
        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|_| AppError::InvalidInput("Invalid Office entry".into()))?;
            total = total
                .checked_add(entry.size())
                .ok_or(AppError::FileTooLarge)?;
            if entry.enclosed_name().is_none()
                || entry.size() > 25 * 1024 * 1024
                || total > 100 * 1024 * 1024
                || entry.size() > entry.compressed_size().max(1).saturating_mul(100)
            {
                return Err(AppError::InvalidInput(
                    "Office package exceeds safe limits".into(),
                ));
            }
        }
    }
    let extracted = is_supported_document_path(path);
    let table = matches!(format.as_str(), "csv" | "xlsx");
    let content = if table {
        let table = table::parse_table_bytes(&format, bytes)?;
        table
            .sheets
            .iter()
            .map(|sheet| {
                sheet
                    .rows
                    .iter()
                    .map(|row| {
                        row.iter()
                            .map(|cell| cell.value.as_str())
                            .collect::<Vec<_>>()
                            .join("\t")
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else if extracted {
        text::extract_document_text(path, bytes)?
    } else {
        String::from_utf8(bytes.to_vec()).map_err(|_| AppError::InvalidEncoding)?
    };
    if !table && content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(AppError::FileTooLarge);
    }
    let locator = if extracted || table {
        Locator::Unavailable {
            reason: "parser_v1_has_no_structural_mapping".into(),
        }
    } else {
        Locator::TextRange {
            start: 0,
            end: content.encode_utf16().count(),
            offset_unit: OffsetUnit::Utf16,
        }
    };
    Ok(ParsedDocument {
        format,
        parser_version: PARSER_VERSION.into(),
        raw_hash: hash(bytes),
        extracted_hash: hash(content.as_bytes()),
        blocks: vec![ParsedBlock {
            id: "block-1".into(),
            text: content,
            locator,
        }],
        warnings: if extracted || table {
            vec!["structural_locator_unavailable".into()]
        } else {
            vec![]
        },
    })
}
