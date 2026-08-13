use crate::ai::{self, ProviderConfig, ProviderConfigView};
use crate::error::AppError;
use crate::repository::provider::ProviderRepository;
use crate::security::{validate_provider_id, SecretStore};
use crate::storage::Storage;
use serde::Serialize;
use zeroize::Zeroizing;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    provider_id: String,
    configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionResult {
    provider_id: String,
    reachable: bool,
    latency_ms: u128,
}

pub fn set_secret(
    storage: &Storage,
    provider_id: &str,
    secret: String,
) -> Result<SecretStatus, AppError> {
    let secret = Zeroizing::new(secret);
    let provider_id = validate_provider_id(provider_id)?;
    let repository = ProviderRepository::new(storage);
    let previous = SecretStore::get_optional(&provider_id)?;
    SecretStore::set(&provider_id, secret.as_str())?;
    if let Err(error) = repository.remember_secret_owner(&provider_id) {
        if let Some(previous) = previous {
            let _ = SecretStore::set(&provider_id, previous.as_str());
        } else {
            let _ = SecretStore::delete(&provider_id);
        }
        return Err(error);
    }
    Ok(SecretStatus {
        provider_id,
        configured: true,
    })
}

pub fn secret_status(provider_id: &str) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(provider_id)?;
    Ok(SecretStatus {
        configured: SecretStore::exists(&provider_id)?,
        provider_id,
    })
}

pub fn delete_secret(storage: &Storage, provider_id: &str) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(provider_id)?;
    SecretStore::delete(&provider_id)?;
    ProviderRepository::new(storage).forget_secret_owner(&provider_id)?;
    Ok(SecretStatus {
        provider_id,
        configured: false,
    })
}

pub fn list_configs(storage: &Storage) -> Result<Vec<ProviderConfigView>, AppError> {
    let repository = ProviderRepository::new(storage);
    let active_id = repository.active_id()?;
    repository
        .list()?
        .into_iter()
        .map(|config| {
            Ok(ProviderConfigView {
                configured: SecretStore::exists(&config.id)?,
                active: config.id == active_id,
                config,
            })
        })
        .collect()
}

pub fn save_config(
    storage: &Storage,
    config: ProviderConfig,
    secret: Option<String>,
) -> Result<ProviderConfigView, AppError> {
    let repository = ProviderRepository::new(storage);
    let secret = secret.map(Zeroizing::new);
    config.validate()?;
    let previous_config = repository
        .find(&config.id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    if previous_config.kind != config.kind {
        return Err(AppError::InvalidInput(
            "不能修改已有 Provider 的适配器类型".into(),
        ));
    }
    let secret = secret.filter(|value| !value.trim().is_empty());
    let previous_secret = if secret.is_some() {
        SecretStore::get_optional(&config.id)?
    } else {
        None
    };
    repository.save(&config)?;
    if let Some(secret) = secret {
        if let Err(error) = SecretStore::set(&config.id, secret.as_str()) {
            let _ = repository.save(&previous_config);
            return Err(error);
        }
        if let Err(error) = repository.remember_secret_owner(&config.id) {
            if let Some(previous_secret) = previous_secret {
                let _ = SecretStore::set(&config.id, previous_secret.as_str());
            } else {
                let _ = SecretStore::delete(&config.id);
            }
            let _ = repository.save(&previous_config);
            return Err(error);
        }
    }
    Ok(ProviderConfigView {
        configured: SecretStore::exists(&config.id)?,
        active: repository.active_id()? == config.id,
        config,
    })
}

pub fn set_active(storage: &Storage, provider_id: &str) -> Result<(), AppError> {
    let provider_id = validate_provider_id(provider_id)?;
    ProviderRepository::new(storage).set_active(&provider_id)
}

pub async fn test_connection(
    storage: &Storage,
    provider_id: &str,
) -> Result<ProviderConnectionResult, AppError> {
    let provider_id = validate_provider_id(provider_id)?;
    let config = ProviderRepository::new(storage)
        .find(&provider_id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    if !SecretStore::exists(&provider_id)? {
        return Err(AppError::InvalidInput("请先保存 API Key".into()));
    }
    let api_key = SecretStore::get(&provider_id)?;
    let latency_ms = ai::test_connection(&config, &api_key).await?;
    Ok(ProviderConnectionResult {
        provider_id,
        reachable: true,
        latency_ms,
    })
}
