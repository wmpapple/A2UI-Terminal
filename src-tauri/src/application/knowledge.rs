pub use crate::repository::knowledge::{edit, get, list};
use crate::{
    application::import::{self, PendingImportBatch},
    domain::{
        import::{ConfirmImportInput, ImportItemStatus},
        knowledge::*,
    },
    error::AppError,
    parser,
    repository::knowledge as repo,
    storage::Storage,
};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

fn operation_lock(root: &Path) -> Result<fs::File, AppError> {
    let lock = root.join(".operation-lock");
    if lock.exists()
        && (fs::symlink_metadata(&lock)?.file_type().is_symlink() || lock.canonicalize()? != lock)
    {
        return Err(AppError::InvalidInput("Unsafe knowledge lock".into()));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options.open(lock).map_err(|_| {
        AppError::InvalidInput("Knowledge library is busy in another process; retry shortly".into())
    })
}

// Flat, opaque filenames. Never expose or accept filesystem paths in knowledge IPC.
pub fn root(managed_results: &Path) -> Result<PathBuf, AppError> {
    let parent = managed_results
        .parent()
        .ok_or(AppError::StateUnavailable)?
        .canonicalize()?;
    let directory = parent.join("knowledge");
    if directory.exists() && fs::symlink_metadata(&directory)?.file_type().is_symlink() {
        return Err(AppError::InvalidInput("Unsafe knowledge path".into()));
    }
    fs::create_dir_all(&directory)?;
    let canonical = directory.canonicalize()?;
    if canonical != directory {
        return Err(AppError::InvalidInput("Unsafe knowledge path".into()));
    }
    Ok(canonical)
}

fn path(root: &Path, id: &str, format: &str) -> Result<PathBuf, AppError> {
    if Uuid::parse_str(id).is_err()
        || !matches!(format, "txt" | "md" | "docx" | "pdf" | "csv" | "xlsx")
    {
        return Err(AppError::InvalidInput("Invalid knowledge reference".into()));
    }
    let p = root.join(format!("{id}.{format}"));
    if p.exists()
        && (fs::symlink_metadata(&p)?.file_type().is_symlink()
            || p.canonicalize()?.parent() != Some(root))
    {
        return Err(AppError::InvalidInput("Unsafe knowledge path".into()));
    }
    Ok(p)
}

pub fn confirm(
    storage: &Storage,
    root: &Path,
    pending: &PendingImportBatch,
    input: ConfirmImportInput,
) -> Result<Vec<KnowledgeSource>, AppError> {
    let _lock = operation_lock(root)?;
    if input.batch_id != pending.batch.id {
        return Err(AppError::InvalidInput("Import batch expired".into()));
    }
    if !input.confirmed {
        return Ok(vec![]);
    }
    let accepted: HashSet<_> = input.accepted_item_ids.iter().collect();
    if !pending.batch.can_confirm
        || accepted.is_empty()
        || accepted.len() != input.accepted_item_ids.len()
        || accepted.len() > import::MAX_IMPORT_FILES
    {
        return Err(AppError::InvalidInput("Invalid import selection".into()));
    }
    let mut documents = Vec::new();
    let mut duplicates = Vec::new();
    let mut created = Vec::new();
    let result = (|| {
        for item_id in &input.accepted_item_ids {
            let item = pending
                .batch
                .items
                .iter()
                .find(|i| &i.id == item_id && i.status == ImportItemStatus::Ready)
                .ok_or_else(|| AppError::InvalidInput("Import item not ready".into()))?;
            if !matches!(
                item.extension.as_str(),
                "txt" | "md" | "docx" | "pdf" | "csv" | "xlsx"
            ) {
                return Err(AppError::InvalidInput(
                    "Knowledge supports TXT/MD/DOCX/PDF/CSV/XLSX".into(),
                ));
            }
            let source = pending
                .sources
                .iter()
                .find(|s| &s.item_id == item_id)
                .ok_or(AppError::StateUnavailable)?;
            let bytes = parser::read_bounded(&source.path, 25 * 1024 * 1024)?;
            if source.content_hash.as_deref() != Some(parser::hash(&bytes).as_str()) {
                return Err(AppError::InvalidInput(
                    "Source changed since inspection; select it again".into(),
                ));
            }
            let parsed = parser::parse_bytes(&source.path, &bytes)?;
            if parsed.text().len() > 2 * 1024 * 1024 {
                return Err(AppError::FileTooLarge);
            }
            if parsed.text().trim().is_empty() {
                return Err(AppError::InvalidInput(
                    "No readable text; OCR is not supported".into(),
                ));
            }
            if let Some(id) = repo::duplicate(storage, &parsed.raw_hash)? {
                duplicates.push(repo::get(storage, &id)?.source);
                continue;
            }
            if documents
                .iter()
                .any(|d: &KnowledgeDocument| d.source.raw_hash == parsed.raw_hash)
            {
                continue;
            }
            let id = Uuid::new_v4().to_string();
            let final_path = path(root, &id, &item.extension)?;
            let stage = root.join(format!("{id}.stage"));
            created.push(stage.clone());
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&stage)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&stage, &final_path)?;
            created.push(final_path);
            documents.push(KnowledgeDocument {
                source: KnowledgeSource {
                    id,
                    title: item.name.clone(),
                    format: item.extension.clone(),
                    original_name: item.name.clone(),
                    raw_hash: parsed.raw_hash.clone(),
                    extracted_hash: parsed.extracted_hash.clone(),
                    parser_version: parsed.parser_version.clone(),
                    source_version: 1,
                    tags: vec![],
                    status: "ready".into(),
                    created_at: String::new(),
                    updated_at: String::new(),
                },
                parsed,
            });
        }
        repo::insert_all(storage, &documents)?;
        Ok(())
    })();
    if let Err(error) = result {
        for p in created {
            let _ = fs::remove_file(p);
        }
        return Err(error);
    }
    for d in documents {
        duplicates.push(repo::get(storage, &d.source.id)?.source);
    }
    Ok(duplicates)
}

