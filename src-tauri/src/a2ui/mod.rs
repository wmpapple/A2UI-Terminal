pub const SCHEMA_VERSION: &str = "1.0";

pub const ALLOWED_COMPONENTS: &[&str] = &[
    "Row",
    "Column",
    "Stack",
    "Text",
    "Card",
    "Badge",
    "Progress",
    "TextField",
    "Select",
    "Checkbox",
    "Button",
    "Tabs",
    "Form",
];

pub fn is_component_allowed(component: &str) -> bool {
    ALLOWED_COMPONENTS.contains(&component)
}

#[cfg(test)]
mod tests {
    use super::is_component_allowed;

    #[test]
    fn defaults_to_deny_for_unknown_components() {
        assert!(is_component_allowed("Form"));
        assert!(!is_component_allowed("Script"));
        assert!(!is_component_allowed("IFrame"));
    }
}
