use crate::ai::{ContextIndex, PendingContextManifest};
use crate::application::import::PendingImportBatch;
use crate::domain::import::ImportDropTarget;
use crate::storage::Storage;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;
use std::sync::Mutex;

pub struct AppState {
    pub storage: Storage,
    pub managed_results_dir: PathBuf,
    pub selected_files: Mutex<HashMap<String, PathBuf>>,
    pub pending_imports: Mutex<HashMap<String, PendingImportBatch>>,
    pub import_drop_targets: Mutex<HashMap<String, ImportDropTarget>>,
    pub native_import_drop_active: AtomicBool,
    pub import_drop_epoch: AtomicU64,
    pub active_requests: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub pending_context_manifests: Mutex<HashMap<String, PendingContextManifest>>,
    pub context_index: Mutex<ContextIndex>,
}

impl AppState {
    pub fn new(storage: Storage, managed_results_dir: PathBuf) -> Self {
        Self {
            storage,
            managed_results_dir,
            selected_files: Mutex::new(HashMap::new()),
            pending_imports: Mutex::new(HashMap::new()),
            import_drop_targets: Mutex::new(HashMap::new()),
            native_import_drop_active: AtomicBool::new(false),
            import_drop_epoch: AtomicU64::new(0),
            active_requests: Mutex::new(HashMap::new()),
            pending_context_manifests: Mutex::new(HashMap::new()),
            context_index: Mutex::new(ContextIndex::default()),
        }
    }
}
