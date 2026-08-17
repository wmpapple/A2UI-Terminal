use a2ui_terminal_lib::a2ui::{A2uiProcessResult, SurfaceMessage};
use a2ui_terminal_lib::commands::{ChatStreamEvent, ChatStreamResult};
use a2ui_terminal_lib::domain::import::{ImportBatch, ImportDropOutcome};
use a2ui_terminal_lib::domain::result::{
    ResultDetail, ResultDocument, ResultRevision, ResultSummary,
};
use a2ui_terminal_lib::domain::task::{TaskDetail, TaskRunResult, TaskTemplate};
use a2ui_terminal_lib::error::{AppError, ProviderFailure};
use a2ui_terminal_lib::patch::{DocumentPatch, PatchApplication, PatchReview};
use a2ui_terminal_lib::storage::ChatSessionRecord;
use a2ui_terminal_lib::workspace::{DocumentVersion, DocumentVersionSummary, WorkspaceDocument};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

const WORKSPACE_FIXTURE: &str = include_str!("../../contracts/v1/workspace.json");
const CHAT_FIXTURE: &str = include_str!("../../contracts/v1/chat.json");
const PATCH_FIXTURE: &str = include_str!("../../contracts/v1/patch.json");
const A2UI_FIXTURE: &str = include_str!("../../contracts/v1/a2ui.json");
const REVISION_FIXTURE: &str = include_str!("../../contracts/v1/revision.json");
const ERROR_FIXTURE: &str = include_str!("../../contracts/v1/error.json");
const RESULT_FIXTURE: &str = include_str!("../../contracts/v2/result.json");
const TASK_FIXTURE: &str = include_str!("../../contracts/v2/task.json");
const IMPORT_FIXTURE: &str = include_str!("../../contracts/v2/import.json");
const IMPORT_DROP_FIXTURE: &str = include_str!("../../contracts/v2/import-drop.json");

fn assert_round_trip<T>(value: &Value)
where
    T: DeserializeOwned + Serialize,
{
    let parsed: T =
        serde_json::from_value(value.clone()).expect("fixture must deserialize in Rust");
    assert_eq!(
        serde_json::to_value(parsed).expect("Rust DTO must serialize"),
        *value
    );
}

#[test]
fn rust_serde_matches_all_shared_response_fixtures() {
    let workspace: Value = serde_json::from_str(WORKSPACE_FIXTURE).unwrap();
    assert_round_trip::<WorkspaceDocument>(&workspace);

    let chat: Value = serde_json::from_str(CHAT_FIXTURE).unwrap();
    assert_round_trip::<ChatSessionRecord>(&chat["session"]);
    assert_round_trip::<ChatStreamEvent>(&chat["streamEvent"]);
    assert_round_trip::<ChatStreamResult>(&chat["streamResult"]);

    let patch: Value = serde_json::from_str(PATCH_FIXTURE).unwrap();
    assert_round_trip::<DocumentPatch>(&patch["protocol"]);
    assert_round_trip::<PatchReview>(&patch["review"]);
    assert_round_trip::<PatchApplication>(&patch["application"]);

    let a2ui: Value = serde_json::from_str(A2UI_FIXTURE).unwrap();
    assert_round_trip::<SurfaceMessage>(&a2ui["protocol"]);
    assert_round_trip::<A2uiProcessResult>(&a2ui["processResult"]);

    let revision: Value = serde_json::from_str(REVISION_FIXTURE).unwrap();
    assert_round_trip::<DocumentVersionSummary>(&revision["summary"]);
    assert_round_trip::<DocumentVersion>(&revision["document"]);
}

#[test]
fn rust_serde_matches_result_v2_fixture() {
    let result: Value = serde_json::from_str(RESULT_FIXTURE).unwrap();
    assert_round_trip::<ResultSummary>(&result["summary"]);
    assert_round_trip::<ResultDetail>(&result["detail"]);
    assert_round_trip::<ResultDocument>(&result["document"]);
    assert_round_trip::<ResultRevision>(&result["revision"]);
}

#[test]
fn rust_serde_matches_task_v2_fixture() {
    let task: Value = serde_json::from_str(TASK_FIXTURE).unwrap();
    assert_round_trip::<TaskTemplate>(&task["template"]);
    assert_round_trip::<TaskDetail>(&task["task"]);
    assert_round_trip::<TaskRunResult>(&task["runResult"]);
}

#[test]
fn rust_serde_matches_import_v2_fixture() {
    let import: Value = serde_json::from_str(IMPORT_FIXTURE).unwrap();
    assert_round_trip::<ImportBatch>(&import);
    let import_drop: Value = serde_json::from_str(IMPORT_DROP_FIXTURE).unwrap();
    assert_round_trip::<ImportDropOutcome>(&import_drop);
}

#[test]
fn response_dtos_allow_additive_fields_for_forward_compatibility() {
    let mut workspace: Value = serde_json::from_str(WORKSPACE_FIXTURE).unwrap();
    workspace["futureField"] = Value::String("allowed".into());
    serde_json::from_value::<WorkspaceDocument>(workspace)
        .expect("trusted responses must ignore additive fields");

    let fixture: Value = serde_json::from_str(RESULT_FIXTURE).unwrap();
    let mut result = fixture["detail"].clone();
    result["futureField"] = Value::String("allowed".into());
    serde_json::from_value::<ResultDetail>(result)
        .expect("trusted Result responses must ignore additive fields");
}

#[test]
fn untrusted_patch_and_a2ui_protocols_reject_unknown_fields() {
    let patch_fixture: Value = serde_json::from_str(PATCH_FIXTURE).unwrap();
    let mut patch = patch_fixture["protocol"].clone();
    patch["futureField"] = Value::String("rejected".into());
    assert!(serde_json::from_value::<DocumentPatch>(patch).is_err());

    let a2ui_fixture: Value = serde_json::from_str(A2UI_FIXTURE).unwrap();
    let mut surface = a2ui_fixture["protocol"].clone();
    surface["futureField"] = Value::String("rejected".into());
    assert!(serde_json::from_value::<SurfaceMessage>(surface).is_err());
}

#[test]
fn stable_error_envelope_matches_shared_fixture() {
    let expected: Value = serde_json::from_str(ERROR_FIXTURE).unwrap();
    let error = AppError::Provider(
        ProviderFailure::new("PROVIDER_RATE_LIMITED", "请求过于频繁", true)
            .with_http_status(429)
            .with_retry_after(Some(12)),
    );
    assert_eq!(serde_json::to_value(error).unwrap(), expected);
}
