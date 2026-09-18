use crate::domain::recovery::{RecoveryExportJob, RecoveryResultDraftSummary, RecoveryStatus};
use crate::error::AppError;
use crate::storage::Storage;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

pub fn reconcile_startup(storage: &Storage, managed_results_dir: &Path) -> Result<(), AppError> {
    super::task::recover_pending_runs(storage, managed_results_dir)?;
    reconcile_export_jobs(storage)
}

pub fn reconcile_export_jobs(storage: &Storage) -> Result<(), AppError> {
    for job in storage.unfinished_export_jobs()? {
        match job.status.as_str() {
            "committed" => {
                storage.finish_export_job(&job.id, "completed", None, true)?;
            }
            "writing" => {
                let committed = job
                    .target_path
                    .as_deref()
                    .zip(job.output_hash.as_deref())
                    .and_then(|(path, expected)| fs::read(path).ok().map(|bytes| (bytes, expected)))
                    .is_some_and(|(bytes, expected)| sha256_hex(&bytes) == expected);
                if committed {
                    storage.finish_export_job(&job.id, "completed", None, true)?;
                } else {
                    storage.finish_export_job(
                        &job.id,
                        "interrupted",
                        Some("EXPORT_INTERRUPTED"),
                        true,
                    )?;
                }
            }
            "preparing" | "generating" => {
                storage.finish_export_job(
                    &job.id,
                    "interrupted",
                    Some("EXPORT_INTERRUPTED"),
                    true,
                )?;
            }
            _ => return Err(AppError::StateUnavailable),
        }
    }
    Ok(())
}

pub fn status(storage: &Storage) -> Result<RecoveryStatus, AppError> {
    let mut seen_export_kinds = HashSet::new();
    Ok(RecoveryStatus {
        schema_version: storage.schema_version()?,
        result_drafts: storage
            .result_draft_summaries()?
            .into_iter()
            .map(|row| RecoveryResultDraftSummary {
                result_id: row.result_id,
                title: row.title,
                updated_at: row.updated_at,
            })
            .collect(),
        active_review_count: storage.active_review_count()?,
        recovered_task_count: storage.recovered_task_count()?,
        export_jobs: storage
            .recent_export_jobs()?
            .into_iter()
            .filter(|row| seen_export_kinds.insert((row.result_id.clone(), row.format.clone())))
            .map(|row| RecoveryExportJob {
                id: row.id,
                result_id: row.result_id,
                revision_id: row.revision_id,
                format: row.format,
                status: row.status,
                file_name: row.file_name,
                error_code: row.error_code,
                recovered: row.recovered,
                updated_at: row.updated_at,
            })
            .collect(),
    })
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::result::{CreateTextResultInput, ResultType, TextResultFormat};
    use crate::storage::Storage;

    #[test]
    fn a_writing_export_is_completed_only_when_the_committed_bytes_match() {
        let storage = Storage::open_in_memory().unwrap();
        let managed = tempfile::tempdir().unwrap();
        let result = crate::application::result::create_text(
            &storage,
            managed.path(),
            CreateTextResultInput {
                title: "恢复测试".into(),
                file_name: "recovery.md".into(),
                result_type: ResultType::Document,
                format: TextResultFormat::Markdown,
            },
        )
        .unwrap();
        let revision_id = result.result.summary.current_revision_id.unwrap();
        let target = managed.path().join("export.md");
        fs::write(&target, b"committed").unwrap();
        storage
            .create_export_job(
                "job-ok",
                &result.result.summary.id,
                &revision_id,
                "markdown",
            )
            .unwrap();
        storage
            .set_export_job_target("job-ok", target.to_str().unwrap(), "export.md")
            .unwrap();
        storage
            .mark_export_job_writing("job-ok", &sha256_hex(b"committed"))
            .unwrap();
        storage
            .create_export_job(
                "job-bad",
                &result.result.summary.id,
                &revision_id,
                "markdown",
            )
            .unwrap();
        storage
            .set_export_job_target("job-bad", target.to_str().unwrap(), "export.md")
            .unwrap();
        storage
            .mark_export_job_writing("job-bad", &sha256_hex(b"different"))
            .unwrap();

        reconcile_export_jobs(&storage).unwrap();
        let jobs = storage.recent_export_jobs().unwrap();
        assert_eq!(
            jobs.iter().find(|job| job.id == "job-ok").unwrap().status,
            "completed"
        );
        assert_eq!(
            jobs.iter().find(|job| job.id == "job-bad").unwrap().status,
            "interrupted"
        );
        assert_eq!(fs::read(&target).unwrap(), b"committed");

        storage
            .create_export_job(
                "job-retry",
                &result.result.summary.id,
                &revision_id,
                "markdown",
            )
            .unwrap();
        storage
            .finish_export_job("job-retry", "completed", None, false)
            .unwrap();
        let recovery_status = status(&storage).unwrap();
        assert_eq!(recovery_status.export_jobs.len(), 1);
        assert_eq!(recovery_status.export_jobs[0].id, "job-retry");
    }
}
