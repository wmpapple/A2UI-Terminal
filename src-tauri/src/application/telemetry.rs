use crate::domain::export::ExportFormat;
use crate::error::AppError;
use crate::storage::Storage;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

const EVENT_VERSION: u8 = 1;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

const NEVER_COLLECTED: &[&str] = &[
    "document_content",
    "prompt",
    "ai_response",
    "file_name_or_path",
    "image_content",
    "api_key",
    "endpoint_or_model_id",
    "identity_or_contact",
    "local_index_content",
];

const COMMON_FIELDS: &[&str] = &["event_name", "event_version", "app_version", "platform"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryCollectionMode {
    LocalOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySettings {
    pub enabled: bool,
    pub invitation_eligible: bool,
    pub invitation_dismissed: bool,
    pub upload_configured: bool,
    pub collection_mode: TelemetryCollectionMode,
    pub local_event_count: u64,
    pub event_counts: BTreeMap<String, u64>,
    pub kpis: Vec<TelemetryKpi>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryKpi {
    pub key: String,
    pub numerator: u64,
    pub denominator: u64,
    pub rate_basis_points: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetTelemetrySettingsInput {
    pub enabled: bool,
    #[serde(default)]
    pub dismiss_invitation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEventDefinition {
    pub name: String,
    pub description_zh: String,
    pub description_en: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryDictionary {
    pub schema_version: u8,
    pub upload_configured: bool,
    pub collection_mode: TelemetryCollectionMode,
    pub common_fields: Vec<String>,
    pub never_collected: Vec<String>,
    pub events: Vec<TelemetryEventDefinition>,
    pub local_event_counts: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Copy)]
pub enum ReviewDecision {
    Accepted,
    Partial,
    Rejected,
}

#[derive(Debug, Clone, Copy)]
pub enum Outcome {
    Success,
    Failure,
    Cancelled,
}

#[derive(Debug, Clone, Copy)]
pub enum ProcessingLocation {
    Local,
    Cloud,
}

#[derive(Debug, Clone, Copy)]
pub enum CoreLoopTrigger {
    Save,
    Export,
    ReviewApply,
    PatchApply,
}

#[derive(Debug, Clone, Copy)]
pub enum ErrorCategory {
    None,
    Cancelled,
    Credential,
    Storage,
    File,
    Validation,
    Provider,
    Unknown,
}

#[derive(Debug, Clone, Copy)]
pub enum PerformanceOperation {
    ResultSave,
    ResultExport,
    DocumentRestore,
}

#[derive(Debug, Clone, Copy)]
pub enum ProductEvent {
    TaskCreated,
    TaskCompleted,
    ReviewPresented,
    ReviewDecision {
        decision: ReviewDecision,
    },
    ReviewAdopted,
    AcceptedPatch,
    UndoCompleted,
    ResultSaved,
    ResultCreated,
    ResultExported {
        format: ExportFormat,
    },
    ContextConfirmed {
        location: ProcessingLocation,
    },
    ContextPlanned,
    FirstCoreLoopCompleted {
        trigger: CoreLoopTrigger,
    },
    AiRequestCompleted {
        outcome: Outcome,
        error_category: ErrorCategory,
        duration_ms: u128,
        location: ProcessingLocation,
    },
    A2uiRendered {
        outcome: Outcome,
        error_category: ErrorCategory,
        duration_ms: u128,
    },
    CrashRecoveryDetected,
    PerformanceSample {
        operation: PerformanceOperation,
        outcome: Outcome,
        duration_ms: u128,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
enum SafeValue {
    Category(&'static str),
    Boolean(bool),
}

impl ProductEvent {
    fn name(self) -> &'static str {
        match self {
            Self::TaskCreated => "task_created",
            Self::TaskCompleted => "task_completed",
            Self::ReviewPresented => "review_presented",
            Self::ReviewDecision { .. } => "review_decision",
            Self::ReviewAdopted => "review_adopted",
            Self::AcceptedPatch => "accepted_patch",
            Self::UndoCompleted => "undo_completed",
            Self::ResultSaved => "result_saved",
            Self::ResultCreated => "result_created",
            Self::ResultExported { .. } => "result_exported",
            Self::ContextConfirmed { .. } => "context_confirmed",
            Self::ContextPlanned => "context_planned",
            Self::FirstCoreLoopCompleted { .. } => "first_core_loop_completed",
            Self::AiRequestCompleted { .. } => "ai_request_completed",
            Self::A2uiRendered { .. } => "a2ui_rendered",
            Self::CrashRecoveryDetected => "crash_recovery_detected",
            Self::PerformanceSample { .. } => "performance_sample",
        }
    }

    fn properties(self) -> BTreeMap<&'static str, SafeValue> {
        let mut properties = BTreeMap::new();
        match self {
            Self::TaskCreated => {
                properties.insert("created", SafeValue::Boolean(true));
            }
            Self::TaskCompleted => {
                properties.insert("completed", SafeValue::Boolean(true));
            }
            Self::ReviewPresented => {
                properties.insert("presented", SafeValue::Boolean(true));
            }
            Self::ReviewDecision { decision } => {
                properties.insert("decision", SafeValue::Category(decision.as_str()));
            }
            Self::ReviewAdopted => {
                properties.insert("adopted", SafeValue::Boolean(true));
            }
            Self::AcceptedPatch => {
                properties.insert("accepted", SafeValue::Boolean(true));
            }
            Self::UndoCompleted => {
                properties.insert("completed", SafeValue::Boolean(true));
            }
            Self::ResultSaved => {
                properties.insert("saved", SafeValue::Boolean(true));
            }
            Self::ResultCreated => {
                properties.insert("created", SafeValue::Boolean(true));
            }
            Self::ResultExported { format } => {
                properties.insert("format_category", SafeValue::Category(format.extension()));
            }
            Self::ContextConfirmed { location } => {
                properties.insert(
                    "processing_location",
                    SafeValue::Category(location.as_str()),
                );
            }
            Self::ContextPlanned => {
                properties.insert("planned", SafeValue::Boolean(true));
            }
            Self::FirstCoreLoopCompleted { trigger } => {
                properties.insert("trigger", SafeValue::Category(trigger.as_str()));
            }
            Self::AiRequestCompleted {
                outcome,
                error_category,
                duration_ms,
                location,
            } => {
                properties.insert("outcome", SafeValue::Category(outcome.as_str()));
                properties.insert(
                    "error_category",
                    SafeValue::Category(error_category.as_str()),
                );
                properties.insert(
                    "duration_bucket",
                    SafeValue::Category(duration_bucket(duration_ms)),
                );
                properties.insert(
                    "processing_location",
                    SafeValue::Category(location.as_str()),
                );
            }
            Self::A2uiRendered {
                outcome,
                error_category,
                duration_ms,
            } => {
                properties.insert("outcome", SafeValue::Category(outcome.as_str()));
                properties.insert(
                    "error_category",
                    SafeValue::Category(error_category.as_str()),
                );
                properties.insert(
                    "duration_bucket",
                    SafeValue::Category(duration_bucket(duration_ms)),
                );
            }
            Self::CrashRecoveryDetected => {
                properties.insert("recovery_available", SafeValue::Boolean(true));
            }
            Self::PerformanceSample {
                operation,
                outcome,
                duration_ms,
            } => {
                properties.insert("operation", SafeValue::Category(operation.as_str()));
                properties.insert("outcome", SafeValue::Category(outcome.as_str()));
                properties.insert(
                    "duration_bucket",
                    SafeValue::Category(duration_bucket(duration_ms)),
                );
            }
        }
        properties
    }
}

impl ReviewDecision {
    fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Partial => "partial",
            Self::Rejected => "rejected",
        }
    }
}

impl Outcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Failure => "failure",
            Self::Cancelled => "cancelled",
        }
    }
}

impl ProcessingLocation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Cloud => "cloud",
        }
    }
}

