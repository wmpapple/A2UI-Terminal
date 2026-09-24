//! Selection-scoped AI editing. The model may only supply replacement text;
//! the trusted selection snapshot owns the target and UTF-16 range.
use crate::{
    ai::{
        self, ChatRequest, ContextCandidate, ContextManifest, ContextManifestInput,
        ContextSourceKind, ProviderMessage,
    },
    domain::{
        document::{DocumentSnapshot, DocumentTarget, SelectionSnapshot},
        review::{ReviewRequest, ReviewSource},
    },
    error::AppError,
    repository::provider::ProviderRepository,
    state::AppState,
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InlineEditAction {
    Polish,
    Shorten,
    Expand,
    Professional,
    Natural,
    Grammar,
    Translate,
    Custom,
}

impl InlineEditAction {
    fn instruction(self, custom: Option<&str>) -> Result<String, AppError> {
        let text = match self {
            Self::Polish => "润色所选文字，保留事实、含义和语言，只返回替换文字。",
            Self::Shorten => "精简所选文字，保留关键事实和含义，只返回替换文字。",
            Self::Expand => "扩写所选文字，不虚构事实或引用，只返回替换文字。",
            Self::Professional => "将所选文字改为专业、清晰的表达，只返回替换文字。",
            Self::Natural => "将所选文字改得自然流畅，只返回替换文字。",
            Self::Grammar => "修正所选文字的语法、拼写和标点，只返回替换文字。",
            Self::Translate => "翻译所选文字；根据用户界面语言在中文与英文之间转换，只返回译文。",
            Self::Custom => {
                let value = custom.unwrap_or_default().trim();
                if value.is_empty() || value.chars().count() > 500 {
                    return Err(AppError::InvalidInput(
                        "自定义修改要求不能为空且不能超过 500 字".into(),
                    ));
                }
                return Ok(format!("按以下要求改写所选文字：{value}\n只返回替换文字。"));
            }
        };
        Ok(text.into())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanInlineEditInput {
    pub selection: SelectionSnapshot,
    pub provider_id: String,
    pub action: InlineEditAction,
    pub custom_instruction: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PreparedInlineEdit {
    pub request: ChatRequest,
    pub selection: SelectionSnapshot,
    pub action: InlineEditAction,
    pub instruction: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineEditPlan {
    pub id: String,
    pub request_id: String,
    pub manifest: ContextManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineEditProposal {
    pub review: ReviewRequest,
    pub selection: SelectionSnapshot,
    pub replacement: String,
}

fn target_workspace(state: &AppState, snapshot: &DocumentSnapshot) -> Result<String, AppError> {
    match &snapshot.target {
        DocumentTarget::WorkspaceFile { workspace_id, .. } => Ok(workspace_id.clone()),
        DocumentTarget::Result { result_id } => Ok(super::result::read_document(
            &state.storage,
            &state.managed_results_dir,
            result_id,
        )?
        .result
        .summary
        .workspace_id),
    }
}

pub fn plan(state: &AppState, input: PlanInlineEditInput) -> Result<InlineEditPlan, AppError> {
    let _guard = state
        .knowledge_guard
        .lock()
        .map_err(|_| AppError::StateUnavailable)?;
    let snapshot = super::document::validate_selection(
        &state.storage,
        &state.managed_results_dir,
        &input.selection,
    )?;
    let range =
        super::document::utf16_range(&snapshot.text, input.selection.start, input.selection.end)?;
    let selected = snapshot.text[range].to_string();
    if selected.chars().count() > 20_000 {
        return Err(AppError::InvalidInput(
            "单次行内修改最多支持 20000 字".into(),
        ));
    }
    let instruction = input
        .action
        .instruction(input.custom_instruction.as_deref())?;
    let workspace_id = target_workspace(state, &snapshot)?;
    let session_id = Uuid::new_v4().to_string();
    super::chat::create_session(&state.storage, &workspace_id, &session_id, "行内修改")?;
    let request = ChatRequest {
        request_id: Uuid::new_v4().to_string(),
        user_message_id: Uuid::new_v4().to_string(),
        assistant_message_id: Uuid::new_v4().to_string(),
        workspace_id: workspace_id.clone(),
        session_id: session_id.clone(),
        provider_id: input.provider_id.clone(),
        prompt: instruction.clone(),
        context_manifest_id: String::new(),
        review_source: Some(ReviewSource::Selection),
        explanation_only: false,
    };
    let manifest = (|| {
        let mut manifests = state
            .pending_context_manifests
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut index = state
            .context_index
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        super::context::plan(
            &state.storage,
            &mut index,
            &mut manifests,
            ContextManifestInput {
                workspace_id: workspace_id.clone(),
                session_id: session_id.clone(),
                provider_id: input.provider_id,
                prompt: instruction.clone(),
                candidates: vec![ContextCandidate {
                    kind: ContextSourceKind::Selection,
                    label: "当前选区".into(),
                    selected: true,
                    source_id: None,
                    content: Some(selected),
                    base_hash: Some(input.selection.selected_text_hash.clone()),
                }],
                include_recent_messages: false,
                recent_message_count: 0,
                context_pack_ids: Vec::new(),
            },
        )
    })();
    // Context planning validates ownership through a real chat session. The
    // confirmed manifest is self-contained, so remove this internal session
    // immediately instead of leaving it visible while sensitive confirmation
    // is pending or when the user closes the dialog.
    let _ = state
        .storage
        .delete_chat_session(&workspace_id, &session_id);
    let manifest = manifest?;
    let mut request = request;
    request.context_manifest_id = manifest.id.clone();
    let plan = InlineEditPlan {
        id: manifest.id.clone(),
        request_id: request.request_id.clone(),
        manifest,
    };
    let mut pending = state
        .pending_inline_edits
        .lock()
        .map_err(|_| AppError::StateUnavailable)?;
    pending.clear();
    pending.insert(
        plan.id.clone(),
        PreparedInlineEdit {
            request,
            selection: input.selection,
            action: input.action,
            instruction,
        },
    );
    Ok(plan)
}

pub async fn start<F>(
    state: &AppState,
    id: &str,
    mut emit: F,
) -> Result<InlineEditProposal, AppError>
where
    F: FnMut(super::chat::ChatStreamEvent) -> Result<(), AppError>,
{
    let cancel = Arc::new(AtomicBool::new(false));
    let (prepared, manifest, config, key) = {
        let _guard = state
            .knowledge_guard
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let prepared = state
            .pending_inline_edits
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .remove(id)
            .ok_or_else(|| AppError::InvalidInput("行内修改计划已失效，请重新选择文字".into()))?;
        super::document::validate_selection(
            &state.storage,
            &state.managed_results_dir,
            &prepared.selection,
        )?;
        let manifest = ai::consume_context_manifest(
            &state.storage,
            &mut *state
                .pending_context_manifests
                .lock()
                .map_err(|_| AppError::StateUnavailable)?,
            &prepared.request,
        )?;
        let config = ProviderRepository::new(&state.storage)
            .find(&prepared.request.provider_id)?
            .ok_or(AppError::StateUnavailable)?;
        let key = super::provider::request_key(&config)?;
        state
            .active_requests
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .insert(prepared.request.request_id.clone(), cancel.clone());
        (prepared, manifest, config, key)
    };
    let request = &prepared.request;
    let outcome = async {
        let composed = ai::compose_prompt(
            "You edit exactly one selected text range. Return only replacement text with no quotation marks, commentary, markdown fence, JSON, file path, patch, or tool call. Preserve facts and citations unless the instruction explicitly asks to remove them. Never act outside the selection.",
            &manifest.view.writing_profile, None, &prepared.instruction, &manifest.sources);
        let messages = vec![ProviderMessage { role: "system".into(), content: composed.system }, ProviderMessage { role: "user".into(), content: composed.user }];
        let replacement = super::generation::stream_provider(&config, &key, &messages, cancel.clone(), |delta| emit(super::chat::ChatStreamEvent::Delta { request_id: request.request_id.clone(), message_id: request.assistant_message_id.clone(), delta: delta.into() })).await?;
        if cancel.load(Ordering::SeqCst) { return Err(AppError::RequestCancelled); }
        let replacement = replacement.trim().to_string();
        if replacement.is_empty() { return Err(AppError::InvalidInput("模型没有返回可用的替换文字".into())); }
        let _guard = state.knowledge_guard.lock().map_err(|_| AppError::StateUnavailable)?;
        let snapshot = super::document::validate_selection(&state.storage, &state.managed_results_dir, &prepared.selection)?;
        let review = super::review::create_inline_replacement(&state.storage, &state.managed_results_dir, &snapshot, &prepared.selection, &replacement, prepared.action)?;
        Ok(InlineEditProposal { review, selection: prepared.selection.clone(), replacement })
    }.await;
    state
        .active_requests
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .remove(&request.request_id);
    // Inline edits use an internal session only to reuse the audited context
    // manifest pipeline; do not expose it in the user's chat history.
    let _ = state
        .storage
        .delete_chat_session(&request.workspace_id, &request.session_id);
    outcome
}
