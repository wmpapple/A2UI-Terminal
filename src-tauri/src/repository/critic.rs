use crate::{
    domain::{critic::CriticReport, document::DocumentTarget},
    error::AppError,
    storage::Storage,
};
use rusqlite::{params, OptionalExtension};

pub fn key(target: &DocumentTarget) -> Result<String, AppError> {
    serde_json::to_string(target).map_err(|_| AppError::StateUnavailable)
}
fn decode(raw: String) -> Result<CriticReport, AppError> {
    serde_json::from_str(&raw).map_err(|_| AppError::StateUnavailable)
}
pub fn find(
    storage: &Storage,
    target: &DocumentTarget,
    engine: &str,
) -> Result<Option<CriticReport>, AppError> {
    storage.with_read(|db| {
        let raw: Option<String> = db
            .query_row(
                "SELECT payload_json FROM critic_reports WHERE target_key=?1 AND engine=?2",
                params![key(target)?, engine],
                |r| r.get(0),
            )
            .optional()?;
        raw.map(decode).transpose()
    })
}
pub fn get(storage: &Storage, id: &str) -> Result<CriticReport, AppError> {
    storage.with_read(|db| {
        let raw = db
            .query_row(
                "SELECT payload_json FROM critic_reports WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(AppError::FileConflict)?;
        decode(raw)
    })
}
pub fn put(storage: &Storage, workspace: &str, report: &CriticReport) -> Result<(), AppError> {
    let result_id = match &report.binding.target {
        DocumentTarget::Result { result_id } => Some(result_id.as_str()),
        _ => None,
    };
    storage.with_transaction(|db| { db.execute("INSERT INTO critic_reports(id,target_key,workspace_id,result_id,engine,payload_json) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(target_key,engine) DO UPDATE SET id=excluded.id,payload_json=excluded.payload_json", params![report.id,key(&report.binding.target)?,workspace,result_id,report.engine,serde_json::to_string(report).map_err(|_|AppError::StateUnavailable)?])?; Ok(()) })
}
