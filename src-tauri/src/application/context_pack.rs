use crate::domain::context_pack::{
    ContextPack, ContextPackItem, CreateContextPackInput, DeleteContextPackOutput,
};
use crate::error::AppError;
use crate::storage::Storage;
use std::collections::HashSet;
use uuid::Uuid;

const MAX_PACKS_PER_WORKSPACE: usize = 50;
const MAX_ITEMS_PER_PACK: usize = 20;

pub fn list(storage: &Storage, workspace_id: &str) -> Result<Vec<ContextPack>, AppError> {
    validate_identifier(workspace_id, "工作区标识")?;
    storage
        .context_packs(workspace_id)?
        .into_iter()
        .map(|row| {
            let items = storage
                .context_pack_items(&row.id)?
                .into_iter()
                .map(|item| ContextPackItem {
                    personal_knowledge: item.personal_knowledge,
                    source_id: item.source_id,
                    label: item.label,
                })
                .collect();
            Ok(ContextPack {
                id: row.id,
                workspace_id: row.workspace_id,
                name: row.name,
                items,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
        })
        .collect()
}

pub fn create(storage: &Storage, input: CreateContextPackInput) -> Result<ContextPack, AppError> {
    validate_identifier(&input.workspace_id, "工作区标识")?;
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::InvalidInput(
            "资料包名称不能为空且不能超过 80 个字符".into(),
        ));
    }
    if input.source_ids.is_empty() || input.source_ids.len() > MAX_ITEMS_PER_PACK {
        return Err(AppError::InvalidInput(
            "资料包必须包含 1 到 20 项已授权来源".into(),
        ));
    }
    let mut unique = HashSet::new();
    for source_id in &input.source_ids {
        validate_identifier(source_id, "资料来源标识")?;
        if !unique.insert(source_id.clone()) {
            return Err(AppError::InvalidInput("资料包不能重复引用同一来源".into()));
        }
        let authorized = storage
            .workspace_file_by_source(source_id)?
            .is_some_and(|row| row.workspace_id == input.workspace_id);
        if !authorized && crate::repository::knowledge::get(storage, source_id).is_err() {
            return Err(AppError::InvalidInput(
                "资料来源不存在或未获当前工作区授权".into(),
            ));
        }
    }
    let existing = list(storage, &input.workspace_id)?;
    if existing.len() >= MAX_PACKS_PER_WORKSPACE {
        return Err(AppError::InvalidInput(
            "每个工作区最多保存 50 个资料包".into(),
        ));
    }
    if existing
        .iter()
        .any(|pack| pack.name.eq_ignore_ascii_case(name))
    {
        return Err(AppError::InvalidInput("当前工作区已有同名资料包".into()));
    }
    let id = Uuid::new_v4().to_string();
    storage.create_context_pack(&id, &input.workspace_id, name, &input.source_ids)?;
    list(storage, &input.workspace_id)?
        .into_iter()
        .find(|pack| pack.id == id)
        .ok_or(AppError::StateUnavailable)
}

pub fn delete(
    storage: &Storage,
    workspace_id: &str,
    pack_id: &str,
) -> Result<DeleteContextPackOutput, AppError> {
    validate_identifier(workspace_id, "工作区标识")?;
    validate_identifier(pack_id, "资料包标识")?;
    if !storage.delete_context_pack(workspace_id, pack_id)? {
        return Err(AppError::InvalidInput(
            "资料包不存在或不属于当前工作区".into(),
        ));
    }
    Ok(DeleteContextPackOutput {
        deleted: true,
        original_files_deleted: false,
    })
}

pub fn expand_manifest_input(
    storage: &Storage,
    mut input: crate::ai::ContextManifestInput,
) -> Result<crate::ai::ContextManifestInput, AppError> {
    if input.context_pack_ids.len() > 10 {
        return Err(AppError::InvalidInput("每次最多挂载 10 个资料包".into()));
    }
    let mut seen_packs = HashSet::new();
    let mut seen_sources = input
        .candidates
        .iter()
        .filter(|candidate| candidate.selected)
        .filter_map(|candidate| candidate.source_id.clone())
        .collect::<HashSet<_>>();
    for pack_id in &input.context_pack_ids {
        validate_identifier(pack_id, "资料包标识")?;
        if !seen_packs.insert(pack_id.clone()) {
            return Err(AppError::InvalidInput("不能重复挂载同一资料包".into()));
        }
        let pack = storage
            .context_pack(&input.workspace_id, pack_id)?
            .ok_or_else(|| AppError::InvalidInput("资料包不存在或不属于当前工作区".into()))?;
        let items = storage.context_pack_items(&pack.id)?;
        if items.is_empty() {
            return Err(AppError::InvalidInput(
                "资料包已无有效授权来源，请刷新后重新选择".into(),
            ));
        }
        for item in items {
            if !seen_sources.insert(item.source_id.clone()) {
                continue;
            }
            input.candidates.push(crate::ai::ContextCandidate {
                kind: if item.personal_knowledge {
                    crate::ai::ContextSourceKind::PersonalKnowledge
                } else {
                    crate::ai::ContextSourceKind::AttachedDocument
                },
                label: item.label,
                selected: true,
                source_id: Some(item.source_id),
                content: None,
                base_hash: None,
            });
        }
    }
    Ok(input)
}

