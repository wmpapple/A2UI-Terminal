fn main() {
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "get_bootstrap_status",
        "set_provider_secret",
        "provider_secret_status",
        "delete_provider_secret",
        "clear_all_local_data",
    ]);

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to build Tauri application manifest");
}