impl CoreLoopTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Save => "save",
            Self::Export => "export",
            Self::ReviewApply => "review_apply",
            Self::PatchApply => "patch_apply",
        }
    }
}

impl ErrorCategory {
    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Cancelled => "cancelled",
            Self::Credential => "credential",
            Self::Storage => "storage",
            Self::File => "file",
            Self::Validation => "validation",
            Self::Provider => "provider",
            Self::Unknown => "unknown",
        }
    }
}

impl PerformanceOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::ResultSave => "result_save",
            Self::ResultExport => "result_export",
            Self::DocumentRestore => "document_restore",
        }
    }
}

pub fn get_settings(storage: &Storage) -> Result<TelemetrySettings, AppError> {
    let row = storage.telemetry_settings()?;
    let event_counts = storage
        .product_event_counts()?
        .into_iter()
        .collect::<BTreeMap<_, _>>();
    let local_event_count = event_counts.values().sum();
    Ok(TelemetrySettings {
        enabled: row.enabled,
        invitation_eligible: row.invitation_eligible,
        invitation_dismissed: row.invitation_dismissed,
        upload_configured: false,
        collection_mode: TelemetryCollectionMode::LocalOnly,
        local_event_count,
        kpis: {
            let mut kpis = build_kpis(&event_counts);
            for (key, operations) in [
                ("export_save_rate", vec!["result_save", "result_export"]),
                ("undo_rate", vec!["document_restore"]),
            ] {
                let (success, total) = storage.product_operation_counts(&operations)?;
                *kpis.iter_mut().find(|item| item.key == key).unwrap() = kpi(key, success, total);
            }
            kpis
        },
        event_counts,
    })
}

