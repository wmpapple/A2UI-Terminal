use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Markdown,
    PlainText,
    Docx,
    Pdf,
    Rtf,
    Csv,
    Xlsx,
    Json,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::PlainText => "txt",
            Self::Docx => "docx",
            Self::Pdf => "pdf",
            Self::Rtf => "rtf",
            Self::Csv => "csv",
            Self::Xlsx => "xlsx",
            Self::Json => "json",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportResultInput {
    pub export_id: String,
    pub result_id: String,
    pub revision_id: String,
    pub format: ExportFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgressEvent {
    pub export_id: String,
    pub stage: String,
    pub progress: u8,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResultOutput {
    pub export_id: String,
    pub result_id: String,
    pub revision_id: String,
    pub format: ExportFormat,
    pub status: String,
    pub file_name: Option<String>,
}
