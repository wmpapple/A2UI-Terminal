use crate::ai::{
    self, ConfirmContextManifestInput, ContextIndex, ContextManifest, ContextManifestInput,
    PendingContextManifest,
};
use crate::error::AppError;
use crate::storage::Storage;
use std::collections::HashMap;

pub fn plan(
    storage: &Storage,
    index: &mut ContextIndex,
    manifests: &mut HashMap<String, PendingContextManifest>,
    input: ContextManifestInput,
) -> Result<ContextManifest, AppError> {
    let pending = ai::plan_context_manifest(storage, index, input)?;
    let view = pending.view.clone();
    manifests.clear();
    manifests.insert(view.id.clone(), pending);
    Ok(view)
}

pub fn confirm(
    manifests: &mut HashMap<String, PendingContextManifest>,
    input: ConfirmContextManifestInput,
) -> Result<ContextManifest, AppError> {
    ai::confirm_context_manifest(manifests, input)
}