pub fn set_settings(
    storage: &Storage,
    input: SetTelemetrySettingsInput,
) -> Result<TelemetrySettings, AppError> {
    storage.set_telemetry_settings(input.enabled, input.dismiss_invitation)?;
    get_settings(storage)
}

pub fn export_dictionary(storage: &Storage) -> Result<TelemetryDictionary, AppError> {
    Ok(TelemetryDictionary {
        schema_version: EVENT_VERSION,
        upload_configured: false,
        collection_mode: TelemetryCollectionMode::LocalOnly,
        common_fields: COMMON_FIELDS.iter().map(|field| (*field).into()).collect(),
        never_collected: NEVER_COLLECTED
            .iter()
            .map(|field| (*field).into())
            .collect(),
        events: event_definitions(),
        local_event_counts: storage.product_event_counts()?.into_iter().collect(),
    })
}

pub fn record(storage: &Storage, event: ProductEvent) -> Result<bool, AppError> {
    let properties =
        serde_json::to_string(&event.properties()).map_err(|_| AppError::StateUnavailable)?;
    storage.insert_product_event(
        &Uuid::new_v4().to_string(),
        event.name(),
        APP_VERSION,
        &properties,
    )
}

pub fn observe<T>(
    storage: &Storage,
    operation: PerformanceOperation,
    work: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let started = std::time::Instant::now();
    let result = work();
    let outcome = match &result {
        Ok(_) => Outcome::Success,
        Err(AppError::RequestCancelled) => Outcome::Cancelled,
        Err(_) => Outcome::Failure,
    };
    let _ = record(
        storage,
        ProductEvent::PerformanceSample {
            operation,
            outcome,
            duration_ms: started.elapsed().as_millis(),
        },
    );
    result
}

pub fn mark_first_core_loop(storage: &Storage, trigger: CoreLoopTrigger) {
    if storage
        .mark_telemetry_invitation_eligible()
        .unwrap_or(false)
    {
        let _ = record(storage, ProductEvent::FirstCoreLoopCompleted { trigger });
    }
}

fn build_kpis(counts: &BTreeMap<String, u64>) -> Vec<TelemetryKpi> {
    let count = |name: &str| *counts.get(name).unwrap_or(&0);
    vec![
        kpi(
            "task_completion_rate",
            count("task_completed"),
            count("task_created"),
        ),
        kpi(
            "review_adoption_rate",
            count("review_adopted"),
            count("review_presented"),
        ),
        kpi(
            "accepted_patch_rate",
            count("accepted_patch"),
            count("review_adopted"),
        ),
        // Operation rates are filled from paired outcome samples in get_settings.
        kpi("undo_rate", 0, 0),
        kpi("export_save_rate", 0, 0),
        kpi(
            "context_confirmation_rate",
            count("context_confirmed"),
            count("context_planned"),
        ),
    ]
}

