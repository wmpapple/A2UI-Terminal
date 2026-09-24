use crate::ai::{build_writing_profile_snapshot, WritingProfileSnapshot};
use crate::domain::writing_profile::{
    DeleteWritingProfileInput, SaveWritingProfileInput, TerminologyRule, WritingProfile,
    WritingProfileScope,
};
use crate::error::AppError;
use crate::repository::writing_profile::WritingProfileRepository;
use crate::storage::Storage;
use serde::Serialize;
use std::collections::HashSet;

const MAX_RULE_CHARACTERS: usize = 12_000;
const MAX_TERMS: usize = 50;
const MAX_FORBIDDEN_WORDS: usize = 50;
const MAX_EXAMPLES: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingProfileBundle {
    pub global: WritingProfile,
    pub workspace: Option<WritingProfile>,
    pub effective: WritingProfileSnapshot,
}

pub fn get(
    storage: &Storage,
    workspace_id: Option<&str>,
) -> Result<WritingProfileBundle, AppError> {
    if let Some(id) = workspace_id {
        validate_workspace(storage, id)?;
    }
    let repository = WritingProfileRepository::new(storage);
    let global = repository
        .find(WritingProfileScope::Global, None)?
        .unwrap_or_else(default_global);
    let workspace = workspace_id
        .map(|id| repository.find(WritingProfileScope::Workspace, Some(id)))
        .transpose()?
        .flatten();
    let effective = build_writing_profile_snapshot(Some(&global), workspace.as_ref());
    Ok(WritingProfileBundle {
        global,
        workspace,
        effective,
    })
}

pub fn resolve(storage: &Storage, workspace_id: &str) -> Result<WritingProfileSnapshot, AppError> {
    Ok(get(storage, Some(workspace_id))?.effective)
}

pub fn save(
    storage: &Storage,
    mut input: SaveWritingProfileInput,
) -> Result<WritingProfileBundle, AppError> {
    normalize_and_validate(storage, &mut input)?;
    let workspace_id = input.workspace_id.clone();
    WritingProfileRepository::new(storage).save(&input)?;
    get(storage, workspace_id.as_deref())
}

pub fn delete(
    storage: &Storage,
    input: DeleteWritingProfileInput,
) -> Result<WritingProfileBundle, AppError> {
    validate_scope(input.scope, input.workspace_id.as_deref())?;
    if let Some(id) = input.workspace_id.as_deref() {
        validate_workspace(storage, id)?;
    }
    WritingProfileRepository::new(storage).delete(input.scope, input.workspace_id.as_deref())?;
    get(storage, input.workspace_id.as_deref())
}

fn normalize_and_validate(
    storage: &Storage,
    input: &mut SaveWritingProfileInput,
) -> Result<(), AppError> {
    validate_scope(input.scope, input.workspace_id.as_deref())?;
    if let Some(id) = input.workspace_id.as_deref() {
        validate_workspace(storage, id)?;
    }
    input.rules = input.rules.trim().to_string();
    if input.rules.chars().count() > MAX_RULE_CHARACTERS {
        return Err(AppError::InvalidInput("写作规则最多 12000 字".into()));
    }
    if input.terminology.len() > MAX_TERMS {
        return Err(AppError::InvalidInput("术语规则最多 50 条".into()));
    }
    let mut terms = HashSet::new();
    for TerminologyRule { term, preferred } in &mut input.terminology {
        *term = term.trim().to_string();
        *preferred = preferred.trim().to_string();
        if term.is_empty()
            || preferred.is_empty()
            || term.chars().count() > 80
            || preferred.chars().count() > 120
            || !terms.insert(term.to_lowercase())
        {
            return Err(AppError::InvalidInput(
                "术语必须唯一且名称不超过 80 字、推荐写法不超过 120 字".into(),
            ));
        }
    }
    if input.forbidden_words.len() > MAX_FORBIDDEN_WORDS {
        return Err(AppError::InvalidInput("禁用词最多 50 个".into()));
    }
    let mut forbidden = HashSet::new();
    for word in &mut input.forbidden_words {
        *word = word.trim().to_string();
        if word.is_empty() || word.chars().count() > 80 || !forbidden.insert(word.to_lowercase()) {
            return Err(AppError::InvalidInput(
                "禁用词必须唯一且每项不超过 80 字".into(),
            ));
        }
    }
    if input.example_knowledge_ids.len() > MAX_EXAMPLES {
        return Err(AppError::InvalidInput("范文引用最多 10 项".into()));
    }
    let mut examples = HashSet::new();
    if input
        .example_knowledge_ids
        .iter()
        .any(|id| id.trim().is_empty() || id.len() > 128 || !examples.insert(id.clone()))
    {
        return Err(AppError::InvalidInput("范文引用无效或重复".into()));
    }
    Ok(())
}

fn validate_scope(scope: WritingProfileScope, workspace_id: Option<&str>) -> Result<(), AppError> {
    match (scope, workspace_id) {
        (WritingProfileScope::Global, None) => Ok(()),
        (WritingProfileScope::Workspace, Some(id)) if !id.trim().is_empty() => Ok(()),
        (WritingProfileScope::Workspace, Some(_)) => Err(AppError::InvalidInput(
            "Workspace Profile 需要有效工作区".into(),
        )),
        (WritingProfileScope::Global, Some(_)) => Err(AppError::InvalidInput(
            "Global Profile 不能绑定工作区".into(),
        )),
        (WritingProfileScope::Workspace, None) => Err(AppError::InvalidInput(
            "Workspace Profile 需要有效工作区".into(),
        )),
    }
}

