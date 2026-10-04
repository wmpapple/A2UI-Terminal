use crate::{
    a2ui::{A2uiSurfaceState, A2uiValidation},
    application::result::{SurfaceToolSnapshot, MANAGED_RESULTS_WORKSPACE_ID},
    domain::result::ResultDetail,
    error::AppError,
    storage::{A2uiSurfaceRow, Storage},
};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Publication {
    pub result_id: String,
    pub revision_id: String,
    pub title: String,
    pub revision_number: i64,
    pub synced: bool,
}

pub fn list_ids(storage: &Storage) -> Result<Vec<String>, AppError> {
    storage.with_read(|db| {
        let mut query = db.prepare("SELECT r.id FROM scene_tool_instances t JOIN results r ON r.id=t.tool_result_id WHERE r.status<>'archived' ORDER BY r.updated_at DESC,r.id DESC")?;
        let rows = query.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn publication(storage: &Storage, id: &str) -> Result<Option<Publication>, AppError> {
    storage.with_read(|db| {
        Ok(db.query_row(
            "SELECT published.id,published.current_revision_id,published.title,
                    (SELECT COUNT(*) FROM document_versions v WHERE v.workspace_id=published.workspace_id AND v.relative_path=published.storage_ref),
                    CASE WHEN surface.state_json=published.managed_state_json THEN 1 ELSE 0 END
             FROM scene_tool_instances tool
             JOIN results source ON source.id=tool.tool_result_id
             JOIN a2ui_surfaces surface ON surface.id=source.a2ui_surface_row_id
             JOIN results published ON published.id=tool.published_result_id
             WHERE tool.tool_result_id=?1",
            [id],
            |r| Ok(Publication {
                result_id: r.get(0)?,
                revision_id: r.get(1)?,
                title: r.get(2)?,
                revision_number: r.get(3)?,
                synced: r.get::<_, i64>(4)? != 0,
            }),
        ).optional()?)
    })
}

pub fn template_id(storage: &Storage, id: &str) -> Result<String, AppError> {
    storage.with_read(|db| {
        Ok(db.query_row(
            "SELECT template_id FROM scene_tool_instances WHERE tool_result_id=?1",
            [id],
            |r| r.get(0),
        )?)
    })
}

pub fn rename(storage: &Storage, id: &str, title: &str) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        if db.execute(
            "UPDATE results SET title=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND EXISTS(SELECT 1 FROM scene_tool_instances WHERE tool_result_id=?1)",
            params![id, title],
        )? != 1
        {
            return Err(AppError::InvalidInput("场景工具不存在".into()));
        }
        Ok(())
    })
}

// Explicit publication is an immutable snapshot until the user's next publish.
// Compare both the tool state and prior publication inside one transaction.
pub fn publish(
    storage: &Storage,
    result: &ResultDetail,
    row: &A2uiSurfaceRow,
    snapshot: &SurfaceToolSnapshot,
    expected_revision: Option<&str>,
    title: Option<&str>,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        let (live, published): (String, Option<String>) = db.query_row("SELECT s.state_json,t.published_result_id FROM scene_tool_instances t JOIN results r ON r.id=t.tool_result_id JOIN a2ui_surfaces s ON s.id=r.a2ui_surface_row_id WHERE t.tool_result_id=?1", [&result.summary.id], |r| Ok((r.get(0)?,r.get(1)?)))?;
        if live != row.state_json { return Err(AppError::FileConflict); }
        let old_revision: Option<String> = match &published {
            Some(id) => db.query_row("SELECT current_revision_id FROM results WHERE id=?1", [id], |r| r.get(0))?,
            None => None,
        };
        if old_revision.as_deref() != expected_revision { return Err(AppError::FileConflict); }
        let id = published.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        let reference = format!("result://a2ui/{id}");
        let revision = Uuid::new_v4().to_string();
        db.execute("INSERT INTO document_versions(id,workspace_id,relative_path,content,content_hash,expires_at,version_kind,source,summary) VALUES(?1,?2,?3,?4,?5,datetime('now','+30 days'),'snapshot','patch','手动保存场景工具成果')",params![revision,row.workspace_id,reference,snapshot.content.as_bytes(),snapshot.content_hash])?;
        if published.is_some() {
            db.execute("UPDATE results SET title=COALESCE(?2,title),managed_state_json=?3,current_revision_id=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1",params![id,title,row.state_json,revision])?;
        } else {
            db.execute("INSERT INTO results(id,workspace_id,result_type,title,status,storage_kind,storage_ref,source_kind,source_ref,current_revision_id,managed_state_json) VALUES(?1,?2,'tool',?3,'ready','managed_local',?4,'a2ui_surface',?5,?6,?7)",params![id,row.workspace_id,title.unwrap_or(&result.summary.title),reference,format!("scene-snapshot-{id}"),revision,row.state_json])?;
            db.execute("UPDATE scene_tool_instances SET published_result_id=?2 WHERE tool_result_id=?1",params![result.summary.id,id])?;
        }
        Ok(())
    })
}

