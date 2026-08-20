use crate::ai::ProviderMessage;
use crate::error::AppError;
use crate::storage::{ChatSessionRecord, Storage};

pub struct ChatRepository<'a> {
    storage: &'a Storage,
}

pub struct StartChatRequest<'a> {
    pub workspace_id: &'a str,
    pub session_id: &'a str,
    pub request_id: &'a str,
    pub user_message_id: &'a str,
    pub assistant_message_id: &'a str,
    pub provider_id: &'a str,
    pub prompt: &'a str,
    pub context_snapshot_id: &'a str,
    pub sources_json: &'a str,
    pub character_count: usize,
    pub estimated_tokens: usize,
    pub has_sensitive_warning: bool,
}

impl<'a> ChatRepository<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn sessions(&self, workspace_id: &str) -> Result<Vec<ChatSessionRecord>, AppError> {
        self.storage.sessions(workspace_id)
    }

    pub fn workspace_exists(&self, workspace_id: &str) -> Result<bool, AppError> {
        Ok(self.storage.workspace(workspace_id)?.is_some())
    }

    pub fn create_session(
        &self,
        workspace_id: &str,
        session_id: &str,
        title: &str,
    ) -> Result<ChatSessionRecord, AppError> {
        self.storage.create_session(workspace_id, session_id, title)
    }

    pub fn recent_messages(
        &self,
        session_id: &str,
        limit: u32,
    ) -> Result<Vec<ProviderMessage>, AppError> {
        self.storage.recent_chat_messages(session_id, limit)
    }

    pub fn start_request(&self, request: StartChatRequest<'_>) -> Result<(), AppError> {
        self.storage.start_chat_request(
            request.workspace_id,
            request.session_id,
            request.request_id,
            request.user_message_id,
            request.assistant_message_id,
            request.provider_id,
            request.prompt,
            request.context_snapshot_id,
            request.sources_json,
            request.character_count,
            request.estimated_tokens,
            request.has_sensitive_warning,
        )
    }

    pub fn update_assistant(
        &self,
        message_id: &str,
        content: &str,
        status: &str,
        error_code: Option<&str>,
    ) -> Result<(), AppError> {
        self.storage
            .update_assistant_message(message_id, content, status, error_code)
    }
}
