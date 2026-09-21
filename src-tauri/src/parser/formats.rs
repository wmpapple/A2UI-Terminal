use std::path::Path;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "css", "html", "js", "json", "jsx", "md", "mjs", "py", "toml", "ts", "tsx", "txt", "yaml",
    "yml",
];
const SUPPORTED_DOCUMENT_EXTENSIONS: &[&str] = &["docx", "pdf"];

pub fn is_supported_workspace_path(path: &Path) -> bool {
    is_supported_text_path(path)
        || path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| {
                SUPPORTED_DOCUMENT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
            })
            .unwrap_or(false)
}

pub fn is_supported_document_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            SUPPORTED_DOCUMENT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
        .unwrap_or(false)
}

pub fn is_supported_text_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| SUPPORTED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}
