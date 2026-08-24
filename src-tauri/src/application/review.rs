use crate::domain::review::{
    ApplyReviewInput, CreateFileProposal, CreateReviewRequestInput, DecideReviewBlocksInput,
    ReplaceEmptyFileProposal, ResolveReviewConflictInput, ReviewApplication, ReviewAppliedFile,
    ReviewBlockStatus, ReviewConflictResolution, ReviewOperationKind, ReviewRequest, ReviewRisk,
    ReviewStatus,
};
use crate::error::AppError;
use crate::patch::{self, AppliedPatchFile, DocumentPatch, PatchOperation, PatchRisk};
use crate::repository::review::{kind_str, risk_str, source_str, ReviewRepository};
use crate::storage::{NewReviewBlockRow, NewReviewRequestRow, Storage};
use crate::workspace;
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

const MAX_RAW_REVIEW_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StoredReviewPayload {
    DocumentPatch {
        patch: DocumentPatch,
        candidate_files: Vec<AppliedPatchFile>,
    },
    CreateFile {
        proposal: CreateFileProposal,
    },
    ReplaceResult {
        path: String,
        base_hash: String,
        content: String,
    },
}

pub fn create(
    storage: &Storage,
    input: CreateReviewRequestInput,
) -> Result<ReviewRequest, AppError> {
    validate_id(&input.workspace_id, "工作区标识无效")?;
    if storage.workspace(&input.workspace_id)?.is_none() {
        return Err(AppError::InvalidInput("工作区不存在".into()));
    }
    if input.raw.is_empty() || input.raw.len() > MAX_RAW_REVIEW_BYTES {
        return Err(AppError::InvalidInput("AI 审阅候选为空或超过 2 MiB".into()));
    }
    let json = patch::extract_json(&input.raw)
        .ok_or_else(|| AppError::InvalidInput("AI 响应中没有有效的审阅 JSON".into()))?;
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| AppError::InvalidInput(format!("Review Schema 无效：{error}")))?;
    match value.get("type").and_then(serde_json::Value::as_str) {
        Some("document_patch") => create_document_patch(storage, &input, json),
        Some("create_file") => create_file(storage, &input, json),
        Some("replace_empty_file") => create_empty_replace(storage, &input, json),
        _ => Err(AppError::InvalidInput("不支持的 AI 审阅候选类型".into())),
    }
}

pub fn get(storage: &Storage, review_id: &str) -> Result<ReviewRequest, AppError> {
    validate_id(review_id, "审阅标识无效")?;
    ReviewRepository::new(storage)
        .get(review_id)?
        .ok_or_else(|| AppError::InvalidInput("找不到指定审阅".into()))
}

pub fn list_active(storage: &Storage, workspace_id: &str) -> Result<Vec<ReviewRequest>, AppError> {
    validate_id(workspace_id, "工作区标识无效")?;
    ReviewRepository::new(storage).list_active(workspace_id)
}

