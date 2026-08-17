use crate::a2ui::{
    self, A2uiInspectionView, A2uiProcessResult, A2uiSurfaceView, ActionExecutionResult,
    ExecuteActionRequest, ProcessA2uiRequest,
};
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

pub fn delete_surface(
    storage: &Storage,
    workspace_id: &str,
    surface_id: &str,
) -> Result<bool, AppError> {
    a2ui::delete_surface(storage, workspace_id, surface_id)
}

pub fn execute_action(
    storage: &Storage,
    request: ExecuteActionRequest,
) -> Result<ActionExecutionResult, AppError> {
    a2ui::execute_action(storage, request)
}
