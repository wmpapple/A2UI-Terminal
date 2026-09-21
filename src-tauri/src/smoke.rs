//! Explicit, fail-closed isolation for the desktop startup smoke test.
use std::{ffi::OsString, io, path::PathBuf, sync::OnceLock};

pub(crate) const RECEIPT: &str = "A2UI_SMOKE_ISOLATION_V1";
static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();

pub(crate) fn initialize() -> io::Result<()> {
    let root = parse_root(std::env::args_os().skip(1).collect(), std::env::temp_dir())?;
    ROOT.set(root)
        .map_err(|_| io::Error::other("Smoke mode already initialized"))
}

pub(crate) fn root() -> Option<&'static PathBuf> {
    ROOT.get().and_then(Option::as_ref)
}

fn parse_root(args: Vec<OsString>, temp: PathBuf) -> io::Result<Option<PathBuf>> {
    let Some(index) = args.iter().position(|arg| arg == "--smoke-test-root") else {
        return Ok(None);
    };
    if args.len() != 2 || index != 0 {
        return Err(io::Error::other(
            "Expected only --smoke-test-root <empty temporary directory>",
        ));
    }
    let candidate = PathBuf::from(&args[1]);
    let valid_name = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix("a2ui-terminal-smoke-"))
        .is_some_and(|suffix| uuid::Uuid::parse_str(suffix).is_ok());
    let canonical = candidate.canonicalize()?;
    let temp = temp.canonicalize()?;
    if !valid_name
        || !candidate.is_absolute()
        || candidate
            .parent()
            .and_then(|parent| parent.canonicalize().ok())
            .as_ref()
            != Some(&temp)
        || canonical.parent() != Some(temp.as_path())
        || std::fs::symlink_metadata(&candidate)?
            .file_type()
            .is_symlink()
        || !canonical.is_dir()
        || std::fs::read_dir(&canonical)?.next().is_some()
    {
        return Err(io::Error::other(
            "Smoke root must be a fresh, empty, direct temporary directory",
        ));
    }
    Ok(Some(canonical))
}

pub(crate) fn write_ready() -> io::Result<()> {
    if let Some(root) = root() {
        std::fs::write(
            root.join("ready.json"),
            serde_json::to_vec(&serde_json::json!({
                "protocol": RECEIPT,
                "database": "app-data/a2ui-terminal.sqlite3",
                "webview": "webview",
                "credentialsDisabled": true
            }))?,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(root: &std::path::Path) -> Vec<OsString> {
        vec!["--smoke-test-root".into(), root.as_os_str().into()]
    }

    #[test]
    fn normal_launch_does_not_select_test_storage() {
        assert!(parse_root(vec![], std::env::temp_dir()).unwrap().is_none());
    }

    #[test]
    fn accepts_only_fresh_direct_temporary_directory() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp
            .path()
            .join(format!("a2ui-terminal-smoke-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        assert_eq!(
            parse_root(args(&root), temp.path().into()).unwrap(),
            Some(root.canonicalize().unwrap())
        );
        std::fs::write(root.join("existing.sqlite3"), "do not touch").unwrap();
        assert!(parse_root(args(&root), temp.path().into()).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("existing.sqlite3")).unwrap(),
            "do not touch"
        );
    }

    #[test]
    fn rejects_outside_root_invalid_name_and_missing_or_duplicate_arguments() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = outside
            .path()
            .join(format!("a2ui-terminal-smoke-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        assert!(parse_root(args(&root), temp.path().into()).is_err());
        let invalid = temp.path().join("a2ui-terminal-smoke-user-data");
        std::fs::create_dir(&invalid).unwrap();
        assert!(parse_root(args(&invalid), temp.path().into()).is_err());
        assert!(parse_root(vec!["--smoke-test-root".into()], temp.path().into()).is_err());
        let mut duplicate = args(&root);
        duplicate.extend(args(&root));
        assert!(parse_root(duplicate, temp.path().into()).is_err());
    }
}