pub fn decide(
    storage: &Storage,
    input: DecideReviewBlocksInput,
) -> Result<ReviewRequest, AppError> {
    validate_id(&input.review_id, "审阅标识无效")?;
    validate_id(&input.workspace_id, "工作区标识无效")?;
    let current = get(storage, &input.review_id)?;
    if current.workspace_id != input.workspace_id || current.status != ReviewStatus::Pending {
        return Err(AppError::InvalidInput(
            "审阅不属于当前工作区或已决定".into(),
        ));
    }
    if input.decisions.len() != current.blocks.len() || input.decisions.is_empty() {
        return Err(AppError::InvalidInput("必须明确决定每一个审阅块".into()));
    }
    let raw_row = storage
        .review_request(&input.review_id)?
        .ok_or(AppError::StateUnavailable)?;
    let mut payload: StoredReviewPayload =
        serde_json::from_str(&raw_row.payload_json).map_err(|_| AppError::StateUnavailable)?;
    let create_format = match &payload {
        StoredReviewPayload::CreateFile { proposal } => Some(proposal.format),
        _ => None,
    };
    let decisions = input
        .decisions
        .into_iter()
        .map(|decision| {
            let block = current
                .blocks
                .iter()
                .find(|block| block.id == decision.block_id)
                .ok_or_else(|| AppError::InvalidInput("审阅块标识无效".into()))?;
            let file_name = if decision.accepted {
                match (
                    create_format,
                    decision
                        .file_name
                        .or_else(|| block.suggested_file_name.clone()),
                ) {
                    (Some(format), Some(name)) => {
                        Some(super::result::validate_file_name(&name, format)?)
                    }
                    (Some(_), None) => {
                        return Err(AppError::InvalidInput("创建文件必须确认文件名".into()))
                    }
                    (None, Some(_)) => {
                        return Err(AppError::InvalidInput(
                            "只有创建文件审阅可以调整名称".into(),
                        ))
                    }
                    (None, None) => None,
                }
            } else {
                None
            };
            Ok((
                decision.block_id,
                if decision.accepted {
                    "accepted"
                } else {
                    "rejected"
                }
                .to_string(),
                file_name,
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    if let StoredReviewPayload::DocumentPatch {
        patch,
        candidate_files,
    } = &mut payload
    {
        let selected = decisions
            .iter()
            .filter(|(_, status, _)| status == "accepted")
            .map(|(id, _, _)| id.clone())
            .collect::<Vec<_>>();
        if !selected.is_empty() {
            *candidate_files =
                patch::preview_patch_files(storage, &input.workspace_id, patch, &selected)?;
        }
    }
    let payload_json = serde_json::to_string(&payload).map_err(|_| AppError::StateUnavailable)?;
    storage.decide_review_blocks(&input.review_id, &decisions, Some(&payload_json))?;
    get(storage, &input.review_id)
}

pub fn apply(
    storage: &Storage,
    managed_results_dir: &Path,
    input: ApplyReviewInput,
) -> Result<ReviewApplication, AppError> {
    validate_id(&input.review_id, "审阅标识无效")?;
    let current = get(storage, &input.review_id)?;
    if current.workspace_id != input.workspace_id {
        return Err(AppError::InvalidInput("审阅不属于当前工作区".into()));
    }
    if current.status == ReviewStatus::Applied {
        return applied_view(storage, managed_results_dir, &current);
    }
    if !matches!(
        current.status,
        ReviewStatus::Accepted | ReviewStatus::PartiallyAccepted
    ) {
        return Err(AppError::InvalidInput("审阅尚未接受或已结束".into()));
    }
    let row = storage
        .review_request(&input.review_id)?
        .ok_or(AppError::StateUnavailable)?;
    let payload: StoredReviewPayload =
        serde_json::from_str(&row.payload_json).map_err(|_| AppError::StateUnavailable)?;
    let accepted = current
        .blocks
        .iter()
        .filter(|block| block.status == ReviewBlockStatus::Accepted)
        .collect::<Vec<_>>();
    let result = match payload {
        StoredReviewPayload::DocumentPatch { patch, .. } => {
            let selected = accepted
                .iter()
                .map(|block| block.id.clone())
                .collect::<Vec<_>>();
            patch::apply_patch_for_review(
                storage,
                &input.workspace_id,
                patch,
                &selected,
                None,
                None,
                Some(&input.review_id),
            )
            .map(|application| ReviewApplication {
                review_id: input.review_id.clone(),
                status: ReviewStatus::Applied,
                operation_id: Some(application.operation_id),
                files: application
                    .files
                    .into_iter()
                    .map(|file| ReviewAppliedFile {
                        path: file.path,
                        content: file.content,
                        content_hash: file.content_hash,
                    })
                    .collect(),
                result: None,
            })
        }
        StoredReviewPayload::CreateFile { proposal } => {
            let block = accepted
                .first()
                .ok_or_else(|| AppError::InvalidInput("创建文件审阅未被接受".into()))?;
            let file_name = block
                .decided_file_name
                .as_deref()
                .ok_or_else(|| AppError::InvalidInput("创建文件名尚未确认".into()))?;
            super::result::create_from_review(
                storage,
                managed_results_dir,
                &input.review_id,
                &proposal.title,
                file_name,
                proposal.format,
                &proposal.content,
            )
            .map(|document| ReviewApplication {
                review_id: input.review_id.clone(),
                status: ReviewStatus::Applied,
                operation_id: None,
                files: Vec::new(),
                result: Some(document),
            })
        }
        StoredReviewPayload::ReplaceResult {
            path,
            base_hash,
            content,
        } => patch::apply_full_replace_for_review(
            storage,
            &input.workspace_id,
            &path,
            &base_hash,
            &content,
            &current.summary,
            &input.review_id,
        )
        .map(|application| ReviewApplication {
            review_id: input.review_id.clone(),
            status: ReviewStatus::Applied,
            operation_id: Some(application.operation_id),
            files: application
                .files
                .into_iter()
                .map(|file| ReviewAppliedFile {
                    path: file.path,
                    content: file.content,
                    content_hash: file.content_hash,
                })
                .collect(),
            result: None,
        }),
    };
    match result {
        Err(AppError::FileConflict) => {
            storage.mark_review_error(&input.review_id, "conflicted", "FILE_CONFLICT")?;
            Err(AppError::FileConflict)
        }
        Err(error) => {
            storage.mark_review_error(&input.review_id, "failed", error.code())?;
            Err(error)
        }
        result => result,
    }
}

pub fn discard(
    storage: &Storage,
    workspace_id: &str,
    review_id: &str,
) -> Result<ReviewRequest, AppError> {
    let current = get(storage, review_id)?;
    if current.workspace_id != workspace_id {
        return Err(AppError::InvalidInput("审阅不属于当前工作区".into()));
    }
    if !storage.discard_review(review_id)? {
        return Err(AppError::InvalidInput("审阅已应用或不能丢弃".into()));
    }
    get(storage, review_id)
}

pub fn resolve_conflict(
    storage: &Storage,
    managed_results_dir: &Path,
    input: ResolveReviewConflictInput,
) -> Result<ReviewApplication, AppError> {
    validate_id(&input.review_id, "审阅标识无效")?;
    let current = get(storage, &input.review_id)?;
    if current.workspace_id != input.workspace_id || current.status != ReviewStatus::Conflicted {
        return Err(AppError::InvalidInput(
            "审阅不属于当前工作区或没有待处理冲突".into(),
        ));
    }
    match input.resolution {
        ReviewConflictResolution::Regenerate | ReviewConflictResolution::KeepCurrent => {
            discard(storage, &input.workspace_id, &input.review_id)?;
            Ok(ReviewApplication {
                review_id: input.review_id,
                status: ReviewStatus::Rejected,
                operation_id: None,
                files: Vec::new(),
                result: None,
            })
        }
        ReviewConflictResolution::SaveCopy => {
            let row = storage
                .review_request(&input.review_id)?
                .ok_or(AppError::StateUnavailable)?;
            let payload: StoredReviewPayload =
                serde_json::from_str(&row.payload_json).map_err(|_| AppError::StateUnavailable)?;
            let (path, content) = match payload {
                StoredReviewPayload::DocumentPatch {
                    mut candidate_files,
                    ..
                } if candidate_files.len() == 1 => {
                    let file = candidate_files.remove(0);
                    (file.path, file.content)
                }
                StoredReviewPayload::CreateFile { proposal } => {
                    (proposal.file_name, proposal.content)
                }
                StoredReviewPayload::ReplaceResult { path, content, .. } => (path, content),
                _ => {
                    return Err(AppError::InvalidInput(
                        "多文件冲突不能合并为一个副本，请重新生成或保留当前版本".into(),
                    ))
                }
            };
            let result = super::result::create_conflict_copy(
                storage,
                managed_results_dir,
                &input.review_id,
                &current.summary,
                &path,
                &content,
            )?;
            Ok(ReviewApplication {
                review_id: input.review_id,
                status: ReviewStatus::Applied,
                operation_id: None,
                files: Vec::new(),
                result: Some(result),
            })
        }
    }
}

pub fn undo(
    storage: &Storage,
    managed_results_dir: &Path,
    input: ApplyReviewInput,
) -> Result<ReviewApplication, AppError> {
    validate_id(&input.review_id, "审阅标识无效")?;
    let current = get(storage, &input.review_id)?;
    if current.workspace_id != input.workspace_id {
        return Err(AppError::InvalidInput("审阅不属于当前工作区".into()));
    }
    if current.status == ReviewStatus::Undone {
        return Ok(ReviewApplication {
            review_id: input.review_id,
            status: ReviewStatus::Undone,
            operation_id: None,
            files: Vec::new(),
            result: None,
        });
    }
    if current.status != ReviewStatus::Applied {
        return Err(AppError::InvalidInput("审阅尚未应用或已经不能撤销".into()));
    }
    if let Some(operation_id) = current.application_operation_id.as_deref() {
        let application = patch::undo_patch_for_review(
            storage,
            &input.workspace_id,
            operation_id,
            &input.review_id,
        )?;
        return Ok(ReviewApplication {
            review_id: input.review_id,
            status: ReviewStatus::Undone,
            operation_id: Some(application.operation_id),
            files: application
                .files
                .into_iter()
                .map(|file| ReviewAppliedFile {
                    path: file.path,
                    content: file.content,
                    content_hash: file.content_hash,
                })
                .collect(),
            result: None,
        });
    }
    if let Some(result_id) = current.output_result_id.as_deref() {
        super::result::undo_review_managed_result(
            storage,
            managed_results_dir,
            &input.review_id,
            result_id,
        )?;
        return Ok(ReviewApplication {
            review_id: input.review_id,
            status: ReviewStatus::Undone,
            operation_id: None,
            files: Vec::new(),
            result: None,
        });
    }
    Err(AppError::StateUnavailable)
}

pub fn looks_like_candidate(raw: &str) -> bool {
    let normalized = raw.to_ascii_lowercase();
    normalized.contains("document_patch")
        || normalized.contains("create_file")
        || normalized.contains("replace_empty_file")
}

fn create_document_patch(
    storage: &Storage,
    input: &CreateReviewRequestInput,
    raw: &str,
) -> Result<ReviewRequest, AppError> {
    let review = patch::parse_review(storage, &input.workspace_id, raw)?;
    let risk = review
        .changes
        .iter()
        .map(|change| review_risk(change.risk))
        .max_by_key(risk_order)
        .unwrap_or(ReviewRisk::Low);
    let selected = review
        .changes
        .iter()
        .map(|change| change.id.clone())
        .collect::<Vec<_>>();
    let candidate_files =
        patch::preview_patch_files(storage, &input.workspace_id, &review.patch, &selected)?;
    let payload = StoredReviewPayload::DocumentPatch {
        patch: review.patch.clone(),
        candidate_files,
    };
    let payload_json = serde_json::to_string(&payload).map_err(|_| AppError::StateUnavailable)?;
    let id = Uuid::new_v4().to_string();
    let blocks = review
        .changes
        .iter()
        .map(|change| NewReviewBlockRow {
            id: &change.id,
            kind: "document_patch",
            target_label: &change.path,
            operation: Some(operation_str(change.operation)),
            before_content: &change.before,
            after_content: &change.after,
            reason: &change.reason,
            risk: risk_str(review_risk(change.risk)),
            suggested_file_name: None,
        })
        .collect::<Vec<_>>();
    storage.create_review_request(
        NewReviewRequestRow {
            id: &id,
            workspace_id: &input.workspace_id,
            result_id: input.result_id.as_deref(),
            source: source_str(input.source),
            operation_kind: kind_str(ReviewOperationKind::DocumentPatch),
            summary: &review.summary,
            risk: risk_str(risk),
            base_revision_id: review.patch.base_revision.as_deref(),
            base_hash: common_patch_hash(&review.patch),
            payload_json: &payload_json,
        },
        &blocks,
    )?;
    get(storage, &id)
}

fn create_file(
    storage: &Storage,
    input: &CreateReviewRequestInput,
    raw: &str,
) -> Result<ReviewRequest, AppError> {
    let proposal: CreateFileProposal = serde_json::from_str(raw)
        .map_err(|error| AppError::InvalidInput(format!("Create File Schema 无效：{error}")))?;
    validate_proposal_header(
        &proposal.version,
        &proposal.proposal_type,
        "create_file",
        &proposal.workspace_id,
        &input.workspace_id,
        &proposal.summary,
    )?;
    super::result::validate_file_name(&proposal.file_name, proposal.format)?;
    super::result::validate_content(&proposal.content)?;
    if proposal.content.trim().is_empty() {
        return Err(AppError::InvalidInput("创建文件候选内容不能为空".into()));
    }
    crate::domain::result::validate_title(&proposal.title)?;
    if proposal.reason.trim().is_empty() || proposal.reason.chars().count() > 500 {
        return Err(AppError::InvalidInput(
            "创建理由不能为空且不能超过 500 字".into(),
        ));
    }
    let id = Uuid::new_v4().to_string();
    let block_id = Uuid::new_v4().to_string();
    let payload = StoredReviewPayload::CreateFile {
        proposal: proposal.clone(),
    };
    let payload_json = serde_json::to_string(&payload).map_err(|_| AppError::StateUnavailable)?;
    storage.create_review_request(
        NewReviewRequestRow {
            id: &id,
            workspace_id: &input.workspace_id,
            result_id: None,
            source: source_str(input.source),
            operation_kind: kind_str(ReviewOperationKind::CreateFile),
            summary: &proposal.summary,
            risk: risk_str(proposal.risk),
            base_revision_id: None,
            base_hash: None,
            payload_json: &payload_json,
        },
        &[NewReviewBlockRow {
            id: &block_id,
            kind: "create_file",
            target_label: "我的成果（应用管理目录）",
            operation: Some("create"),
            before_content: "",
            after_content: &proposal.content,
            reason: &proposal.reason,
            risk: risk_str(proposal.risk),
            suggested_file_name: Some(&proposal.file_name),
        }],
    )?;
    get(storage, &id)
}

fn create_empty_replace(
    storage: &Storage,
    input: &CreateReviewRequestInput,
    raw: &str,
) -> Result<ReviewRequest, AppError> {
    let proposal: ReplaceEmptyFileProposal = serde_json::from_str(raw).map_err(|error| {
        AppError::InvalidInput(format!("Empty File Review Schema 无效：{error}"))
    })?;
    validate_proposal_header(
        &proposal.version,
        &proposal.proposal_type,
        "replace_empty_file",
        &proposal.workspace_id,
        &input.workspace_id,
        &proposal.summary,
    )?;
    super::result::validate_content(&proposal.content)?;
    if proposal.content.is_empty() {
        return Err(AppError::InvalidInput("首次写入内容不能为空".into()));
    }
    if proposal.reason.trim().is_empty() || proposal.reason.chars().count() > 500 {
        return Err(AppError::InvalidInput(
            "修改理由不能为空且不能超过 500 字".into(),
        ));
    }
    let document = workspace::read_file(storage, &input.workspace_id, &proposal.path)?;
    if !document.editable || document.extracted {
        return Err(AppError::InvalidInput("目标不是可编辑文本文件".into()));
    }
    if !patch::is_blank_editable_content(&document.content) {
        return Err(AppError::InvalidInput(
            "目标文件不为空，请使用 document_patch".into(),
        ));
    }
    let payload = StoredReviewPayload::ReplaceResult {
        path: proposal.path.clone(),
        base_hash: document.content_hash.clone(),
        content: proposal.content.clone(),
    };
    let payload_json = serde_json::to_string(&payload).map_err(|_| AppError::StateUnavailable)?;
    let id = Uuid::new_v4().to_string();
    let block_id = Uuid::new_v4().to_string();
    storage.create_review_request(
        NewReviewRequestRow {
            id: &id,
            workspace_id: &input.workspace_id,
            result_id: input.result_id.as_deref(),
            source: source_str(input.source),
            operation_kind: kind_str(ReviewOperationKind::ReplaceResult),
            summary: &proposal.summary,
            risk: risk_str(proposal.risk),
            base_revision_id: None,
            base_hash: Some(&document.content_hash),
            payload_json: &payload_json,
        },
        &[NewReviewBlockRow {
            id: &block_id,
            kind: "replace_result",
            target_label: &proposal.path,
            operation: Some("replace_empty"),
            before_content: "",
            after_content: &proposal.content,
            reason: &proposal.reason,
            risk: risk_str(proposal.risk),
            suggested_file_name: None,
        }],
    )?;
    get(storage, &id)
}

fn applied_view(
    storage: &Storage,
    managed_results_dir: &Path,
    review: &ReviewRequest,
) -> Result<ReviewApplication, AppError> {
    let result = review
        .output_result_id
        .as_deref()
        .map(|result_id| super::result::read_document(storage, managed_results_dir, result_id))
        .transpose()?;
    let files = review
        .application_operation_id
        .as_deref()
        .map(|operation_id| storage.patch_snapshots(operation_id))
        .transpose()?
        .unwrap_or_default()
        .into_iter()
        .filter(|snapshot| snapshot.version_kind == "after")
        .map(|snapshot| ReviewAppliedFile {
            path: snapshot.relative_path,
            content: snapshot.content,
            content_hash: snapshot.content_hash,
        })
        .collect();
    Ok(ReviewApplication {
        review_id: review.id.clone(),
        status: ReviewStatus::Applied,
        operation_id: review.application_operation_id.clone(),
        files,
        result,
    })
}

fn validate_proposal_header(
    version: &str,
    actual_type: &str,
    expected_type: &str,
    proposal_workspace: &str,
    workspace_id: &str,
    summary: &str,
) -> Result<(), AppError> {
    if version != "1.0" || actual_type != expected_type {
        return Err(AppError::InvalidInput("审阅候选版本或类型无效".into()));
    }
    if proposal_workspace != workspace_id {
        return Err(AppError::InvalidInput("审阅候选工作区不匹配".into()));
    }
    if summary.trim().is_empty() || summary.chars().count() > 500 {
        return Err(AppError::InvalidInput(
            "审阅摘要不能为空且不能超过 500 字".into(),
        ));
    }
    Ok(())
}

fn common_patch_hash(patch: &DocumentPatch) -> Option<&str> {
    let first = patch.changes.first()?.base_hash.as_deref()?;
    patch
        .changes
        .iter()
        .all(|change| change.base_hash.as_deref() == Some(first))
        .then_some(first)
}

fn review_risk(value: PatchRisk) -> ReviewRisk {
    match value {
        PatchRisk::Low => ReviewRisk::Low,
        PatchRisk::Medium => ReviewRisk::Medium,
        PatchRisk::High => ReviewRisk::High,
    }
}

fn risk_order(value: &ReviewRisk) -> usize {
    match value {
        ReviewRisk::Low => 0,
        ReviewRisk::Medium => 1,
        ReviewRisk::High => 2,
    }
}

fn operation_str(value: PatchOperation) -> &'static str {
    match value {
        PatchOperation::Replace => "replace",
        PatchOperation::InsertBefore => "insert_before",
        PatchOperation::InsertAfter => "insert_after",
        PatchOperation::Delete => "delete",
    }
}

fn validate_id(value: &str, message: &str) -> Result<(), AppError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput(message.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::review::{ReviewBlockDecision, ReviewConflictResolution, ReviewSource};
    use std::fs;

    fn setup() -> (tempfile::TempDir, tempfile::TempDir, Storage, String) {
        let workspace_dir = tempfile::tempdir().unwrap();
        let managed_dir = tempfile::tempdir().unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace_id = Uuid::new_v4().to_string();
        storage
            .upsert_workspace(
                &workspace_id,
                "Review test",
                workspace_dir.path().to_str().unwrap(),
            )
            .unwrap();
        (workspace_dir, managed_dir, storage, workspace_id)
    }

    fn create_input(
        workspace_id: &str,
        source: ReviewSource,
        raw: String,
    ) -> CreateReviewRequestInput {
        CreateReviewRequestInput {
            workspace_id: workspace_id.into(),
            source,
            result_id: None,
            raw,
        }
    }

    fn decide_all(
        storage: &Storage,
        review: &ReviewRequest,
        accepted: bool,
        file_name: Option<&str>,
    ) -> ReviewRequest {
        decide(
            storage,
            DecideReviewBlocksInput {
                review_id: review.id.clone(),
                workspace_id: review.workspace_id.clone(),
                decisions: review
                    .blocks
                    .iter()
                    .map(|block| ReviewBlockDecision {
                        block_id: block.id.clone(),
                        accepted,
                        file_name: file_name.map(str::to_string),
                    })
                    .collect(),
            },
        )
        .unwrap()
    }

    fn create_file_raw(workspace_id: &str, file_name: &str) -> String {
        serde_json::json!({
            "version": "1.0",
            "type": "create_file",
            "workspaceId": workspace_id,
            "summary": "生成杭州三日游文档",
            "title": "杭州三日游",
            "fileName": file_name,
            "format": "markdown",
            "content": "# 杭州三日游\n\n## 第一天\n\n抵达杭州。\n",
            "reason": "用户要求生成完整出游文档",
            "risk": "medium"
        })
        .to_string()
    }

    #[test]
    fn create_file_review_has_zero_writes_rejects_cleanly_applies_once_and_undoes() {
        let (_workspace, managed, storage, workspace_id) = setup();
        let review = create(
            &storage,
            create_input(
                &workspace_id,
                ReviewSource::Chat,
                create_file_raw(&workspace_id, "杭州三日游.md"),
            ),
        )
        .unwrap();
        assert_eq!(review.status, ReviewStatus::Pending);
        assert_eq!(
            list_active(&storage, &workspace_id).unwrap(),
            vec![review.clone()]
        );
        assert_eq!(fs::read_dir(managed.path()).unwrap().count(), 0);
        assert!(storage.results(None, true).unwrap().is_empty());

        let rejected = decide_all(&storage, &review, false, None);
        assert_eq!(rejected.status, ReviewStatus::Rejected);
        assert!(list_active(&storage, &workspace_id).unwrap().is_empty());
        assert_eq!(fs::read_dir(managed.path()).unwrap().count(), 0);
        assert!(storage.results(None, true).unwrap().is_empty());

        let review = create(
            &storage,
            create_input(
                &workspace_id,
                ReviewSource::Template,
                create_file_raw(&workspace_id, "杭州三日游.md"),
            ),
        )
        .unwrap();
        decide_all(&storage, &review, true, Some("杭州三日游.md"));
        let input = ApplyReviewInput {
            review_id: review.id.clone(),
            workspace_id: workspace_id.clone(),
        };
        let applied = apply(&storage, managed.path(), input.clone()).unwrap();
        assert_eq!(applied.status, ReviewStatus::Applied);
        assert_eq!(
            applied.result.as_ref().unwrap().applied_review,
            Some(crate::domain::result::ResultAppliedReview {
                review_id: review.id.clone(),
                workspace_id: workspace_id.clone(),
            })
        );
        assert_eq!(fs::read_dir(managed.path()).unwrap().count(), 1);
        assert_eq!(storage.results(None, true).unwrap().len(), 1);
        let repeated = apply(&storage, managed.path(), input.clone()).unwrap();
        assert_eq!(repeated.result, applied.result);
        assert_eq!(fs::read_dir(managed.path()).unwrap().count(), 1);

        fs::write(managed.path().join("杭州三日游.md"), "用户后续修改").unwrap();
        assert!(matches!(
            undo(&storage, managed.path(), input.clone()),
            Err(AppError::FileConflict)
        ));
        assert_eq!(
            fs::read_to_string(managed.path().join("杭州三日游.md")).unwrap(),
            "用户后续修改"
        );
        fs::write(
            managed.path().join("杭州三日游.md"),
            "# 杭州三日游\n\n## 第一天\n\n抵达杭州。\n",
        )
        .unwrap();

        let undone = undo(&storage, managed.path(), input.clone()).unwrap();
        assert_eq!(undone.status, ReviewStatus::Undone);
        assert_eq!(fs::read_dir(managed.path()).unwrap().count(), 0);
        assert!(storage.results(None, true).unwrap().is_empty());
        assert_eq!(
            undo(&storage, managed.path(), input).unwrap().status,
            ReviewStatus::Undone
        );
    }

    #[test]
    fn create_file_review_rejects_unsafe_names_and_never_overwrites_a_conflict() {
        let (_workspace, managed, storage, workspace_id) = setup();
        for file_name in [
            "../escape.md",
            "C:\\escape.md",
            "nested/file.md",
            "script.exe",
        ] {
            assert!(create(
                &storage,
                create_input(
                    &workspace_id,
                    ReviewSource::A2uiAction,
                    create_file_raw(&workspace_id, file_name),
                ),
            )
            .is_err());
        }
        fs::write(managed.path().join("杭州三日游.md"), "用户已有内容").unwrap();
        let review = create(
            &storage,
            create_input(
                &workspace_id,
                ReviewSource::ImportTransform,
                create_file_raw(&workspace_id, "杭州三日游.md"),
            ),
        )
        .unwrap();
        decide_all(&storage, &review, true, None);
        let input = ApplyReviewInput {
            review_id: review.id.clone(),
            workspace_id: workspace_id.clone(),
        };
        assert!(matches!(
            apply(&storage, managed.path(), input),
            Err(AppError::FileConflict)
        ));
        assert_eq!(
            fs::read_to_string(managed.path().join("杭州三日游.md")).unwrap(),
            "用户已有内容"
        );
        assert_eq!(
            get(&storage, &review.id).unwrap().status,
            ReviewStatus::Conflicted
        );

        let copy = resolve_conflict(
            &storage,
            managed.path(),
            ResolveReviewConflictInput {
                review_id: review.id,
                workspace_id,
                resolution: ReviewConflictResolution::SaveCopy,
            },
        )
        .unwrap();
        assert!(copy.result.is_some());
        assert_eq!(fs::read_dir(managed.path()).unwrap().count(), 2);
    }

    #[test]
    fn empty_authorized_file_first_write_is_reviewed_conflict_safe_and_recoverable() {
        let (workspace, managed, storage, workspace_id) = setup();
        fs::write(workspace.path().join("empty.md"), "").unwrap();
        let raw = serde_json::json!({
            "version": "1.0",
            "type": "replace_empty_file",
            "workspaceId": workspace_id,
            "summary": "写入首段内容",
            "path": "empty.md",
            "content": "# 第一段\n",
            "reason": "用户要求补充首段",
            "risk": "low"
        })
        .to_string();
        let review = create(
            &storage,
            create_input(&workspace_id, ReviewSource::Selection, raw.clone()),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
            ""
        );
        decide_all(&storage, &review, true, None);
        let input = ApplyReviewInput {
            review_id: review.id.clone(),
            workspace_id: workspace_id.clone(),
        };
        let applied = apply(&storage, managed.path(), input.clone()).unwrap();
        assert!(applied.operation_id.is_some());
        assert_eq!(
            fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
            "# 第一段\n"
        );
        assert_eq!(
            apply(&storage, managed.path(), input.clone()).unwrap(),
            applied
        );
        undo(&storage, managed.path(), input).unwrap();
        assert_eq!(
            fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
            ""
        );

        let conflicted = create(
            &storage,
            create_input(&workspace_id, ReviewSource::Chat, raw),
        )
        .unwrap();
        decide_all(&storage, &conflicted, true, None);
        fs::write(workspace.path().join("empty.md"), "外部写入").unwrap();
        assert!(matches!(
            apply(
                &storage,
                managed.path(),
                ApplyReviewInput {
                    review_id: conflicted.id.clone(),
                    workspace_id: workspace_id.clone(),
                }
            ),
            Err(AppError::FileConflict)
        ));
        assert_eq!(
            fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
            "外部写入"
        );
        let kept = resolve_conflict(
            &storage,
            managed.path(),
            ResolveReviewConflictInput {
                review_id: conflicted.id,
                workspace_id,
                resolution: ReviewConflictResolution::KeepCurrent,
            },
        )
        .unwrap();
        assert_eq!(kept.status, ReviewStatus::Rejected);
    }

    #[test]
    fn whitespace_only_editor_state_uses_the_empty_file_review_without_prewriting() {
        let (workspace, managed, storage, workspace_id) = setup();
        let original = "\n";
        fs::write(workspace.path().join("empty.md"), original).unwrap();
        let raw = serde_json::json!({
            "version": "1.0",
            "type": "replace_empty_file",
            "workspaceId": workspace_id,
            "summary": "写入首段内容",
            "path": "empty.md",
            "content": "# 第一段\n",
            "reason": "用户要求补充首段",
            "risk": "low"
        })
        .to_string();

        let rejected = create(
            &storage,
            create_input(&workspace_id, ReviewSource::Chat, raw.clone()),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
            original
        );
        decide_all(&storage, &rejected, false, None);
        assert_eq!(
            fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
            original
        );

        let accepted = create(
            &storage,
            create_input(&workspace_id, ReviewSource::Chat, raw),
        )
        .unwrap();
        decide_all(&storage, &accepted, true, None);
        let input = ApplyReviewInput {
            review_id: accepted.id,
            workspace_id,
        };
        apply(&storage, managed.path(), input.clone()).unwrap();
        assert_eq!(
            fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
            "# 第一段\n"
        );
        undo(&storage, managed.path(), input).unwrap();
        assert_eq!(
            fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
            original
        );
    }

    #[test]
    fn pending_review_survives_database_reopen() {
        let database_dir = tempfile::tempdir().unwrap();
        let workspace_dir = tempfile::tempdir().unwrap();
        let database = database_dir.path().join("reviews.sqlite3");
        let workspace_id = Uuid::new_v4().to_string();
        let expected_id = {
            let storage = Storage::open(&database).unwrap();
            storage
                .upsert_workspace(
                    &workspace_id,
                    "Persistent review",
                    workspace_dir.path().to_str().unwrap(),
                )
                .unwrap();
            create(
                &storage,
                create_input(
                    &workspace_id,
                    ReviewSource::Chat,
                    create_file_raw(&workspace_id, "持久审阅.md"),
                ),
            )
            .unwrap()
            .id
        };

        let reopened = Storage::open(&database).unwrap();
        let restored = list_active(&reopened, &workspace_id).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, expected_id);
    }

    #[test]
    fn applied_result_restores_review_origin_after_database_reopen() {
        let workspace_dir = tempfile::tempdir().unwrap();
        let managed_dir = tempfile::tempdir().unwrap();
        let database_dir = tempfile::tempdir().unwrap();
        let database = database_dir.path().join("review-origin.sqlite3");
        let workspace_id = Uuid::new_v4().to_string();
        let (review_id, result_id) = {
            let storage = Storage::open(&database).unwrap();
            storage
                .upsert_workspace(
                    &workspace_id,
                    "Persistent applied review",
                    workspace_dir.path().to_str().unwrap(),
                )
                .unwrap();
            let review = create(
                &storage,
                create_input(
                    &workspace_id,
                    ReviewSource::Chat,
                    create_file_raw(&workspace_id, "持久撤销.md"),
                ),
            )
            .unwrap();
            decide_all(&storage, &review, true, None);
            let applied = apply(
                &storage,
                managed_dir.path(),
                ApplyReviewInput {
                    review_id: review.id.clone(),
                    workspace_id: workspace_id.clone(),
                },
            )
            .unwrap();
            (review.id, applied.result.unwrap().result.summary.id)
        };

        let reopened = Storage::open(&database).unwrap();
        let document =
            crate::application::result::read_document(&reopened, managed_dir.path(), &result_id)
                .unwrap();
        assert_eq!(
            document.applied_review,
            Some(crate::domain::result::ResultAppliedReview {
                review_id: review_id.clone(),
                workspace_id: workspace_id.clone(),
            })
        );
        assert_eq!(
            undo(
                &reopened,
                managed_dir.path(),
                ApplyReviewInput {
                    review_id,
                    workspace_id,
                },
            )
            .unwrap()
            .status,
            ReviewStatus::Undone
        );
        assert!(reopened.result(&result_id).unwrap().is_none());
    }
}
