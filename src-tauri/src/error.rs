use serde::ser::{Serialize, SerializeStruct, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("credential store operation failed")]
    Credential(#[from] keyring::v1::Error),
    #[error("local database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("filesystem operation failed")]
    Io(#[from] std::io::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("internal state is unavailable")]
    StateUnavailable,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Credential(_) => "CREDENTIAL_STORE_ERROR",
            Self::Database(_) => "DATABASE_ERROR",
            Self::Io(_) => "FILESYSTEM_ERROR",
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
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.public_message())?;
        state.end()
    }
}
