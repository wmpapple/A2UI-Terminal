use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SharePermission {
    Read,
    Review,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharePackage {
    pub schema_version: u32,
    pub id: String,
    pub sender_name: String,
    pub title: String,
    pub format: String,
    pub permission: SharePermission,
    pub content: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackPackage {
    pub schema_version: u32,
    pub id: String,
    pub share_id: String,
    pub base_hash: String,
    pub reviewer_name: String,
    pub comments: String,
    pub proposed_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "payload",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum CollaborationPackage {
    Share(SharePackage),
    Feedback(FeedbackPackage),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalIdentity {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateShareInput {
    pub result_id: String,
    pub base_hash: String,
    pub revision_id: String,
    pub permission: SharePermission,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveFeedbackInput {
    pub inbox_id: String,
    pub comments: String,
    pub proposed_content: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationItem {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationOverview {
    pub identity: LocalIdentity,
    pub shares: Vec<CollaborationItem>,
    pub inbox: Vec<CollaborationItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxDetail {
    pub package: CollaborationPackage,
    pub reply: Option<FeedbackPackage>,
}