pub fn delete(storage: &Storage, root: &Path, id: &str) -> Result<(), AppError> {
    let _lock = operation_lock(root)?;
    delete_unlocked(storage, root, id)
}

fn delete_unlocked(storage: &Storage, root: &Path, id: &str) -> Result<(), AppError> {
    let record = repo::files(storage)?
        .into_iter()
        .find(|(key, _, _)| key == id)
        .ok_or_else(|| AppError::InvalidInput("Knowledge source not found".into()))?;
    repo::mark_unavailable(storage, id, "deleting")?;
    let file = path(root, id, &record.1)?;
    match fs::remove_file(file) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => {
            return Err(AppError::InvalidInput(
                "Source revoked; managed copy pending cleanup. Retry deletion.".into(),
            ))
        }
    }
    repo::remove(storage, id)
}

pub fn reconcile(storage: &Storage, root: &Path) -> Result<(), AppError> {
    let _lock = operation_lock(root)?;
    reconcile_unlocked(storage, root)
}

fn reconcile_unlocked(storage: &Storage, root: &Path) -> Result<(), AppError> {
    let records = repo::files(storage)?;
    let mut retained = HashSet::new();
    for (id, format, status) in records {
        let file = match path(root, &id, &format) {
            Ok(file) => file,
            Err(_) => {
                repo::mark_unavailable(storage, &id, "failed")?;
                continue;
            }
        };
        retained.insert(file.clone());
        if status == "deleting" {
            let _ = delete_unlocked(storage, root, &id);
        } else if status == "ready" {
            let current = parser::read_bounded(&file, 25 * 1024 * 1024);
            let expected = repo::get(storage, &id)?;
            if current
                .as_ref()
                .map(|bytes| parser::hash(bytes))
                .ok()
                .as_deref()
                != Some(expected.source.raw_hash.as_str())
            {
                repo::mark_unavailable(storage, &id, "failed")?;
            }
        }
    }
    // A crash before the single database publication leaves only opaque orphans.
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let p = entry.path();
        if retained.contains(&p) {
            continue;
        }
        let Some(id) = p.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
        if Uuid::parse_str(id).is_ok()
            && matches!(
                ext,
                "stage" | "txt" | "md" | "docx" | "pdf" | "csv" | "xlsx"
            )
            && entry.file_type()?.is_file()
            && p.canonicalize()?.parent() == Some(root)
        {
            fs::remove_file(p)?;
        }
    }
    Ok(())
}

pub fn clear(storage: &Storage, root: &Path) -> Result<(), AppError> {
    let _lock = operation_lock(root)?;
    for (id, _, _) in repo::files(storage)? {
        delete_unlocked(storage, root, &id)?;
    }
    reconcile_unlocked(storage, root)
}
