use crate::{domain::writing_project::*, error::AppError, storage::Storage};
use rusqlite::{params, OptionalExtension};

fn decode(json: &str) -> Result<WritingProject, AppError> {
    serde_json::from_str(json).map_err(|_| AppError::StateUnavailable)
}
pub fn get(storage: &Storage, id: &str) -> Result<WritingProject, AppError> {
    let json = storage
        .with_read(|db| {
            Ok(db
                .query_row(
                    "SELECT payload_json FROM writing_projects WHERE id=?1",
                    [id],
                    |r| r.get::<_, String>(0),
                )
                .optional()?)
        })?
        .ok_or_else(|| AppError::InvalidInput("长文项目不存在或工作区已移除".into()))?;
    decode(&json)
}
pub fn list(storage: &Storage, workspace: &str) -> Result<Vec<WritingProject>, AppError> {
    let rows = storage.with_read(|db| {
        let mut s=db.prepare("SELECT payload_json FROM writing_projects WHERE workspace_id=?1 ORDER BY updated_at DESC,rowid DESC LIMIT 100")?;
        let rows=s.query_map([workspace],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
        Ok(rows)
    })?;
    rows.iter().map(|j| decode(j)).collect()
}
pub fn create(storage: &Storage, project: &WritingProject) -> Result<(), AppError> {
    let json = serde_json::to_string(project).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {db.execute("INSERT INTO writing_projects(id,workspace_id,revision,payload_json) VALUES(?1,?2,?3,?4)",params![project.id,project.workspace_id,project.revision,json])?;Ok(())})
}
pub fn save(storage: &Storage, project: &mut WritingProject) -> Result<(), AppError> {
    let before = project.revision;
    project.revision += 1;
    let json = serde_json::to_string(project).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        if db.execute("UPDATE writing_projects SET revision=?2,payload_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND revision=?4",params![project.id,project.revision,json,before])? != 1 {return Err(AppError::FileConflict);}
        Ok(())
    })
}
pub fn delete(storage: &Storage, id: &str) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        db.execute("DELETE FROM writing_projects WHERE id=?1", [id])?;
        Ok(())
    })
}
fn run_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<WritingRun> {
    let json: String = r.get(8)?;
    Ok(WritingRun {
        draft: r
            .get::<_, Option<String>>(10)?
            .map(|j| {
                serde_json::from_str(&j).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        10,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
            })
            .transpose()?,
        id: r.get(0)?,
        project_id: r.get(1)?,
        section_id: r.get(2)?,
        project_revision: r.get(3)?,
        request_id: r.get(4)?,
        status: r.get(5)?,
        content: r.get(6)?,
        error: r.get(7)?,
        snapshot: serde_json::from_str(&json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(e))
        })?,
        created_at: r.get(9)?,
    })
}
pub fn runs(storage: &Storage, id: &str) -> Result<Vec<WritingRun>, AppError> {
    storage.with_read(|db| {
        let mut s=db.prepare("SELECT id,project_id,section_id,project_revision,request_id,status,content,error,snapshot_json,created_at,draft_json FROM writing_project_runs WHERE project_id=?1 ORDER BY rowid DESC LIMIT 100")?;
        let rows=s.query_map([id],run_row)?.collect::<Result<Vec<_>,_>>()?;Ok(rows)
    })
}
pub fn run(storage: &Storage, id: &str) -> Result<WritingRun, AppError> {
    storage.with_read(|db|Ok(db.query_row("SELECT id,project_id,section_id,project_revision,request_id,status,content,error,snapshot_json,created_at,draft_json FROM writing_project_runs WHERE id=?1",[id],run_row)?))
}
pub fn start_run(storage: &Storage, run: &WritingRun) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        let revision:i64=db.query_row("SELECT revision FROM writing_projects WHERE id=?1",[&run.project_id],|r|r.get(0))?;
        if revision!=run.project_revision {return Err(AppError::FileConflict);}
        db.execute("INSERT INTO writing_project_runs(id,project_id,section_id,project_revision,request_id,status,snapshot_json) VALUES(?1,?2,?3,?4,?5,'running',?6)",params![run.id,run.project_id,run.section_id,run.project_revision,run.request_id,serde_json::to_string(&run.snapshot).map_err(|_|AppError::StateUnavailable)?])?;Ok(())
    })
}
pub fn progress(
    storage: &Storage,
    id: &str,
    content: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        if db.execute("UPDATE writing_project_runs SET content=?2,status=?3,error=?4 WHERE id=?1 AND status='running'",params![id,content,status,error])? != 1 {return Err(AppError::RequestCancelled);}
        Ok(())
    })
}
pub fn recover(storage: &Storage) -> Result<(), AppError> {
    storage.with_transaction(|db| {db.execute("UPDATE writing_project_runs SET status='interrupted',error='程序退出时生成尚未完成，请审阅已有内容或主动重试；不会自动重发。' WHERE status='running'",[])?;Ok(())})
}
pub fn set_decision(storage: &Storage, id: &str, accepted: bool) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        db.execute(
            "UPDATE writing_project_runs SET status=?2 WHERE id=?1 AND status<>'running'",
            params![id, if accepted { "accepted" } else { "discarded" }],
        )?;
        Ok(())
    })
}
pub fn save_draft(storage: &Storage, id: &str, draft: &WritingDraft) -> Result<(), AppError> {
    let json = serde_json::to_string(draft).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        if db.execute("UPDATE writing_project_runs SET draft_json=?2 WHERE id=?1 AND section_id IS NOT NULL AND status<>'running'",params![id,json])?!=1 {return Err(AppError::FileConflict);} Ok(())
    })
}
