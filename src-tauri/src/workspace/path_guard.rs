use crate::error::AppError;
pub use crate::parser::{
    is_supported_document_path, is_supported_text_path, is_supported_workspace_path,
};
use std::path::{Component, Path, PathBuf};

pub fn canonicalize_root(root: &Path) -> Result<PathBuf, AppError> {
    let canonical = root.canonicalize()?;
    if !canonical.is_dir() {
        return Err(AppError::InvalidInput(
            "工作区根路径必须是已存在的目录".into(),
        ));
    }
    Ok(canonical)
}

pub fn resolve_existing_file(root: &Path, relative_path: &Path) -> Result<PathBuf, AppError> {
    validate_relative_path(relative_path)?;
    if !is_supported_workspace_path(relative_path) {
        return Err(AppError::InvalidInput(
            "当前文件类型不在文本文件白名单中".into(),
        ));
    }

    let canonical_root = canonicalize_root(root)?;
    let candidate = canonical_root.join(relative_path).canonicalize()?;
    if !candidate.starts_with(&canonical_root) || !candidate.is_file() {
        return Err(AppError::InvalidInput("文件必须位于当前工作区内".into()));
    }
    Ok(candidate)
}

fn validate_relative_path(path: &Path) -> Result<(), AppError> {
    let valid = !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if !valid {
        return Err(AppError::InvalidInput(
            "文件路径必须是工作区内不含路径穿越的相对路径".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_supported_document_path, is_supported_text_path, resolve_existing_file};
    use std::fs;
    use std::path::Path;

    #[test]
    fn accepts_supported_text_extensions_case_insensitively() {
        for path in ["a.json", "b.TS", "c.js", "d.py", "e.yaml", "f.yml"] {
            assert!(is_supported_text_path(Path::new(path)), "rejected {path}");
        }
        assert!(!is_supported_text_path(Path::new("image.png")));
        assert!(is_supported_document_path(Path::new("report.docx")));
        assert!(is_supported_document_path(Path::new("paper.PDF")));
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("safe.ts"), "export {};").unwrap();

        assert!(resolve_existing_file(directory.path(), Path::new("safe.ts")).is_ok());
        assert!(resolve_existing_file(directory.path(), Path::new("../outside.ts")).is_err());
        assert!(
            resolve_existing_file(directory.path(), &directory.path().join("safe.ts")).is_err()
        );
    }
}