pub fn create(
    storage: &Storage,
    state: &A2uiSurfaceState,
    json: &str,
    snapshot: &SurfaceToolSnapshot,
    binding: &crate::application::scene_link::ToolBinding,
    target: Option<(&str, &str, Option<&str>)>,
    template: (&str, &str),
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    let session = Uuid::new_v4().to_string();
    let surface_row = Uuid::new_v4().to_string();
    let revision = Uuid::new_v4().to_string();
    let reference = format!("result://a2ui/{id}");
    let validation = serde_json::to_string(&A2uiValidation {
        valid: true,
        errors: vec![],
        warnings: vec![],
        duration_ms: 0,
        error_code: None,
        negotiation: None,
    })
    .map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        db.execute("INSERT INTO sessions(id,workspace_id,title) VALUES(?1,?2,?3)",params![session,MANAGED_RESULTS_WORKSPACE_ID,snapshot.title])?;
        db.execute("INSERT INTO a2ui_surfaces(id,surface_id,workspace_id,session_id,message_id,protocol_version,revision,state_json,raw_message,validation_json) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?8,?9)", params![surface_row,state.surface_id,MANAGED_RESULTS_WORKSPACE_ID,session,Uuid::new_v4().to_string(),state.protocol_version,json,"{\"source\":\"scene_tool\"}",validation])?;
        db.execute("INSERT INTO document_versions(id,workspace_id,relative_path,content,content_hash,expires_at,version_kind,source,summary) VALUES(?1,?2,?3,?4,?5,datetime('now','+30 days'),'snapshot','initial','创建场景工具')", params![revision,MANAGED_RESULTS_WORKSPACE_ID,reference,snapshot.content.as_bytes(),snapshot.content_hash])?;
        db.execute("INSERT INTO results(id,workspace_id,result_type,title,status,storage_kind,storage_ref,source_kind,source_ref,current_revision_id,active_session_id,a2ui_surface_row_id,managed_state_json) VALUES(?1,?2,'tool',?3,'ready','managed_local',?4,'a2ui_surface',?5,?6,?7,?8,?9)",params![id,MANAGED_RESULTS_WORKSPACE_ID,snapshot.title,reference,state.surface_id,revision,session,surface_row,json])?;
        super::scene_link::insert(db,&id,binding,target)?;
        db.execute("INSERT INTO scene_tool_instances(tool_result_id,template_id,binding_policy) VALUES(?1,?2,?3)",params![id,template.0,template.1])?;
        Ok(())
    })?;
    Ok(id)
}

pub fn save(
    storage: &Storage,
    result: &ResultDetail,
    row: &A2uiSurfaceRow,
    json: &str,
    snapshot: &SurfaceToolSnapshot,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        // Compare the complete authoritative state inside the write transaction.
        let changed = db.execute("UPDATE a2ui_surfaces SET state_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state_json=?3 AND EXISTS(SELECT 1 FROM results WHERE id=?4 AND a2ui_surface_row_id=?1 AND source_kind='a2ui_surface' AND source_ref=?5)",params![row.id,json,row.state_json,result.summary.id,row.surface_id])?;
        if changed != 1 { return Err(AppError::FileConflict); }
        if json == row.state_json { return Ok(()); }
        db.execute("UPDATE scene_tool_bindings SET reviewed_hash=NULL,reviewed_revision_id=NULL,reviewed_at=NULL,version=?2 WHERE tool_result_id=?1 AND reviewed_at IS NOT NULL",params![result.summary.id,Uuid::new_v4().to_string()])?;
        let revision = Uuid::new_v4().to_string();
        db.execute("INSERT INTO document_versions(id,workspace_id,relative_path,content,content_hash,expires_at,version_kind,source,summary) VALUES(?1,?2,?3,?4,?5,datetime('now','+30 days'),'snapshot','autosave','保存场景工具填写内容')",params![revision,row.workspace_id,result.storage_ref,snapshot.content.as_bytes(),snapshot.content_hash])?;
        db.execute("UPDATE results SET managed_state_json=?2,current_revision_id=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1",params![result.summary.id,json,revision])?;
        db.execute("INSERT INTO a2ui_events(id,surface_row_id,component_id,event_name,action_type,risk,decision,payload_json,duration_ms) VALUES(?1,?2,'root','save','set_state','low','allowed','{}',0)",params![Uuid::new_v4().to_string(),row.id])?;
        db.execute("DELETE FROM document_versions WHERE workspace_id=?1 AND relative_path=?2 AND id NOT IN (SELECT id FROM document_versions WHERE workspace_id=?1 AND relative_path=?2 ORDER BY created_at DESC,rowid DESC LIMIT 100)",params![row.workspace_id,result.storage_ref])?;
        Ok(())
    })
}
