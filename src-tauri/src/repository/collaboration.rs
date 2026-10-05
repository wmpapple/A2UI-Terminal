use crate::{domain::collaboration::*, error::AppError, storage::Storage};
use rusqlite::{params, OptionalExtension, Transaction};

pub fn audit(db: &Transaction<'_>, event: &str, id: &str) -> Result<(), AppError> {
    db.execute(
        "INSERT INTO collaboration_audit(event,record_id) VALUES(?1,?2)",
        params![event, id],
    )?;
    Ok(())
}
pub fn identity(storage: &Storage) -> Result<LocalIdentity, AppError> {
    storage.with_read(|db| {
        Ok(db.query_row(
            "SELECT id,display_name FROM collaboration_identity WHERE singleton=1",
            [],
            |r| {
                Ok(LocalIdentity {
                    id: r.get(0)?,
                    display_name: r.get(1)?,
                })
            },
        )?)
    })
}
pub fn rename(storage: &Storage, name: &str) -> Result<LocalIdentity, AppError> {
    storage.with_transaction(|db| {
        db.execute(
            "UPDATE collaboration_identity SET display_name=?1 WHERE singleton=1",
            [name],
        )?;
        audit(db, "identity_updated", "local")
    })?;
    identity(storage)
}
pub struct IssuedShare {
    pub result_id: String,
    pub revision_id: String,
    pub status: String,
    pub package: SharePackage,
}
pub fn issued(storage: &Storage, id: &str) -> Result<IssuedShare, AppError> {
    storage.with_read(|db| {
        let row:Option<(String,String,String,String)> = db.query_row("SELECT s.result_id,s.revision_id,s.status,s.package_json FROM collaboration_shares s JOIN result_ownership o ON o.result_id=s.result_id JOIN collaboration_identity i ON i.id=o.owner_id WHERE s.id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        let (result_id,revision_id,status,json)=row.ok_or_else(||AppError::InvalidInput("分享不存在或已不属于本机".into()))?;
        Ok(IssuedShare{result_id,revision_id,status,package:serde_json::from_str(&json).map_err(|_|AppError::StateUnavailable)?})
    })
}
pub fn create_share(
    storage: &Storage,
    input: &CreateShareInput,
    package: &SharePackage,
) -> Result<(), AppError> {
    let json = serde_json::to_string(package).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        let owned:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM result_ownership o JOIN collaboration_identity i ON o.owner_id=i.id JOIN results r ON r.id=o.result_id WHERE r.id=?1 AND r.current_revision_id=?2)",params![input.result_id,input.revision_id],|r|r.get(0))?;
        if !owned {return Err(AppError::FileConflict);}
        db.execute("INSERT INTO collaboration_shares(id,result_id,revision_id,content_hash,permission,package_json) VALUES(?1,?2,?3,?4,?5,?6)",params![package.id,input.result_id,input.revision_id,package.content_hash,if package.permission==SharePermission::Review {"review"}else{"read"},json])?;
        audit(db,"share_created",&package.id)
    })
}
pub fn revoke(storage: &Storage, id: &str) -> Result<(), AppError> {
    issued(storage, id)?;
    storage.with_transaction(|db| {
        db.execute(
            "UPDATE collaboration_shares SET status='revoked' WHERE id=?1",
            [id],
        )?;
        audit(db, "share_revoked", id)
    })
}
pub fn insert_inbox(
    storage: &Storage,
    id: &str,
    kind: &str,
    hash: &str,
    json: &str,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        let old:Option<String>=db.query_row("SELECT package_hash FROM collaboration_inbox WHERE id=?1",[id],|r|r.get(0)).optional()?;
        if let Some(old)=old { if old!=hash {return Err(AppError::InvalidInput("相同包标识对应了不同内容".into()));} return Ok(()); }
        db.execute("INSERT INTO collaboration_inbox(id,kind,package_hash,package_json) VALUES(?1,?2,?3,?4)",params![id,kind,hash,json])?;
        audit(db,"package_imported",id)
    })
}
pub fn inbox(storage: &Storage, id: &str) -> Result<InboxDetail, AppError> {
    storage.with_read(|db| {
        let row: Option<(String, Option<String>)> = db
            .query_row(
                "SELECT package_json,reply_json FROM collaboration_inbox WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (json, reply) = row.ok_or_else(|| AppError::InvalidInput("收件记录不存在".into()))?;
        Ok(InboxDetail {
            package: serde_json::from_str(&json).map_err(|_| AppError::StateUnavailable)?,
            reply: reply
                .map(|s| serde_json::from_str(&s).map_err(|_| AppError::StateUnavailable))
                .transpose()?,
        })
    })
}
pub fn save_reply(storage: &Storage, id: &str, reply: &FeedbackPackage) -> Result<(), AppError> {
    let json = serde_json::to_string(reply).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        if db.execute(
            "UPDATE collaboration_inbox SET reply_json=?2 WHERE id=?1 AND kind='share'",
            params![id, json],
        )? != 1
        {
            return Err(AppError::FileConflict);
        }
        audit(db, "feedback_saved", id)
    })
}
pub fn mark_handled(storage: &Storage, id: &str) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        if db.execute("UPDATE collaboration_inbox SET handled_at=CURRENT_TIMESTAMP WHERE id=?1 AND handled_at IS NULL", [id])? != 1 {
            return Err(AppError::InvalidInput("收件记录不存在或已处理".into()));
        }
        audit(db, "inbox_handled", id)
    })
}
pub fn review_id(storage: &Storage, id: &str) -> Result<Option<String>, AppError> {
    storage.with_read(|db| {
        Ok(db
            .query_row(
                "SELECT review_id FROM collaboration_reviews WHERE inbox_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?)
    })
}
pub fn bind_review(
    storage: &Storage,
    review: &str,
    share: &str,
    inbox: &str,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        db.execute("INSERT INTO collaboration_reviews(review_id,share_id,inbox_id) VALUES(?1,?2,?3)",params![review,share,inbox])?;
        db.execute("UPDATE review_requests SET source='import_transform',summary='协作建议修改' WHERE id=?1",[review])?;
        db.execute("UPDATE review_blocks SET operation='collaboration_replace',reason='对方建议稿，接受后才修改正文' WHERE review_id=?1",[review])?;
        audit(db,"review_created",inbox)
    })
}
pub fn review_share(storage: &Storage, id: &str) -> Result<String, AppError> {
    storage.with_read(|db| {
        db.query_row(
            "SELECT share_id FROM collaboration_reviews WHERE review_id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::InvalidInput("协作审阅关联已失效".into()))
    })
}
pub fn overview(
    storage: &Storage,
    result_id: Option<&str>,
) -> Result<CollaborationOverview, AppError> {
    let identity = identity(storage)?;
    let (shares,inbox,pending_count)=storage.with_read(|db| {
        let pending_count: i64=db.query_row("SELECT COUNT(*) FROM collaboration_inbox i LEFT JOIN collaboration_reviews cr ON cr.inbox_id=i.id LEFT JOIN review_requests rr ON rr.id=cr.review_id WHERE i.handled_at IS NULL AND i.reply_json IS NULL AND (rr.status IS NULL OR rr.status NOT IN ('applied','rejected'))",[],|r|r.get(0))?;
        let mut q=db.prepare("SELECT s.id,r.title,s.status,s.created_at FROM collaboration_shares s JOIN results r ON r.id=s.result_id WHERE (?1 IS NULL OR s.result_id=?1) ORDER BY s.rowid DESC LIMIT 100")?;
        let shares=q.query_map([result_id],|r|Ok(CollaborationItem{id:r.get(0)?,title:r.get(1)?,kind:"issued".into(),status:r.get(2)?,created_at:r.get(3)?,sender_name:None,permission:None}))?.collect::<Result<Vec<_>,_>>()?;
        let mut q=db.prepare("SELECT i.id,i.kind,i.package_json,i.reply_json IS NOT NULL,i.created_at,rr.status,i.handled_at IS NOT NULL FROM collaboration_inbox i LEFT JOIN collaboration_reviews cr ON cr.inbox_id=i.id LEFT JOIN review_requests rr ON rr.id=cr.review_id ORDER BY i.rowid DESC LIMIT 100")?;
        let rows=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,bool>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,bool>(6)?)))?.collect::<Result<Vec<_>,_>>()?;
        let inbox=rows.into_iter().map(|(id,kind,json,reply,created_at,review_status,handled)|{
            let p:CollaborationPackage=serde_json::from_str(&json).map_err(|_|AppError::StateUnavailable)?;
            let (title,sender_name,permission)=match p {
                CollaborationPackage::Share(s)=>(s.title,Some(s.sender_name),Some(s.permission)),
                CollaborationPackage::Feedback(f)=>{
                    let title=db.query_row("SELECT r.title FROM collaboration_shares s JOIN results r ON r.id=s.result_id WHERE s.id=?1",[&f.share_id],|r|r.get::<_,String>(0)).optional()?.unwrap_or_else(||format!("{} · 审阅意见",f.reviewer_name));
                    (title,Some(f.reviewer_name),None)
                },
            };
            let status=match review_status.as_deref() {
                Some("applied")=>"applied",
                Some("rejected")=>"rejected",
                _ if reply=>"replied",
                _ if handled=>"handled",
                _=>"received",
            };
            Ok(CollaborationItem{id,title,kind,status:status.into(),created_at,sender_name,permission})
        }).collect::<Result<Vec<_>,AppError>>()?;
        Ok((shares,inbox,pending_count))
    })?;
    Ok(CollaborationOverview {
        identity,
        shares,
        inbox,
        pending_count: pending_count as u64,
    })
}
