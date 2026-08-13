use crate::error::AppError;
use crate::storage::{PatchSnapshot, Storage};
use crate::workspace::{self, WorkspaceDocument};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

const MAX_CHANGES: usize = 50;
const MAX_ANCHOR_BYTES: usize = 256 * 1024;
const MAX_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_RESULT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentPatch {
    pub version: String,
    #[serde(rename = "type")]
    pub patch_type: String,
    pub workspace_id: String,
    pub base_revision: Option<String>,
    pub summary: String,
    pub changes: Vec<PatchChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchChange {
    pub id: String,
    pub path: String,
    pub operation: PatchOperation,
    pub base_hash: Option<String>,
    pub anchor: PatchAnchor,
    pub content: String,
    pub reason: String,
    pub risk: PatchRisk,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchAnchor {
    pub before: String,
    pub before_hash: Option<String>,
}

impl<'de> Deserialize<'de> for PatchAnchor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum AnchorInput {
            Text(String),
            Object(AnchorObject),
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct AnchorObject {
            before: String,
            before_hash: Option<String>,
        }

        match AnchorInput::deserialize(deserializer)? {
            AnchorInput::Text(before) => Ok(Self {
                before,
                before_hash: None,
            }),
            AnchorInput::Object(anchor) => Ok(Self {
                before: anchor.before,
                before_hash: anchor.before_hash,
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PatchOperation {
    Replace,
    InsertBefore,
    InsertAfter,
    Delete,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PatchRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchReview {
    pub id: String,
    pub workspace_id: String,
    pub summary: String,
    pub patch: DocumentPatch,
    pub changes: Vec<PatchReviewChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchReviewChange {
    pub id: String,
    pub path: String,
    pub operation: PatchOperation,
    pub reason: String,
    pub risk: PatchRisk,
    pub before: String,
    pub after: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedPatchFile {
    pub path: String,
    pub content: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplication {
    pub operation_id: String,
    pub summary: String,
    pub undo_of: Option<String>,
    pub files: Vec<AppliedPatchFile>,
}

struct PlannedFile {
    path: String,
    before: String,
    before_hash: String,
    after: String,
    after_hash: String,
}

struct PlannedChange {
    review: PatchReviewChange,
    start: usize,
    end: usize,
    replacement: String,
}

pub fn parse_review(
    storage: &Storage,
    workspace_id: &str,
    raw: &str,
) -> Result<PatchReview, AppError> {
    let json = extract_json(raw)
        .ok_or_else(|| AppError::InvalidInput("AI 响应中没有有效的 document_patch JSON".into()))?;
    let mut patch: DocumentPatch = serde_json::from_str(json)
        .map_err(|error| AppError::InvalidInput(format!("Patch Schema 无效：{error}")))?;
    canonicalize_model_hashes(storage, workspace_id, &mut patch)?;
    review_patch(storage, workspace_id, patch)
}

pub fn looks_like_patch_candidate(raw: &str) -> bool {
    let normalized = raw.to_ascii_lowercase();
    normalized.contains("document_patch") || normalized.contains("\"changes\"")
}

pub fn review_patch(
    storage: &Storage,
    workspace_id: &str,
    patch: DocumentPatch,
) -> Result<PatchReview, AppError> {
    validate_header(&patch, workspace_id)?;
    let selected = patch
        .changes
        .iter()
        .map(|change| change.id.clone())
        .collect::<BTreeSet<_>>();
    let (files, changes) = plan(storage, &patch, &selected)?;
    if files.is_empty() {
        return Err(AppError::InvalidInput("Patch 没有可审阅的修改".into()));
    }
    Ok(PatchReview {
        id: Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
        summary: patch.summary.clone(),
        patch,
        changes: changes.into_iter().map(|change| change.review).collect(),
    })
}

pub fn apply_patch(
    storage: &Storage,
    workspace_id: &str,
    patch: DocumentPatch,
    selected_change_ids: &[String],
    session_id: Option<&str>,
    assistant_message_id: Option<&str>,
) -> Result<PatchApplication, AppError> {
    validate_header(&patch, workspace_id)?;
    let selected = selected_change_ids.iter().cloned().collect::<BTreeSet<_>>();
    if selected.is_empty() {
        return Err(AppError::InvalidInput("至少选择一个修改块".into()));
    }
    if selected.len() != selected_change_ids.len()
        || selected
            .iter()
            .any(|id| !patch.changes.iter().any(|change| &change.id == id))
    {
        return Err(AppError::InvalidInput("选中的修改块标识无效或重复".into()));
    }
    let (files, _) = plan(storage, &patch, &selected)?;
    let operation_id = Uuid::new_v4().to_string();
    write_all_or_rollback(storage, workspace_id, &files)?;
    let patch_json = serde_json::to_string(&patch).map_err(|_| AppError::StateUnavailable)?;
    let snapshots = snapshots_for(&operation_id, workspace_id, &files);
    if let Err(error) = storage.record_patch_operation(
        &operation_id,
        workspace_id,
        session_id,
        assistant_message_id,
        &patch.summary,
        &patch_json,
        None,
        &snapshots,
    ) {
        rollback_files(storage, workspace_id, &files);
        return Err(error);
    }
    let _ = storage.cleanup_expired_versions();
    Ok(application(&operation_id, &patch.summary, None, &files))
}

pub fn undo_patch(
    storage: &Storage,
    workspace_id: &str,
    operation_id: &str,
) -> Result<PatchApplication, AppError> {
    Uuid::parse_str(operation_id).map_err(|_| AppError::InvalidInput("撤销操作标识无效".into()))?;
    let operation = storage
        .patch_operation(operation_id)?
        .ok_or_else(|| AppError::InvalidInput("找不到可撤销的 Patch".into()))?;
    if operation.workspace_id != workspace_id || operation.status != "applied" {
        return Err(AppError::InvalidInput(
            "该 Patch 不属于当前工作区或已经撤销".into(),
        ));
    }
    let prior = storage.patch_snapshots(operation_id)?;
    if prior.is_empty() {
        return Err(AppError::InvalidInput("该 Patch 没有可恢复的版本".into()));
    }
    let mut grouped: BTreeMap<String, (Option<PatchSnapshot>, Option<PatchSnapshot>)> =
        BTreeMap::new();
    for snapshot in prior {
        let entry = grouped.entry(snapshot.relative_path.clone()).or_default();
        match snapshot.version_kind.as_str() {
            "before" => entry.0 = Some(snapshot),
            "after" => entry.1 = Some(snapshot),
            _ => {}
        }
    }
    let mut files = Vec::with_capacity(grouped.len());
    for (path, (before, after)) in grouped {
        let before = before.ok_or_else(|| AppError::StateUnavailable)?;
        let after = after.ok_or_else(|| AppError::StateUnavailable)?;
        let current = workspace::read_file(storage, workspace_id, &path)?;
        if current.content_hash != after.content_hash {
            return Err(AppError::FileConflict);
        }
        files.push(PlannedFile {
            path,
            before: current.content,
            before_hash: current.content_hash,
            after: before.content,
            after_hash: before.content_hash,
        });
    }
    let undo_id = Uuid::new_v4().to_string();
    write_all_or_rollback(storage, workspace_id, &files)?;
    let summary = format!("撤销：{}", operation.summary);
    let snapshots = snapshots_for(&undo_id, workspace_id, &files);
    if let Err(error) = storage.record_patch_operation(
        &undo_id,
        workspace_id,
        None,
        None,
        &summary,
        &operation.patch_json,
        Some(operation_id),
        &snapshots,
    ) {
        rollback_files(storage, workspace_id, &files);
        return Err(error);
    }
    let _ = storage.cleanup_expired_versions();
    Ok(application(&undo_id, &summary, Some(operation_id), &files))
}

fn validate_header(patch: &DocumentPatch, workspace_id: &str) -> Result<(), AppError> {
    if patch.version != "1.0" || patch.patch_type != "document_patch" {
        return Err(AppError::InvalidInput(
            "仅支持 version=1.0、type=document_patch".into(),
        ));
    }
    if patch.workspace_id != workspace_id {
        return Err(AppError::InvalidInput("Patch 工作区不匹配".into()));
    }
    Uuid::parse_str(workspace_id).map_err(|_| AppError::InvalidInput("工作区标识无效".into()))?;
    if patch.summary.trim().is_empty() || patch.summary.chars().count() > 500 {
        return Err(AppError::InvalidInput(
            "Patch 摘要不能为空且不能超过 500 字".into(),
        ));
    }
    if patch.changes.is_empty() || patch.changes.len() > MAX_CHANGES {
        return Err(AppError::InvalidInput(
            "Patch 修改块数量必须为 1 到 50".into(),
        ));
    }
    let mut ids = BTreeSet::new();
    for change in &patch.changes {
        if change.id.trim().is_empty() || !ids.insert(change.id.as_str()) {
            return Err(AppError::InvalidInput(
                "Patch 修改块标识不能为空或重复".into(),
            ));
        }
        if change.reason.trim().is_empty() || change.reason.chars().count() > 500 {
            return Err(AppError::InvalidInput(
                "修改理由不能为空且不能超过 500 字".into(),
            ));
        }
        if change.anchor.before.is_empty()
            || change.anchor.before.len() > MAX_ANCHOR_BYTES
            || change.content.len() > MAX_CONTENT_BYTES
        {
            return Err(AppError::InvalidInput("Patch 锚点或内容超过限制".into()));
        }
        if change.anchor.before_hash.as_deref()
            != Some(sha256(change.anchor.before.as_bytes()).as_str())
        {
            return Err(AppError::InvalidInput("Patch 锚点 Hash 不匹配".into()));
        }
    }
    Ok(())
}

fn canonicalize_model_hashes(
    storage: &Storage,
    workspace_id: &str,
    patch: &mut DocumentPatch,
) -> Result<(), AppError> {
    if patch.workspace_id != workspace_id {
        return Err(AppError::InvalidInput("Patch 工作区不匹配".into()));
    }
    let mut hashes = BTreeMap::<String, String>::new();
    for change in &mut patch.changes {
        change.anchor.before_hash = Some(sha256(change.anchor.before.as_bytes()));
        let base_hash = if let Some(hash) = hashes.get(&change.path) {
            hash.clone()
        } else {
            let document = workspace::read_file(storage, workspace_id, &change.path)?;
            let hash = document.content_hash;
            hashes.insert(change.path.clone(), hash.clone());
            hash
        };
        change.base_hash = Some(base_hash);
    }
    patch.base_revision = None;
    Ok(())
}

fn plan(
    storage: &Storage,
    patch: &DocumentPatch,
    selected: &BTreeSet<String>,
) -> Result<(Vec<PlannedFile>, Vec<PlannedChange>), AppError> {
    let mut documents = BTreeMap::<String, WorkspaceDocument>::new();
    let mut changes_by_file = BTreeMap::<String, Vec<PlannedChange>>::new();
    for change in patch
        .changes
        .iter()
        .filter(|change| selected.contains(&change.id))
    {
        let document = if let Some(document) = documents.get(&change.path) {
            document.clone()
        } else {
            let document = workspace::read_file(storage, &patch.workspace_id, &change.path)?;
            if !document.editable || document.extracted {
                return Err(AppError::InvalidInput("Patch 只能修改文本代码文件".into()));
            }
            documents.insert(change.path.clone(), document.clone());
            document
        };
        let expected_base = change.base_hash.as_ref().or(patch.base_revision.as_ref());
        if expected_base.map(String::as_str) != Some(document.content_hash.as_str()) {
            return Err(AppError::FileConflict);
        }
        let matches = document
            .content
            .match_indices(&change.anchor.before)
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(AppError::InvalidInput(format!(
                "锚点必须唯一匹配，{} 实际匹配 {} 次",
                change.path,
                matches.len()
            )));
        }
        let anchor_start = matches[0];
        let anchor_end = anchor_start + change.anchor.before.len();
        let (start, end, replacement) = match change.operation {
            PatchOperation::Replace => (anchor_start, anchor_end, change.content.clone()),
            PatchOperation::InsertBefore => (anchor_start, anchor_start, change.content.clone()),
            PatchOperation::InsertAfter => (anchor_end, anchor_end, change.content.clone()),
            PatchOperation::Delete => (anchor_start, anchor_end, String::new()),
        };
        let mut preview = document.content.clone();
        preview.replace_range(start..end, &replacement);
        changes_by_file
            .entry(change.path.clone())
            .or_default()
            .push(PlannedChange {
                review: PatchReviewChange {
                    id: change.id.clone(),
                    path: change.path.clone(),
                    operation: change.operation,
                    reason: change.reason.clone(),
                    risk: change.risk,
                    before: change.anchor.before.clone(),
                    after: match change.operation {
                        PatchOperation::InsertBefore => {
                            format!("{}{}", change.content, change.anchor.before)
                        }
                        PatchOperation::InsertAfter => {
                            format!("{}{}", change.anchor.before, change.content)
                        }
                        PatchOperation::Delete => String::new(),
                        PatchOperation::Replace => change.content.clone(),
                    },
                    selected: true,
                },
                start,
                end,
                replacement,
            });
    }

    let mut files = Vec::new();
    let mut reviews = Vec::new();
    for (path, mut changes) in changes_by_file {
        let document = documents.remove(&path).ok_or(AppError::StateUnavailable)?;
        changes.sort_by_key(|change| (change.start, change.end));
        for pair in changes.windows(2) {
            if pair[1].start < pair[0].end
                || (pair[0].start == pair[1].start && pair[0].end == pair[1].end)
            {
                return Err(AppError::InvalidInput(format!(
                    "同一文件中的修改块重叠：{path}"
                )));
            }
        }
        let mut after = document.content.clone();
        for change in changes.iter().rev() {
            after.replace_range(change.start..change.end, &change.replacement);
        }
        if after.len() > MAX_RESULT_BYTES {
            return Err(AppError::InvalidInput("Patch 结果文件超过 2 MiB".into()));
        }
        let after_hash = sha256(after.as_bytes());
        files.push(PlannedFile {
            path,
            before: document.content,
            before_hash: document.content_hash,
            after,
            after_hash,
        });
        reviews.extend(changes);
    }
    Ok((files, reviews))
}

fn write_all_or_rollback(
    storage: &Storage,
    workspace_id: &str,
    files: &[PlannedFile],
) -> Result<(), AppError> {
    let mut written = Vec::new();
    for file in files {
        if let Err(error) = workspace::save_file(
            storage,
            workspace_id,
            &file.path,
            &file.after,
            &file.before_hash,
        ) {
            for prior in written.iter().rev() {
                let prior: &&PlannedFile = prior;
                let _ = workspace::save_file(
                    storage,
                    workspace_id,
                    &prior.path,
                    &prior.before,
                    &prior.after_hash,
                );
            }
            return Err(error);
        }
        written.push(file);
    }
    Ok(())
}

fn rollback_files(storage: &Storage, workspace_id: &str, files: &[PlannedFile]) {
    for file in files.iter().rev() {
        let _ = workspace::save_file(
            storage,
            workspace_id,
            &file.path,
            &file.before,
            &file.after_hash,
        );
    }
}

fn snapshots_for(
    operation_id: &str,
    workspace_id: &str,
    files: &[PlannedFile],
) -> Vec<PatchSnapshot> {
    files
        .iter()
        .flat_map(|file| {
            [
                PatchSnapshot {
                    id: Uuid::new_v4().to_string(),
                    operation_id: operation_id.to_string(),
                    workspace_id: workspace_id.to_string(),
                    relative_path: file.path.clone(),
                    content: file.before.clone(),
                    content_hash: file.before_hash.clone(),
                    version_kind: "before".into(),
                },
                PatchSnapshot {
                    id: Uuid::new_v4().to_string(),
                    operation_id: operation_id.to_string(),
                    workspace_id: workspace_id.to_string(),
                    relative_path: file.path.clone(),
                    content: file.after.clone(),
                    content_hash: file.after_hash.clone(),
                    version_kind: "after".into(),
                },
            ]
        })
        .collect()
}

fn application(
    operation_id: &str,
    summary: &str,
    undo_of: Option<&str>,
    files: &[PlannedFile],
) -> PatchApplication {
    PatchApplication {
        operation_id: operation_id.to_string(),
        summary: summary.to_string(),
        undo_of: undo_of.map(str::to_string),
        files: files
            .iter()
            .map(|file| AppliedPatchFile {
                path: file.path.clone(),
                content: file.after.clone(),
                content_hash: file.after_hash.clone(),
            })
            .collect(),
    }
}

fn extract_json(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }
    for marker in ["```json", "```JSON", "```"] {
        if let Some(start) = trimmed.find(marker) {
            let rest = &trimmed[start + marker.len()..];
            if let Some(end) = rest.find("```") {
                let candidate = rest[..end].trim();
                if candidate.starts_with('{') && candidate.ends_with('}') {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn sha256(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Storage;
    use std::fs;

    fn setup(path: &str, content: &str) -> (tempfile::TempDir, Storage, String) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, content).unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let id = Uuid::new_v4().to_string();
        storage
            .upsert_workspace(&id, "Patch test", dir.path().to_str().unwrap())
            .unwrap();
        (dir, storage, id)
    }

    fn patch(workspace_id: &str, path: &str, original: &str, content: &str) -> DocumentPatch {
        DocumentPatch {
            version: "1.0".into(),
            patch_type: "document_patch".into(),
            workspace_id: workspace_id.into(),
            base_revision: Some(sha256(fs::read(path).unwrap_or_default().as_slice())),
            summary: "test patch".into(),
            changes: vec![PatchChange {
                id: "change-1".into(),
                path: path.into(),
                operation: PatchOperation::Replace,
                base_hash: None,
                anchor: PatchAnchor {
                    before: original.into(),
                    before_hash: Some(sha256(original.as_bytes())),
                },
                content: content.into(),
                reason: "test".into(),
                risk: PatchRisk::Low,
            }],
        }
    }

    #[test]
    fn ten_typical_text_patch_tasks_apply_and_undo_end_to_end() {
        let cases = [
            ("a.json", "{\"a\":1}\n", "1", "2"),
            ("b.ts", "const n = 1;\n", "1", "2"),
            ("c.js", "let ok = false;\n", "false", "true"),
            ("d.py", "value = 1\n", "1", "2"),
            ("e.yaml", "enabled: false\n", "false", "true"),
            ("f.yml", "count: 1\n", "1", "3"),
            ("g.md", "# Old\n", "Old", "New"),
            ("h.txt", "before\n", "before", "after"),
            ("i.tsx", "<p>old</p>\n", "old", "new"),
            ("j.mjs", "export default 1;\n", "1", "2"),
        ];
        for (path, original_file, anchor, replacement) in cases {
            let (_dir, storage, workspace_id) = setup(path, original_file);
            let document = workspace::read_file(&storage, &workspace_id, path).unwrap();
            let mut proposal = patch(&workspace_id, path, anchor, replacement);
            proposal.base_revision = Some(document.content_hash);
            let review = review_patch(&storage, &workspace_id, proposal.clone()).unwrap();
            assert_eq!(review.changes.len(), 1, "failed case {path}");
            assert_eq!(review.changes[0].after, replacement);
            let applied = apply_patch(
                &storage,
                &workspace_id,
                proposal,
                &["change-1".into()],
                None,
                None,
            )
            .unwrap();
            assert!(fs::read_to_string(_dir.path().join(path))
                .unwrap()
                .contains(replacement));
            undo_patch(&storage, &workspace_id, &applied.operation_id).unwrap();
            assert_eq!(
                fs::read_to_string(_dir.path().join(path)).unwrap(),
                original_file
            );
        }
    }

    #[test]
    fn apply_creates_versions_and_undo_creates_a_new_version() {
        let (dir, storage, workspace_id) = setup("config.json", "{\"value\":1}\n");
        let document = workspace::read_file(&storage, &workspace_id, "config.json").unwrap();
        let mut proposal = patch(&workspace_id, "config.json", "1", "2");
        proposal.base_revision = Some(document.content_hash);
        let applied = apply_patch(
            &storage,
            &workspace_id,
            proposal,
            &["change-1".into()],
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("config.json")).unwrap(),
            "{\"value\":2}\n"
        );
        let undone = undo_patch(&storage, &workspace_id, &applied.operation_id).unwrap();
        assert_eq!(
            undone.undo_of.as_deref(),
            Some(applied.operation_id.as_str())
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("config.json")).unwrap(),
            "{\"value\":1}\n"
        );
    }

    #[test]
    fn rejecting_every_change_never_writes_the_file() {
        let (dir, storage, workspace_id) = setup("app.ts", "const value = 1;\n");
        let document = workspace::read_file(&storage, &workspace_id, "app.ts").unwrap();
        let mut proposal = patch(&workspace_id, "app.ts", "1", "2");
        proposal.base_revision = Some(document.content_hash);
        assert!(apply_patch(&storage, &workspace_id, proposal, &[], None, None).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("app.ts")).unwrap(),
            "const value = 1;\n"
        );
    }

    #[test]
    fn derives_security_hashes_in_rust_instead_of_trusting_the_model() {
        let (_dir, storage, workspace_id) = setup("app.ts", "const value = 1;\n");
        let document = workspace::read_file(&storage, &workspace_id, "app.ts").unwrap();
        let mut proposal = patch(&workspace_id, "app.ts", "1", "2");
        proposal.base_revision = Some("model-guessed-base".into());
        proposal.changes[0].base_hash = Some("model-guessed-file-hash".into());
        proposal.changes[0].anchor.before_hash = Some("model-guessed-anchor-hash".into());
        let raw = serde_json::to_string(&proposal).unwrap();

        let review = parse_review(&storage, &workspace_id, &raw).unwrap();

        assert_eq!(review.patch.base_revision, None);
        assert_eq!(
            review.patch.changes[0].base_hash.as_deref(),
            Some(document.content_hash.as_str())
        );
        assert_eq!(
            review.patch.changes[0].anchor.before_hash.as_deref(),
            Some(sha256(b"1").as_str())
        );
    }

    #[test]
    fn normalizes_the_common_string_anchor_model_shorthand() {
        let (_dir, storage, workspace_id) = setup(
            "guide.md",
            "Example:\n```bash\ncurl http://localhost:8000\n```\n",
        );
        let raw = serde_json::json!({
            "version": "1.0",
            "type": "document_patch",
            "workspaceId": workspace_id,
            "summary": "add summary",
            "changes": [{
                "id": "summary",
                "path": "guide.md",
                "operation": "insert_after",
                "anchor": "curl http://localhost:8000\n```",
                "content": "\n\n## Summary\nDone.\n",
                "reason": "requested",
                "risk": "low"
            }]
        })
        .to_string();

        let review = parse_review(&storage, &workspace_id, &raw).unwrap();

        assert_eq!(review.changes[0].before, "curl http://localhost:8000\n```");
        assert!(review.patch.changes[0].anchor.before_hash.is_some());
    }

    #[test]
    fn applies_and_undoes_multiple_files_as_one_operation() {
        let (dir, storage, workspace_id) = setup("src/app.ts", "const value = 1;\n");
        fs::write(dir.path().join("config.json"), "{\"enabled\":false}\n").unwrap();
        let app = workspace::read_file(&storage, &workspace_id, "src/app.ts").unwrap();
        let config = workspace::read_file(&storage, &workspace_id, "config.json").unwrap();
        let proposal = DocumentPatch {
            version: "1.0".into(),
            patch_type: "document_patch".into(),
            workspace_id: workspace_id.clone(),
            base_revision: None,
            summary: "multi file".into(),
            changes: vec![
                PatchChange {
                    id: "app".into(),
                    path: "src/app.ts".into(),
                    operation: PatchOperation::Replace,
                    base_hash: Some(app.content_hash),
                    anchor: PatchAnchor {
                        before: "1".into(),
                        before_hash: Some(sha256(b"1")),
                    },
                    content: "2".into(),
                    reason: "update app".into(),
                    risk: PatchRisk::Low,
                },
                PatchChange {
                    id: "config".into(),
                    path: "config.json".into(),
                    operation: PatchOperation::Replace,
                    base_hash: Some(config.content_hash),
                    anchor: PatchAnchor {
                        before: "false".into(),
                        before_hash: Some(sha256(b"false")),
                    },
                    content: "true".into(),
                    reason: "enable config".into(),
                    risk: PatchRisk::Medium,
                },
            ],
        };
        let applied = apply_patch(
            &storage,
            &workspace_id,
            proposal,
            &["app".into(), "config".into()],
            None,
            None,
        )
        .unwrap();
        assert_eq!(applied.files.len(), 2);
        assert!(fs::read_to_string(dir.path().join("src/app.ts"))
            .unwrap()
            .contains('2'));
        assert!(fs::read_to_string(dir.path().join("config.json"))
            .unwrap()
            .contains("true"));
        undo_patch(&storage, &workspace_id, &applied.operation_id).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("src/app.ts")).unwrap(),
            "const value = 1;\n"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("config.json")).unwrap(),
            "{\"enabled\":false}\n"
        );
    }

    #[test]
    fn rejects_conflict_traversal_duplicate_anchor_and_invalid_schema_without_writes() {
        let (dir, storage, workspace_id) = setup("safe.ts", "const x = 1;\nconst x = 1;\n");
        let document = workspace::read_file(&storage, &workspace_id, "safe.ts").unwrap();
        let mut duplicate = patch(&workspace_id, "safe.ts", "const x = 1;", "const x = 2;");
        duplicate.base_revision = Some(document.content_hash.clone());
        assert!(review_patch(&storage, &workspace_id, duplicate).is_err());
        let mut traversal = patch(&workspace_id, "../safe.ts", "1", "2");
        traversal.base_revision = Some(document.content_hash.clone());
        assert!(review_patch(&storage, &workspace_id, traversal).is_err());
        let mut conflict = patch(&workspace_id, "safe.ts", "1", "2");
        conflict.base_revision = Some("0".repeat(64));
        assert!(review_patch(&storage, &workspace_id, conflict).is_err());
        let raw = r#"{"version":"2.0","type":"document_patch"}"#;
        assert!(parse_review(&storage, &workspace_id, raw).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("safe.ts")).unwrap(),
            "const x = 1;\nconst x = 1;\n"
        );
    }
}