fn validate_identifier(value: &str, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || value.chars().count() > 128 {
        return Err(AppError::InvalidInput(format!("{label}无效")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{create, delete, expand_manifest_input, list};
    use crate::ai::ContextManifestInput;
    use crate::domain::context_pack::CreateContextPackInput;
    use crate::storage::Storage;

    fn storage_with_sources() -> Storage {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .create_standalone_workspace("workspace-pack", "Pack")
            .unwrap();
        storage
            .attach_workspace_file(
                "workspace-pack",
                "source-one",
                "C:\\fixtures\\one.md",
                "one.md",
            )
            .unwrap();
        storage
            .attach_workspace_file(
                "workspace-pack",
                "source-two",
                "C:\\fixtures\\two.csv",
                "two.csv",
            )
            .unwrap();
        storage
    }

    #[test]
    fn stores_only_authorized_references_and_delete_preserves_sources() {
        let storage = storage_with_sources();
        let pack = create(
            &storage,
            CreateContextPackInput {
                workspace_id: "workspace-pack".into(),
                name: "项目资料".into(),
                source_ids: vec!["source-one".into(), "source-two".into()],
            },
        )
        .unwrap();
        assert_eq!(pack.items.len(), 2);
        assert_eq!(pack.items[0].label, "one.md");
        let output = delete(&storage, "workspace-pack", &pack.id).unwrap();
        assert!(output.deleted);
        assert!(!output.original_files_deleted);
        assert!(storage
            .workspace_file_by_source("source-one")
            .unwrap()
            .is_some());
    }

    #[test]
    fn rejects_cross_workspace_sources_and_duplicate_names() {
        let storage = storage_with_sources();
        storage
            .create_standalone_workspace("workspace-other", "Other")
            .unwrap();
        let cross_workspace = create(
            &storage,
            CreateContextPackInput {
                workspace_id: "workspace-other".into(),
                name: "Wrong".into(),
                source_ids: vec!["source-one".into()],
            },
        );
        assert!(cross_workspace.is_err());
        create(
            &storage,
            CreateContextPackInput {
                workspace_id: "workspace-pack".into(),
                name: "Project".into(),
                source_ids: vec!["source-one".into()],
            },
        )
        .unwrap();
        let duplicate = create(
            &storage,
            CreateContextPackInput {
                workspace_id: "workspace-pack".into(),
                name: "project".into(),
                source_ids: vec!["source-two".into()],
            },
        );
        assert!(duplicate.is_err());
    }

    #[test]
    fn expands_pack_to_concrete_candidates_and_revocation_cleans_references() {
        let storage = storage_with_sources();
        let pack = create(
            &storage,
            CreateContextPackInput {
                workspace_id: "workspace-pack".into(),
                name: "展开".into(),
                source_ids: vec!["source-one".into(), "source-two".into()],
            },
        )
        .unwrap();
        let expanded = expand_manifest_input(
            &storage,
            ContextManifestInput {
                workspace_id: "workspace-pack".into(),
                session_id: "session".into(),
                provider_id: "provider".into(),
                prompt: "summary".into(),
                candidates: Vec::new(),
                include_recent_messages: false,
                recent_message_count: 0,
                context_pack_ids: vec![pack.id.clone()],
            },
        )
        .unwrap();
        assert_eq!(expanded.candidates.len(), 2);
        assert!(expanded
            .candidates
            .iter()
            .all(|candidate| candidate.selected));

        storage
            .revoke_workspace_file("workspace-pack", "source-one")
            .unwrap();
        let remaining = list(&storage, "workspace-pack").unwrap();
        assert_eq!(remaining[0].items.len(), 1);
        storage
            .revoke_workspace_file("workspace-pack", "source-two")
            .unwrap();
        assert!(list(&storage, "workspace-pack").unwrap().is_empty());
    }
}
