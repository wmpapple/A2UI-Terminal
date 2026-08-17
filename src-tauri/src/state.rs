use crate::storage::Storage;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;

pub struct AppState {
    pub storage: Storage,
    pub managed_results_dir: PathBuf,
    pub selected_files: Mutex<HashMap<String, PathBuf>>,
    pub active_requests: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub fn new(storage: Storage, managed_results_dir: PathBuf) -> Self {
        Self {
            storage,
            managed_results_dir,
            selected_files: Mutex::new(HashMap::new()),
            active_requests: Mutex::new(HashMap::new()),
        }
    }
}
