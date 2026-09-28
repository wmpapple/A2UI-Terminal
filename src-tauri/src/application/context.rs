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
    let input = crate::application::context_pack::expand_manifest_input(storage, input)?;
    let mut pending = ai::plan_context_manifest(storage, index, input)?;
    pending.view.citations = super::citation::decorate(
        storage,
        &pending.view.workspace_id,
        &mut pending.sources,
        &pending.view.included_sources,
    )?;
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
