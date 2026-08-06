use crate::storage::Storage;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub storage: Storage,
    pub selected_files: Mutex<HashMap<String, PathBuf>>,
}

impl AppState {
    pub fn new(storage: Storage) -> Self {
        Self {
            storage,
            selected_files: Mutex::new(HashMap::new()),
        }
    }
}
