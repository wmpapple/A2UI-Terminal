//! Native-dialog-selected destinations. No frontend path or overwrite flag enters here.
use super::export::ExportCancellation;
use crate::{error::AppError, storage::Storage};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, PartialEq, Eq)]
struct Fingerprint {
    length: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    hash: Vec<u8>,
}

pub struct ExportTarget {
    path: PathBuf,
    expected: Option<Fingerprint>,
}

impl ExportTarget {
    /// Call only after the native save dialog has returned its selected path.
    /// `allow_replace` is Rust-owned native confirmation, never an IPC field.
    pub fn selected(
        path: &Path,
        allow_replace: bool,
        cancel: &ExportCancellation,
    ) -> Result<Self, AppError> {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::InvalidInput("导出目录无效".into()))?
            .canonicalize()?;
        let name = path
            .file_name()
            .ok_or_else(|| AppError::InvalidInput("导出文件名无效".into()))?;
        let path = parent.join(name);
        let expected = fingerprint(&path, cancel)?;
        if expected.is_some() && !allow_replace {
            return Err(AppError::FileConflict);
        }
        Ok(Self { path, expected })
    }

    pub fn write(&self, bytes: &[u8], cancel: &ExportCancellation) -> Result<(), AppError> {
        cancel.check()?;
        let mut temporary = tempfile::Builder::new()
            .prefix(".a2ui-export-")
            .suffix(".tmp")
            .tempfile_in(self.path.parent().expect("validated parent"))?;
        for chunk in bytes.chunks(64 * 1024) {
            cancel.check()?;
            temporary.write_all(chunk)?;
        }
        temporary.as_file().sync_all()?;
        // Detect edits/removal/recreation while the converter was running.
        if fingerprint(&self.path, cancel)? != self.expected {
            return Err(AppError::FileConflict);
        }
        cancel.begin_commit()?;
        let result = if self.expected.is_some() {
            // Same-volume atomic replacement. Never truncate/delete the old file first.
            temporary.persist(&self.path)
        } else {
            temporary.persist_noclobber(&self.path)
        };
        result.map(|_| ()).map_err(|failure| {
            if failure.error.kind() == std::io::ErrorKind::AlreadyExists {
                AppError::FileConflict
            } else {
                AppError::Io(failure.error)
            }
        })
    }
}

fn fingerprint(path: &Path, cancel: &ExportCancellation) -> Result<Option<Fingerprint>, AppError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AppError::InvalidInput("导出不能替换目录或符号链接".into()));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(AppError::InvalidInput("导出不能替换重解析点".into()));
        }
    }
    if metadata.permissions().readonly() {
        return Err(AppError::InvalidInput(
            "目标文件只读，请换一个文件名或解除只读后重试".into(),
        ));
    }
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        cancel.check()?;
        let length = file.read(&mut buffer)?;
        if length == 0 {
            break;
        }
        hash.update(&buffer[..length]);
    }
    let after = file.metadata()?;
    if metadata.len() != after.len() || metadata.modified().ok() != after.modified().ok() {
        return Err(AppError::FileConflict);
    }
    Ok(Some(Fingerprint {
        length: after.len(),
        modified: after.modified().ok(),
        created: after.created().ok(),
        hash: hash.finalize().to_vec(),
    }))
}

/// Export is not a save/history bypass. Protect the managed store and source document.
pub fn protect_source(
    storage: &Storage,
    managed: &Path,
    result_id: &str,
    target: &Path,
) -> Result<(), AppError> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::InvalidInput("导出目录无效".into()))?
        .canonicalize()?;
    let managed = managed.canonicalize()?;
    if parent.starts_with(&managed) {
        return Err(AppError::InvalidInput(
            "请将导出文件存放在应用成果管理目录之外".into(),
        ));
    }
    let source = storage
        .result_source(result_id)?
        .ok_or_else(|| AppError::InvalidInput("成果不存在".into()))?;
    if source.source_kind == "workspace_file" {
        let path = if let Some(file) =
            storage.workspace_file(&source.result.workspace_id, &source.source_ref)?
        {
            PathBuf::from(file.absolute_path)
        } else {
            let workspace = storage
                .workspace(&source.result.workspace_id)?
                .ok_or_else(|| AppError::InvalidInput("工作区授权已撤销".into()))?;
            Path::new(&workspace.root_path).join(source.source_ref)
        };
        if target.try_exists()? && path.canonicalize()? == target.canonicalize()? {
            return Err(AppError::InvalidInput(
                "导出不能替换正在编辑的源成果，请选择其他文件名".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn destination_cannot_bypass_managed_store_or_source_history() {
        let dir = tempfile::tempdir().unwrap();
        let managed = dir.path().join("managed");
        fs::create_dir(&managed).unwrap();
        let storage = Storage::open(&dir.path().join("state.sqlite")).unwrap();
        let workspace = crate::workspace::register_workspace(&storage, dir.path()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        fs::write(dir.path().join("source.md"), b"source").unwrap();
        storage
            .ensure_file_result(
                &id,
                &workspace.id,
                "source.md",
                "source",
                "workspace_file",
                "result://source",
                None,
            )
            .unwrap();
        assert!(protect_source(&storage, &managed, &id, &managed.join("copy.md")).is_err());
        assert!(protect_source(&storage, &managed, &id, &dir.path().join("source.md")).is_err());
        assert!(protect_source(&storage, &managed, &id, &dir.path().join("delivery.pdf")).is_ok());
        assert_eq!(fs::read(dir.path().join("source.md")).unwrap(), b"source");
    }
    #[test]
    fn confirmed_replace_is_complete_and_cancel_or_changed_target_preserves_old_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.pdf");
        fs::write(&path, b"old").unwrap();
        assert!(ExportTarget::selected(&path, false, &ExportCancellation::default()).is_err());
        let cancel = ExportCancellation::default();
        let target = ExportTarget::selected(&path, true, &cancel).unwrap();
        target.write(b"complete new PDF", &cancel).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"complete new PDF");
        let cancel = ExportCancellation::default();
        let target = ExportTarget::selected(&path, true, &cancel).unwrap();
        cancel.cancel();
        assert!(target.write(b"cancelled", &cancel).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"complete new PDF");
        let cancel = ExportCancellation::default();
        let target = ExportTarget::selected(&path, true, &cancel).unwrap();
        fs::write(&path, b"external edit").unwrap();
        assert!(matches!(
            target.write(b"stale", &cancel),
            Err(AppError::FileConflict)
        ));
        assert_eq!(fs::read(&path).unwrap(), b"external edit");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn new_destination_stays_no_clobber_and_directory_is_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.txt");
        let cancel = ExportCancellation::default();
        let target = ExportTarget::selected(&path, true, &cancel).unwrap();
        fs::write(&path, b"raced").unwrap();
        assert!(target.write(b"new", &cancel).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"raced");
        assert!(ExportTarget::selected(dir.path(), true, &cancel).is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn sharing_violation_during_replace_preserves_original_and_cleans_temp() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locked.pdf");
        fs::write(&path, b"original").unwrap();
        let cancel = ExportCancellation::default();
        let target = ExportTarget::selected(&path, true, &cancel).unwrap();
        let _reader = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        assert!(target.write(b"replacement", &cancel).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
