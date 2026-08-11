use crate::error::AppError;
use keyring::v1::Entry;
use zeroize::Zeroizing;

const SERVICE_NAME: &str = "com.a2ui.terminal.provider";
const MAX_SECRET_LENGTH: usize = 8_192;

pub struct SecretStore;

impl SecretStore {
    pub fn set(provider_id: &str, secret: &str) -> Result<(), AppError> {
        let provider_id = validate_provider_id(provider_id)?;
        let secret = secret.trim();
        if secret.len() < 8 || secret.len() > MAX_SECRET_LENGTH {
            return Err(AppError::InvalidInput(
                "API 密钥长度必须在 8 到 8192 个字符之间".into(),
            ));
        }
        Self::entry(&provider_id)?
            .set_password(secret)
            .map_err(map_store_error)?;
        Ok(())
    }

    pub fn exists(provider_id: &str) -> Result<bool, AppError> {
        let provider_id = validate_provider_id(provider_id)?;
        match Self::entry(&provider_id)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::v1::Error::NoEntry) => Ok(false),
            Err(error) => Err(map_store_error(error)),
        }
    }

    pub(crate) fn get(provider_id: &str) -> Result<Zeroizing<String>, AppError> {
        let provider_id = validate_provider_id(provider_id)?;
        Self::entry(&provider_id)?
            .get_password()
            .map(Zeroizing::new)
            .map_err(map_store_error)
    }

    pub(crate) fn get_optional(provider_id: &str) -> Result<Option<Zeroizing<String>>, AppError> {
        let provider_id = validate_provider_id(provider_id)?;
        match Self::entry(&provider_id)?.get_password() {
            Ok(secret) => Ok(Some(Zeroizing::new(secret))),
            Err(keyring::v1::Error::NoEntry) => Ok(None),
            Err(error) => Err(map_store_error(error)),
        }
    }

    pub fn delete(provider_id: &str) -> Result<(), AppError> {
        let provider_id = validate_provider_id(provider_id)?;
        match Self::entry(&provider_id)?.delete_credential() {
            Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(error) => Err(map_store_error(error)),
        }
    }

    fn entry(provider_id: &str) -> Result<Entry, AppError> {
        Entry::new(SERVICE_NAME, provider_id).map_err(map_store_error)
    }
}

fn map_store_error(error: keyring::v1::Error) -> AppError {
    match error {
        keyring::v1::Error::NoEntry => AppError::CredentialNotFound,
        keyring::v1::Error::NoStorageAccess(_)
        | keyring::v1::Error::NoDefaultStore
        | keyring::v1::Error::NotSupportedByStore(_) => AppError::CredentialUnavailable,
        other => AppError::Credential(other),
    }
}

pub fn validate_provider_id(provider_id: &str) -> Result<String, AppError> {
    let value = provider_id.trim().to_ascii_lowercase();
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    if !valid {
        return Err(AppError::InvalidInput(
            "提供商标识只能包含字母、数字、短横线和下划线，且不超过 64 个字符".into(),
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::validate_provider_id;

    #[test]
    fn normalizes_provider_ids() {
        assert_eq!(
            validate_provider_id(" OpenAI_Official ").unwrap(),
            "openai_official"
        );
    }

    #[test]
    fn rejects_credential_namespace_injection() {
        assert!(validate_provider_id("provider/../../secret").is_err());
        assert!(validate_provider_id("").is_err());
    }
}
