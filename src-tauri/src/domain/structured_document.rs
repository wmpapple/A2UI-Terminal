//! Editor-independent document contract. Source slices preserve unsupported Markdown.
use crate::domain::document::DocumentSnapshot;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextRun {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Node {
    Paragraph {
        runs: Vec<TextRun>,
    },
    Heading {
        level: u8,
        runs: Vec<TextRun>,
    },
    Quote {
        runs: Vec<TextRun>,
    },
    List {
        ordered: bool,
        items: Vec<Vec<TextRun>>,
    },
    Table {
        rows: Vec<Vec<Vec<TextRun>>>,
    },
    Image {
        alt: String,
        source: String,
    },
    PageBreak,
    Unsupported {
        label: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Block {
    pub id: String,
    pub node: Node,
    /// Lossless source adapter, including whitespace before this block.
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructuredDocument {
    pub schema_version: u8,
    pub blocks: Vec<Block>,
    pub trailing: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredView {
    pub snapshot: DocumentSnapshot,
    pub document: StructuredDocument,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum StructuredOperation {
    ReplaceBlock {
        block_id: String,
        markdown: String,
    },
    ReplaceText {
        block_id: String,
        text: String,
    },
    InsertBlock {
        after_id: Option<String>,
        markdown: String,
    },
    DeleteBlock {
        block_id: String,
    },
    MoveBlock {
        block_id: String,
        after_id: Option<String>,
    },
    ChangeHeading {
        block_id: String,
        level: u8,
    },
    InsertTable {
        after_id: Option<String>,
        rows: Vec<Vec<String>>,
    },
    UpdateCell {
        block_id: String,
        row: usize,
        column: usize,
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructuredPatch {
    pub schema_version: u8,
    pub target: crate::domain::document::DocumentTarget,
    pub base_hash: String,
    pub base_revision_id: Option<String>,
    pub operations: Vec<StructuredOperation>,
}