fn kpi(key: &str, numerator: u64, denominator: u64) -> TelemetryKpi {
    let rate_basis_points = numerator
        .saturating_mul(10_000)
        .checked_div(denominator)
        .map(|rate| rate.min(10_000) as u32);
    TelemetryKpi {
        key: key.into(),
        numerator,
        denominator,
        rate_basis_points,
    }
}

pub fn duration_bucket(duration_ms: u128) -> &'static str {
    match duration_ms {
        0..=299 => "under_300ms",
        300..=999 => "300ms_to_1s",
        1_000..=2_499 => "1s_to_2_5s",
        2_500..=9_999 => "2_5s_to_10s",
        _ => "over_10s",
    }
}

pub fn error_category(error: &AppError) -> ErrorCategory {
    match error.code() {
        "REQUEST_CANCELLED" | "STREAM_RECEIVER_CLOSED" => ErrorCategory::Cancelled,
        "CREDENTIAL_NOT_FOUND" | "CREDENTIAL_STORE_ERROR" | "CREDENTIAL_STORE_UNAVAILABLE" => {
            ErrorCategory::Credential
        }
        "DATABASE_ERROR" | "DATABASE_INTEGRITY_ERROR" | "STATE_UNAVAILABLE" => {
            ErrorCategory::Storage
        }
        "FILESYSTEM_ERROR" | "FILE_CONFLICT" | "FILE_TOO_LARGE" | "INVALID_ENCODING" => {
            ErrorCategory::File
        }
        "INVALID_INPUT" => ErrorCategory::Validation,
        code if code.starts_with("PROVIDER_") => ErrorCategory::Provider,
        _ => ErrorCategory::Unknown,
    }
}

pub fn event_definitions() -> Vec<TelemetryEventDefinition> {
    vec![
        definition(
            "task_created",
            "任务已创建",
            "A task was created",
            &["created"],
        ),
        definition(
            "task_completed",
            "任务形成成果",
            "A task produced a result",
            &["completed"],
        ),
        definition(
            "review_presented",
            "审阅已展示",
            "A review was presented",
            &["presented"],
        ),
        definition(
            "review_decision",
            "审阅采用情况",
            "Review adoption outcome",
            &["decision"],
        ),
        definition(
            "review_adopted",
            "审阅已采用",
            "A review was adopted",
            &["adopted"],
        ),
        definition(
            "accepted_patch",
            "已接受修改",
            "An accepted patch was applied",
            &["accepted"],
        ),
        definition(
            "undo_completed",
            "完成撤销",
            "An undo completed",
            &["completed"],
        ),
        definition(
            "result_saved",
            "成果已保存",
            "A result was saved",
            &["saved"],
        ),
        definition(
            "result_created",
            "成果已创建",
            "A result was created",
            &["created"],
        ),
        definition(
            "result_exported",
            "成果已导出",
            "A result was exported",
            &["format_category"],
        ),
        definition(
            "context_confirmed",
            "发送清单已确认",
            "A context manifest was confirmed",
            &["processing_location"],
        ),
        definition(
            "context_planned",
            "发送清单已准备",
            "A context manifest was prepared",
            &["planned"],
        ),
        definition(
            "first_core_loop_completed",
            "首次成果闭环完成",
            "The first core result loop completed",
            &["trigger"],
        ),
        definition(
            "ai_request_completed",
            "AI 请求结果与耗时区间",
            "AI request outcome and duration bucket",
            &[
                "outcome",
                "error_category",
                "duration_bucket",
                "processing_location",
            ],
        ),
        definition(
            "a2ui_rendered",
            "交互界面渲染结果",
            "A2UI rendering outcome",
            &["outcome", "error_category", "duration_bucket"],
        ),
        definition(
            "crash_recovery_detected",
            "发现可恢复草稿",
            "A recoverable draft was detected",
            &["recovery_available"],
        ),
        definition(
            "performance_sample",
            "核心操作耗时区间",
            "Core operation duration bucket",
            &["operation", "outcome", "duration_bucket"],
        ),
    ]
}

