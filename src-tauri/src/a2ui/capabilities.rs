use super::protocol::ALLOWED_COMPONENTS;
use serde::{Deserialize, Serialize};

pub const OFFICIAL_PROTOCOL_VERSION: &str = "v0.9.1";
pub const COMPATIBLE_PROTOCOL_VERSION: &str = "v0.9";
pub const LEGACY_PROTOCOL_VERSION: &str = "1.0";
pub const CATALOG_ID: &str = "urn:a2ui-terminal:catalog:basic:v1";
pub const A2UI_MIME_TYPE: &str = "application/a2ui+json";
pub const ALLOWED_ACTIONS: &[&str] = &["set_state", "submit_form", "request_patch"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct A2uiCapabilities {
    pub protocol: String,
    pub preferred_version: String,
    pub supported_versions: Vec<String>,
    pub renderer_capabilities: RendererCapabilities,
    pub catalog: CatalogCapability,
    pub legacy_profile: LegacyProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RendererCapabilities {
    #[serde(rename = "v0.9")]
    pub v0_9: RendererVersionCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RendererVersionCapabilities {
    pub supported_catalog_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCapability {
    pub catalog_id: String,
    pub accepts_inline_catalogs: bool,
    pub components: Vec<String>,
    pub actions: Vec<String>,
    pub incremental_messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProfile {
    pub version: String,
    pub message_types: Vec<String>,
    pub compatibility_only: bool,
}

pub fn capabilities() -> A2uiCapabilities {
    A2uiCapabilities {
        protocol: "A2UI".into(),
        preferred_version: OFFICIAL_PROTOCOL_VERSION.into(),
        supported_versions: vec![
            OFFICIAL_PROTOCOL_VERSION.into(),
            COMPATIBLE_PROTOCOL_VERSION.into(),
        ],
        renderer_capabilities: RendererCapabilities {
            v0_9: RendererVersionCapabilities {
                supported_catalog_ids: vec![CATALOG_ID.into()],
            },
        },
        catalog: CatalogCapability {
            catalog_id: CATALOG_ID.into(),
            accepts_inline_catalogs: false,
            components: ALLOWED_COMPONENTS
                .iter()
                .map(|value| (*value).into())
                .collect(),
            actions: ALLOWED_ACTIONS
                .iter()
                .map(|value| (*value).into())
                .collect(),
            incremental_messages: vec!["updateComponents".into(), "updateDataModel".into()],
        },
        legacy_profile: LegacyProfile {
            version: LEGACY_PROTOCOL_VERSION.into(),
            message_types: vec!["a2ui_surface".into(), "a2ui_update".into()],
            compatibility_only: true,
        },
    }
}

pub fn is_supported_version(version: &str) -> bool {
    matches!(
        version,
        OFFICIAL_PROTOCOL_VERSION | COMPATIBLE_PROTOCOL_VERSION
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_capabilities_are_explicit_and_do_not_accept_inline_catalogs() {
        let value = serde_json::to_value(capabilities()).unwrap();
        assert_eq!(value["preferredVersion"], OFFICIAL_PROTOCOL_VERSION);
        assert_eq!(
            value["rendererCapabilities"]["v0.9"]["supportedCatalogIds"][0],
            CATALOG_ID
        );
        assert!(value["rendererCapabilities"]["v0.9"]
            .get("acceptsInlineCatalogs")
            .is_none());
        assert_eq!(value["catalog"]["acceptsInlineCatalogs"], false);
        assert_eq!(
            value["catalog"]["components"].as_array().unwrap().len(),
            ALLOWED_COMPONENTS.len()
        );
    }
}
