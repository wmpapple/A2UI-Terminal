use crate::a2ui::{
    self, A2uiInspectionView, A2uiProcessResult, A2uiSurfaceView, A2uiTemplateView,
    ActionExecutionResult, ExecuteActionRequest, OpenA2uiTemplateRequest, OpenA2uiTemplateResult,
    ProcessA2uiRequest, SaveA2uiTemplateRequest,
};
use crate::domain::review::{CreateReviewRequestInput, ReviewSource};
use crate::error::AppError;
use crate::patch::{self, DocumentPatch, PatchApplication, PatchReview};
use crate::storage::Storage;

pub fn validate_patch(
    storage: &Storage,
    workspace_id: &str,
    raw: &str,
) -> Result<PatchReview, AppError> {
    patch::parse_review(storage, workspace_id, raw)
}

pub fn apply_patch(
    storage: &Storage,
    workspace_id: &str,
    patch: DocumentPatch,
    selected_change_ids: &[String],
    session_id: Option<&str>,
    assistant_message_id: Option<&str>,
) -> Result<PatchApplication, AppError> {
    patch::apply_patch(
        storage,
        workspace_id,
        patch,
        selected_change_ids,
        session_id,
        assistant_message_id,
    )
}

pub fn undo_patch(
    storage: &Storage,
    workspace_id: &str,
    operation_id: &str,
) -> Result<PatchApplication, AppError> {
    patch::undo_patch(storage, workspace_id, operation_id)
}

pub fn process_a2ui(
    storage: &Storage,
    request: &ProcessA2uiRequest,
) -> Result<Option<A2uiProcessResult>, AppError> {
    a2ui::process_message(storage, request)
}

pub fn list_surfaces(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<A2uiSurfaceView>, AppError> {
    a2ui::list_surfaces(storage, workspace_id)
}

pub fn list_inspections(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<A2uiInspectionView>, AppError> {
    a2ui::list_inspections(storage, workspace_id)
}

pub fn save_template(
    storage: &Storage,
    request: SaveA2uiTemplateRequest,
) -> Result<A2uiTemplateView, AppError> {
    a2ui::save_template(storage, request)
}

pub fn list_templates(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<A2uiTemplateView>, AppError> {
    a2ui::list_templates(storage, workspace_id)
}

pub fn open_template(
    storage: &Storage,
    request: OpenA2uiTemplateRequest,
) -> Result<OpenA2uiTemplateResult, AppError> {
    a2ui::open_template(storage, request)
}

pub fn delete_template(
    storage: &Storage,
    workspace_id: &str,
    template_id: &str,
) -> Result<bool, AppError> {
    a2ui::delete_template(storage, workspace_id, template_id)
}

pub fn delete_surface(
    storage: &Storage,
    workspace_id: &str,
    surface_id: &str,
) -> Result<bool, AppError> {
    a2ui::delete_surface(storage, workspace_id, surface_id)
}

pub fn delete_inspection(
    storage: &Storage,
    workspace_id: &str,
    inspection_id: &str,
) -> Result<bool, AppError> {
    a2ui::delete_inspection(storage, workspace_id, inspection_id)
}

pub fn execute_action(
    storage: &Storage,
    request: ExecuteActionRequest,
) -> Result<ActionExecutionResult, AppError> {
    let workspace_id = request.workspace_id.clone();
    let executed = a2ui::execute_action_with_review(storage, request, |candidate| {
        let raw = serde_json::to_string(candidate).map_err(|_| AppError::StateUnavailable)?;
        super::review::create(
            storage,
            CreateReviewRequestInput {
                workspace_id,
                source: ReviewSource::A2uiAction,
                result_id: None,
                raw,
            },
        )
    })?;
    super::result::ensure_portable_surface_by_id(
        storage,
        &executed.surface.workspace_id,
        &executed.surface.surface_id,
    )?;
    Ok(executed)
}