fn definition(
    name: &'static str,
    description_zh: &'static str,
    description_en: &'static str,
    fields: &'static [&'static str],
) -> TelemetryEventDefinition {
    TelemetryEventDefinition {
        name: name.into(),
        description_zh: description_zh.into(),
        description_en: description_en.into(),
        fields: fields.iter().map(|field| (*field).into()).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Storage;

    #[test]
    fn metrics_are_off_by_default_and_disabling_removes_local_events() {
        let storage = Storage::open_in_memory().unwrap();
        assert!(!get_settings(&storage).unwrap().enabled);
        assert!(!record(&storage, ProductEvent::TaskCompleted).unwrap());
        assert_eq!(get_settings(&storage).unwrap().local_event_count, 0);

        set_settings(
            &storage,
            SetTelemetrySettingsInput {
                enabled: true,
                dismiss_invitation: false,
            },
        )
        .unwrap();
        assert!(record(&storage, ProductEvent::TaskCompleted).unwrap());
        assert_eq!(get_settings(&storage).unwrap().local_event_count, 1);

        let disabled = set_settings(
            &storage,
            SetTelemetrySettingsInput {
                enabled: false,
                dismiss_invitation: false,
            },
        )
        .unwrap();
        assert!(!disabled.enabled);
        assert_eq!(disabled.local_event_count, 0);
    }

    #[test]
    fn dictionary_and_all_event_properties_exclude_forbidden_fields() {
        let events = [
            ProductEvent::TaskCreated,
            ProductEvent::TaskCompleted,
            ProductEvent::ReviewPresented,
            ProductEvent::ReviewDecision {
                decision: ReviewDecision::Partial,
            },
            ProductEvent::ReviewAdopted,
            ProductEvent::AcceptedPatch,
            ProductEvent::UndoCompleted,
            ProductEvent::ResultSaved,
            ProductEvent::ResultCreated,
            ProductEvent::ResultExported {
                format: ExportFormat::Docx,
            },
            ProductEvent::ContextConfirmed {
                location: ProcessingLocation::Cloud,
            },
            ProductEvent::ContextPlanned,
            ProductEvent::FirstCoreLoopCompleted {
                trigger: CoreLoopTrigger::Save,
            },
            ProductEvent::AiRequestCompleted {
                outcome: Outcome::Failure,
                error_category: ErrorCategory::Provider,
                duration_ms: 1_250,
                location: ProcessingLocation::Cloud,
            },
            ProductEvent::A2uiRendered {
                outcome: Outcome::Success,
                error_category: ErrorCategory::None,
                duration_ms: 20,
            },
            ProductEvent::CrashRecoveryDetected,
            ProductEvent::PerformanceSample {
                operation: PerformanceOperation::ResultSave,
                outcome: Outcome::Success,
                duration_ms: 42,
            },
        ];
        let forbidden = [
            "content",
            "prompt",
            "response",
            "file_name",
            "path",
            "api_key",
            "endpoint",
            "email",
            "identity",
            "image",
            "index_content",
            "workspace_id",
            "session_id",
        ];
        for event in events {
            let encoded = serde_json::to_string(&event.properties())
                .unwrap()
                .to_ascii_lowercase();
            for field in forbidden {
                assert!(
                    !encoded.contains(field),
                    "forbidden telemetry field {field}: {encoded}"
                );
            }
        }
        for definition in event_definitions() {
            for field in definition.fields {
                assert!(!forbidden.contains(&field.as_str()));
            }
        }
    }

    #[test]
    fn first_core_loop_only_marks_local_invitation_when_collection_is_off() {
        let storage = Storage::open_in_memory().unwrap();
        mark_first_core_loop(&storage, CoreLoopTrigger::Save);
        let settings = get_settings(&storage).unwrap();
        assert!(settings.invitation_eligible);
        assert!(!settings.enabled);
        assert_eq!(settings.local_event_count, 0);
        assert!(!settings.invitation_dismissed);
    }

    #[test]
    fn only_an_explicit_eligible_invitation_choice_dismisses_the_invitation() {
        let storage = Storage::open_in_memory().unwrap();
        storage.set_telemetry_settings(false, true).unwrap();
        assert!(!get_settings(&storage).unwrap().invitation_dismissed);
        storage.set_telemetry_settings(true, false).unwrap();
        storage.set_telemetry_settings(false, false).unwrap();
        mark_first_core_loop(&storage, CoreLoopTrigger::Save);
        let settings = get_settings(&storage).unwrap();
        assert!(settings.invitation_eligible);
        assert!(!settings.invitation_dismissed);
        assert!(!settings.enabled);
        assert_eq!(settings.local_event_count, 0);
        storage.set_telemetry_settings(false, true).unwrap();
        mark_first_core_loop(&storage, CoreLoopTrigger::Save);
        assert!(get_settings(&storage).unwrap().invitation_dismissed);
    }

    #[test]
    fn core_kpis_use_outcome_denominators_instead_of_vanity_metrics() {
        let storage = Storage::open_in_memory().unwrap();
        set_settings(
            &storage,
            SetTelemetrySettingsInput {
                enabled: true,
                dismiss_invitation: false,
            },
        )
        .unwrap();
        for event in [
            ProductEvent::TaskCreated,
            ProductEvent::TaskCompleted,
            ProductEvent::ReviewPresented,
            ProductEvent::ReviewAdopted,
            ProductEvent::AcceptedPatch,
            ProductEvent::UndoCompleted,
            ProductEvent::ContextPlanned,
            ProductEvent::ContextConfirmed {
                location: ProcessingLocation::Local,
            },
            ProductEvent::ResultCreated,
            ProductEvent::ResultSaved,
        ] {
            record(&storage, event).unwrap();
        }
        let settings = get_settings(&storage).unwrap();
        assert_eq!(settings.kpis.len(), 6);
        assert!(settings
            .kpis
            .iter()
            .filter(|kpi| kpi.key != "export_save_rate" && kpi.key != "undo_rate")
            .all(|kpi| kpi.rate_basis_points == Some(10_000)));
        assert!(settings
            .kpis
            .iter()
            .all(|kpi| !kpi.key.contains("dau") && !kpi.key.contains("message")));
    }

    #[test]
    fn operation_rates_work_without_creation_events_and_exclude_cancelled_attempts() {
        let storage = Storage::open_in_memory().unwrap();
        storage.set_telemetry_settings(true, false).unwrap();
        observe(&storage, PerformanceOperation::ResultExport, || Ok(())).unwrap();
        let _ = observe::<()>(&storage, PerformanceOperation::ResultSave, || {
            Err(AppError::FileConflict)
        });
        let _ = observe::<()>(&storage, PerformanceOperation::ResultExport, || {
            Err(AppError::RequestCancelled)
        });
        observe(&storage, PerformanceOperation::DocumentRestore, || Ok(())).unwrap();
        let settings = get_settings(&storage).unwrap();
        let save = settings
            .kpis
            .iter()
            .find(|k| k.key == "export_save_rate")
            .unwrap();
        assert_eq!(
            (save.numerator, save.denominator, save.rate_basis_points),
            (1, 2, Some(5000))
        );
        let undo = settings.kpis.iter().find(|k| k.key == "undo_rate").unwrap();
        assert_eq!(undo.rate_basis_points, Some(10000));
        assert!(!settings.event_counts.contains_key("result_created"));
        storage.set_telemetry_settings(false, false).unwrap();
        observe(&storage, PerformanceOperation::DocumentRestore, || Ok(())).unwrap();
        assert_eq!(get_settings(&storage).unwrap().local_event_count, 0);
    }
}
