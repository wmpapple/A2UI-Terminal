use crate::{
    domain::{
        collaboration::*,
        document::{DocumentTarget, SelectionSnapshot},
        review::ReviewRequest,
    },
    error::AppError,
    repository::collaboration as repo,
    storage::Storage,
};
use std::path::Path;
use uuid::Uuid;

pub const MAX_PACKAGE_BYTES: usize = 3 * 1024 * 1024;
fn id(value: &str) -> Result<(), AppError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput("协作包标识无效".into()))
}
fn bounded(s: &str, max: usize) -> Result<(), AppError> {
    if s.trim().is_empty() || s.chars().count() > max {
        Err(AppError::InvalidInput(
            "姓名、标题或意见为空或超过长度限制".into(),
        ))
    } else {
        Ok(())
    }
}
fn validate(p: &CollaborationPackage) -> Result<(), AppError> {
    match p {
        CollaborationPackage::Share(s) => {
            id(&s.id)?;
            bounded(&s.sender_name, 80)?;
            bounded(&s.title, 160)?;
            if s.schema_version != 1
                || !["markdown", "text"].contains(&s.format.as_str())
                || s.content.len() > 1024 * 1024
                || crate::parser::hash(s.content.as_bytes()) != s.content_hash
            {
                return Err(AppError::InvalidInput(
                    "分享包版本、格式或正文校验失败".into(),
                ));
            }
        }
        CollaborationPackage::Feedback(f) => {
            id(&f.id)?;
            id(&f.share_id)?;
            bounded(&f.reviewer_name, 80)?;
            if f.schema_version != 1
                || f.base_hash.len() != 64
                || !f.base_hash.bytes().all(|b| b.is_ascii_hexdigit())
                || f.comments.chars().count() > 8000
                || f.proposed_content
                    .as_ref()
                    .is_some_and(|s| s.len() > 1024 * 1024)
                || (f.comments.trim().is_empty() && f.proposed_content.is_none())
            {
                return Err(AppError::InvalidInput("意见包版本或内容无效".into()));
            }
        }
    }
    Ok(())
}
pub fn overview(
    storage: &Storage,
    result_id: Option<&str>,
) -> Result<CollaborationOverview, AppError> {
    repo::overview(storage, result_id)
}
pub fn rename(storage: &Storage, name: &str) -> Result<LocalIdentity, AppError> {
    bounded(name, 80)?;
    repo::rename(storage, name.trim())
}
pub fn create_share(
    storage: &Storage,
    root: &Path,
    input: CreateShareInput,
) -> Result<SharePackage, AppError> {
    let snap = super::document::snapshot(
        storage,
        root,
        &DocumentTarget::Result {
            result_id: input.result_id.clone(),
        },
    )?;
    if !snap.editable
        || snap.has_unsaved_draft
        || snap.content_hash != input.base_hash
        || snap.revision_id.as_deref() != Some(&input.revision_id)
    {
        return Err(AppError::FileConflict);
    }
    let title = super::result::get(storage, &input.result_id)?.summary.title;
    let package = SharePackage {
        schema_version: 1,
        id: Uuid::new_v4().to_string(),
        sender_name: repo::identity(storage)?.display_name,
        title,
        format: snap.format,
        permission: input.permission.clone(),
        content: snap.text,
        content_hash: snap.content_hash,
    };
    validate(&CollaborationPackage::Share(package.clone()))?;
    repo::create_share(storage, &input, &package)?;
    Ok(package)
}
pub fn revoke(storage: &Storage, id: &str) -> Result<(), AppError> {
    repo::revoke(storage, id)
}
pub fn inbox(storage: &Storage, id: &str) -> Result<InboxDetail, AppError> {
    repo::inbox(storage, id)
}
pub fn import_bytes(storage: &Storage, bytes: &[u8]) -> Result<String, AppError> {
    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err(AppError::FileTooLarge);
    }
    let package: CollaborationPackage = serde_json::from_slice(bytes)
        .map_err(|_| AppError::InvalidInput("不是受支持的协作包".into()))?;
    validate(&package)?;
    let (id, kind) = match &package {
        CollaborationPackage::Share(s) => (&s.id, "share"),
        CollaborationPackage::Feedback(f) => {
            let issued = repo::issued(storage, &f.share_id)?;
            if issued.status != "active"
                || issued.package.permission != SharePermission::Review
                || issued.package.content_hash != f.base_hash
            {
                return Err(AppError::InvalidInput("反馈不属于有效的可审阅分享".into()));
            }
            (&f.id, "feedback")
        }
    };
    let json = serde_json::to_string(&package).map_err(|_| AppError::StateUnavailable)?;
    repo::insert_inbox(
        storage,
        id,
        kind,
        &crate::parser::hash(json.as_bytes()),
        &json,
    )?;
    Ok(id.clone())
}
pub fn save_feedback(
    storage: &Storage,
    input: SaveFeedbackInput,
) -> Result<FeedbackPackage, AppError> {
    let detail = repo::inbox(storage, &input.inbox_id)?;
    let CollaborationPackage::Share(share) = detail.package else {
        return Err(AppError::InvalidInput("请选择收到的分享包".into()));
    };
    if share.permission != SharePermission::Review {
        return Err(AppError::InvalidInput("此分享只允许阅读".into()));
    }
    let feedback = FeedbackPackage {
        schema_version: 1,
        id: Uuid::new_v4().to_string(),
        share_id: share.id,
        base_hash: share.content_hash,
        reviewer_name: repo::identity(storage)?.display_name,
        comments: input.comments,
        proposed_content: input.proposed_content,
    };
    validate(&CollaborationPackage::Feedback(feedback.clone()))?;
    repo::save_reply(storage, &input.inbox_id, &feedback)?;
    Ok(feedback)
}
pub fn export_package(storage: &Storage, id: &str, feedback: bool) -> Result<Vec<u8>, AppError> {
    let package = if feedback {
        CollaborationPackage::Feedback(
            repo::inbox(storage, id)?
                .reply
                .ok_or_else(|| AppError::InvalidInput("请先保存审阅意见".into()))?,
        )
    } else {
        let issued = repo::issued(storage, id)?;
        if issued.status != "active" {
            return Err(AppError::InvalidInput("分享已撤销".into()));
        }
        CollaborationPackage::Share(issued.package)
    };
    validate(&package)?;
    let bytes = serde_json::to_vec_pretty(&package).map_err(|_| AppError::StateUnavailable)?;
    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err(AppError::FileTooLarge);
    }
    Ok(bytes)
}
fn current_snapshot(
    storage: &Storage,
    root: &Path,
    share: &str,
) -> Result<crate::domain::document::DocumentSnapshot, AppError> {
    let issued = repo::issued(storage, share)?;
    if issued.status != "active" || issued.package.permission != SharePermission::Review {
        return Err(AppError::InvalidInput("分享已撤销或不允许修改建议".into()));
    }
    let snapshot = super::document::snapshot(
        storage,
        root,
        &DocumentTarget::Result {
            result_id: issued.result_id,
        },
    )?;
    if !snapshot.editable
        || snapshot.has_unsaved_draft
        || snapshot.content_hash != issued.package.content_hash
        || snapshot.revision_id.as_deref() != Some(&issued.revision_id)
    {
        return Err(AppError::FileConflict);
    }
    Ok(snapshot)
}
pub fn guard_review(storage: &Storage, root: &Path, review_id: &str) -> Result<(), AppError> {
    let share = repo::review_share(storage, review_id)?;
    current_snapshot(storage, root, &share).map(|_| ())
}
pub fn propose(storage: &Storage, root: &Path, inbox_id: &str) -> Result<ReviewRequest, AppError> {
    let detail = repo::inbox(storage, inbox_id)?;
    let CollaborationPackage::Feedback(feedback) = detail.package else {
        return Err(AppError::InvalidInput("请选择收到的审阅意见".into()));
    };
    let snapshot = current_snapshot(storage, root, &feedback.share_id)?;
    if let Some(id) = repo::review_id(storage, inbox_id)? {
        return super::review::get(storage, &id);
    }
    let content = feedback
        .proposed_content
        .ok_or_else(|| AppError::InvalidInput("此意见只有评论，没有建议修改稿".into()))?;
    let selection = SelectionSnapshot {
        target: snapshot.target.clone(),
        revision_id: snapshot.revision_id.clone(),
        content_hash: snapshot.content_hash.clone(),
        start: 0,
        end: snapshot.text.encode_utf16().count(),
        offset_unit: crate::parser::OffsetUnit::Utf16,
        selected_text_hash: snapshot.content_hash.clone(),
    };
    // Tagged before persistence: missing bindings fail closed, including concurrent apply.
    let review =
        super::review::create_collaboration_replacement(storage, &snapshot, &selection, &content)?;
    repo::bind_review(storage, &review.id, &feedback.share_id, inbox_id)?;
    super::review::get(storage, &review.id)
}
