use serde::ser::{Serialize, SerializeStruct, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
#[error("{message}")]
pub struct ProviderFailure {
    code: &'static str,
    message: String,
    retryable: bool,
    http_status: Option<u16>,
    retry_after_seconds: Option<u64>,
}

impl ProviderFailure {
    pub fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            http_status: None,
            retry_after_seconds: None,
        }
    }

    pub fn with_http_status(mut self, status: u16) -> Self {
        self.http_status = Some(status);
        self
    }

    pub fn with_retry_after(mut self, seconds: Option<u64>) -> Self {
        self.retry_after_seconds = seconds;
        self
    }

    pub fn code(&self) -> &'static str {
        self.code
    }

    pub fn retryable(&self) -> bool {
        self.retryable
    }

    pub fn http_status(&self) -> Option<u16> {
        self.http_status
    }

    pub fn retry_after_seconds(&self) -> Option<u64> {
        self.retry_after_seconds
    }
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("credential store operation failed")]
    Credential(#[from] keyring::v1::Error),
    #[error("provider credential is not configured")]
    CredentialNotFound,
    #[error("system credential store is unavailable or locked")]
    CredentialUnavailable,
    #[error("local database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("local database failed its integrity check")]
    DatabaseIntegrity,
    #[error("filesystem operation failed")]
    Io(#[from] std::io::Error),
    #[error("selected file is not valid UTF-8 text")]
    InvalidEncoding,
    #[error("selected file exceeds the size limit")]
    FileTooLarge,
    #[error("file changed outside A2UI Terminal")]
    FileConflict,
    #[error(transparent)]
    Provider(#[from] ProviderFailure),
    #[error("provider request was cancelled")]
    RequestCancelled,
    #[error("the desktop stream receiver is no longer available")]
    StreamReceiverClosed,
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("internal state is unavailable")]
    StateUnavailable,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Credential(_) => "CREDENTIAL_STORE_ERROR",
            Self::CredentialNotFound => "CREDENTIAL_NOT_FOUND",
            Self::CredentialUnavailable => "CREDENTIAL_STORE_UNAVAILABLE",
            Self::Database(_) => "DATABASE_ERROR",
            Self::DatabaseIntegrity => "DATABASE_INTEGRITY_ERROR",
            Self::Io(_) => "FILESYSTEM_ERROR",
            Self::InvalidEncoding => "INVALID_ENCODING",
            Self::FileTooLarge => "FILE_TOO_LARGE",
            Self::FileConflict => "FILE_CONFLICT",
            Self::Provider(failure) => failure.code(),
            Self::RequestCancelled => "REQUEST_CANCELLED",
            Self::StreamReceiverClosed => "STREAM_RECEIVER_CLOSED",
            Self::InvalidInput(_) => "INVALID_INPUT",
            Self::StateUnavailable => "STATE_UNAVAILABLE",
        }
    }

    fn public_message(&self) -> String {
        match self {
            Self::InvalidInput(message) => message.clone(),
            _ => self.to_string(),
        }
    }

    pub fn retryable(&self) -> bool {
        match self {
            Self::Provider(failure) => failure.retryable(),
            _ => false,
        }
    }

    pub fn http_status(&self) -> Option<u16> {
        match self {
            Self::Provider(failure) => failure.http_status(),
            _ => None,
        }
    }

    pub fn retry_after_seconds(&self) -> Option<u64> {
        match self {
            Self::Provider(failure) => failure.retry_after_seconds(),
            _ => None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 5)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.public_message())?;
        state.serialize_field("retryable", &self.retryable())?;
        state.serialize_field("httpStatus", &self.http_status())?;
        state.serialize_field("retryAfterSeconds", &self.retry_after_seconds())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::{AppError, ProviderFailure};

    #[test]
    fn serializes_actionable_provider_error_metadata_without_internal_details() {
        let error = AppError::Provider(
            ProviderFailure::new("PROVIDER_RATE_LIMITED", "请求过于频繁", true)
                .with_http_status(429)
                .with_retry_after(Some(12)),
        );
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["code"], "PROVIDER_RATE_LIMITED");
        assert_eq!(value["message"], "请求过于频繁");
        assert_eq!(value["retryable"], true);
        assert_eq!(value["httpStatus"], 429);
        assert_eq!(value["retryAfterSeconds"], 12);
    }
}