fn validate_workspace(storage: &Storage, workspace_id: &str) -> Result<(), AppError> {
    if workspace_id.len() > 128 || storage.workspace(workspace_id)?.is_none() {
        return Err(AppError::InvalidInput("工作区不存在".into()));
    }
    Ok(())
}

fn default_global() -> WritingProfile {
    WritingProfile {
        id: "global".into(),
        scope: WritingProfileScope::Global,
        workspace_id: None,
        enabled: false,
        version: 0,
        rules: String::new(),
        terminology: Vec::new(),
        forbidden_words: Vec::new(),
        example_knowledge_ids: Vec::new(),
        updated_at: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn storage() -> Storage {
        let directory = tempdir().unwrap().keep();
        Storage::open(&directory.join("profiles.sqlite3")).unwrap()
    }

    #[test]
    fn global_and_workspace_profiles_merge_with_workspace_terminology_winning() {
        let storage = storage();
        storage
            .upsert_workspace("w", "Workspace", "C:\\profiles")
            .unwrap();
        save(
            &storage,
            SaveWritingProfileInput {
                scope: WritingProfileScope::Global,
                workspace_id: None,
                enabled: true,
                rules: "简洁".into(),
                terminology: vec![TerminologyRule {
                    term: "AI".into(),
                    preferred: "人工智能".into(),
                }],
                forbidden_words: vec!["赋能".into()],
                example_knowledge_ids: vec![],
            },
        )
        .unwrap();
        let bundle = save(
            &storage,
            SaveWritingProfileInput {
                scope: WritingProfileScope::Workspace,
                workspace_id: Some("w".into()),
                enabled: true,
                rules: "面向开发者".into(),
                terminology: vec![TerminologyRule {
                    term: "AI".into(),
                    preferred: "AI 助手".into(),
                }],
                forbidden_words: vec![],
                example_knowledge_ids: vec![],
            },
        )
        .unwrap();
        assert_eq!(bundle.effective.layers.len(), 2);
        assert_eq!(bundle.effective.terminology[0].preferred, "AI 助手");
        assert!(bundle.effective.instruction_text.contains("简洁"));
        assert!(bundle.effective.instruction_text.contains("面向开发者"));
    }

    #[test]
    fn deleting_workspace_profile_does_not_change_global() {
        let storage = storage();
        storage
            .upsert_workspace("w", "Workspace", "C:\\profiles")
            .unwrap();
        let before = get(&storage, Some("w")).unwrap().global.version;
        let output = delete(
            &storage,
            DeleteWritingProfileInput {
                scope: WritingProfileScope::Workspace,
                workspace_id: Some("w".into()),
            },
        )
        .unwrap();
        assert!(output.workspace.is_none());
        assert_eq!(output.global.version, before);
    }

    #[test]
    fn profiles_survive_restart_and_clear_all_restores_the_disabled_global_default() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("profiles.sqlite3");
        {
            let storage = Storage::open(&database).unwrap();
            save(
                &storage,
                SaveWritingProfileInput {
                    scope: WritingProfileScope::Global,
                    workspace_id: None,
                    enabled: true,
                    rules: "重启后保留".into(),
                    terminology: vec![],
                    forbidden_words: vec![],
                    example_knowledge_ids: vec![],
                },
            )
            .unwrap();
        }

        let storage = Storage::open(&database).unwrap();
        let reopened = get(&storage, None).unwrap();
        assert!(reopened.global.enabled);
        assert_eq!(reopened.global.rules, "重启后保留");
        assert!(reopened.effective.enabled);

        storage.clear_all().unwrap();
        let cleared = get(&storage, None).unwrap();
        assert!(!cleared.global.enabled);
        assert_eq!(cleared.global.version, 1);
        assert!(cleared.global.rules.is_empty());
        assert!(!cleared.effective.enabled);
    }

    #[test]
    fn removing_a_workspace_cascades_only_its_profile() {
        let storage = storage();
        storage
            .upsert_workspace("w", "Workspace", "C:\\profiles")
            .unwrap();
        save(
            &storage,
            SaveWritingProfileInput {
                scope: WritingProfileScope::Global,
                workspace_id: None,
                enabled: true,
                rules: "全局保留".into(),
                terminology: vec![],
                forbidden_words: vec![],
                example_knowledge_ids: vec![],
            },
        )
        .unwrap();
        save(
            &storage,
            SaveWritingProfileInput {
                scope: WritingProfileScope::Workspace,
                workspace_id: Some("w".into()),
                enabled: true,
                rules: "工作区覆盖".into(),
                terminology: vec![],
                forbidden_words: vec![],
                example_knowledge_ids: vec![],
            },
        )
        .unwrap();

        assert!(storage.remove_workspace("w").unwrap());
        assert!(WritingProfileRepository::new(&storage)
            .find(WritingProfileScope::Workspace, Some("w"))
            .unwrap()
            .is_none());
        let global = get(&storage, None).unwrap().global;
        assert!(global.enabled);
        assert_eq!(global.rules, "全局保留");
    }
}
