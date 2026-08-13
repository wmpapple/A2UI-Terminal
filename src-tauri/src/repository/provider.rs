use crate::ai::ProviderConfig;
use crate::error::AppError;
use crate::storage::Storage;

pub struct ProviderRepository<'a> {
    storage: &'a Storage,
}

impl<'a> ProviderRepository<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn list(&self) -> Result<Vec<ProviderConfig>, AppError> {
        self.storage.provider_configs()
    }

    pub fn find(&self, provider_id: &str) -> Result<Option<ProviderConfig>, AppError> {
        self.storage.provider_config(provider_id)
    }

    pub fn save(&self, config: &ProviderConfig) -> Result<(), AppError> {
        self.storage.save_provider_config(config)
    }

    pub fn active_id(&self) -> Result<String, AppError> {
        self.storage.active_provider_id()
    }

    pub fn set_active(&self, provider_id: &str) -> Result<(), AppError> {
        self.storage.set_active_provider(provider_id)
    }

    pub fn remember_secret_owner(&self, provider_id: &str) -> Result<(), AppError> {
        self.storage.remember_provider_id(provider_id)
    }

    pub fn forget_secret_owner(&self, provider_id: &str) -> Result<(), AppError> {
        self.storage.forget_provider_id(provider_id)
    }
}
