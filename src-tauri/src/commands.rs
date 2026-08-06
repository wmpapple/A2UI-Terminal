use crate::error::AppError;
use crate::security::{validate_provider_id, SecretStore};
use crate::state::AppState;
use serde::Serialize;
use std::collections::BTreeSet;
use tauri::State;

const CLEAR_CONFIRMATION: &str = "DELETE_ALL_LOCAL_DATA";
const BUILT_IN_PROVIDERS: &[&str] = &["siliconflow", "deepseek", "openai"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
    runtime: &'static str,
    database_ready: bool,
    schema_version: i64,
    credential_store: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    provider_id: String,
    configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearAllResult {
    cleared: bool,
}

#[tauri::command]
pub fn get_bootstrap_status(state: State<'_, AppState>) -> Result<BootstrapStatus, AppError> {
    Ok(BootstrapStatus {
        runtime: "desktop",
        database_ready: true,
        schema_version: state.storage.schema_version()?,
        credential_store: "windows-credential-manager",
    })
}

#[tauri::command]
pub fn set_provider_secret(
    state: State<'_, AppState>,
    provider_id: String,
    secret: String,
) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(&provider_id)?;
    SecretStore::set(&provider_id, &secret)?;
    if let Err(error) = state.storage.remember_provider_id(&provider_id) {
        let _ = SecretStore::delete(&provider_id);
        return Err(error);
    }
    Ok(SecretStatus {
        provider_id,
        configured: true,
    })
}

#[tauri::command]
pub fn provider_secret_status(provider_id: String) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(&provider_id)?;
    Ok(SecretStatus {
        configured: SecretStore::exists(&provider_id)?,
        provider_id,
    })
}

#[tauri::command]
pub fn delete_provider_secret(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(&provider_id)?;
    SecretStore::delete(&provider_id)?;
    state.storage.forget_provider_id(&provider_id)?;
    Ok(SecretStatus {
        provider_id,
        configured: false,
    })
}

#[tauri::command]
pub fn clear_all_local_data(
    state: State<'_, AppState>,
    confirmation: String,
) -> Result<ClearAllResult, AppError> {
    if confirmation != CLEAR_CONFIRMATION {
        return Err(AppError::InvalidInput(
            "清除本地数据需要精确确认文本".into(),
        ));
    }

    let mut provider_ids = state
        .storage
        .provider_ids()?
        .into_iter()
        .collect::<BTreeSet<_>>();
    provider_ids.extend(BUILT_IN_PROVIDERS.iter().map(ToString::to_string));
    for provider_id in provider_ids {
        SecretStore::delete(&provider_id)?;
    }
    state.storage.clear_all()?;

    Ok(ClearAllResult { cleared: true })
}
