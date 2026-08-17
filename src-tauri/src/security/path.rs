use std::path::Path;

pub fn is_sensitive_path(path: &Path) -> bool {
    let normalized = path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    let file_name = normalized.rsplit('/').next().unwrap_or(&normalized);
    normalized
        .split('/')
        .any(|part| matches!(part, "secrets" | ".ssh" | ".git"))
        || file_name == ".env"
        || file_name.starts_with(".env.")
        || matches!(
            file_name,
            "id_rsa" | "id_ed25519" | "credentials.json" | "service-account.json"
        )
        || [".pem", ".key", ".p12", ".pfx", ".crt", ".cer"]
            .iter()
            .any(|suffix| file_name.ends_with(suffix))
}

pub fn is_hidden_path(path: &Path) -> bool {
    path.file_name()
        .map(|value| value.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{is_hidden_path, is_sensitive_path};
    use std::path::Path;

    #[test]
    fn classifies_hidden_and_sensitive_paths_without_reading_content() {
        for path in [
            ".env",
            ".env.production",
            "secrets/token.txt",
            "certs/app.pfx",
            "id_rsa",
            ".ssh/config",
        ] {
            assert!(is_sensitive_path(Path::new(path)), "accepted {path}");
        }
        assert!(is_hidden_path(Path::new("project/.private-notes.txt")));
        assert!(!is_sensitive_path(Path::new("src/config.ts")));
        assert!(!is_hidden_path(Path::new("src/config.ts")));
    }
}
