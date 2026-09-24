use super::{build_context_prompt, ContextSource};
use crate::domain::writing_profile::{TerminologyRule, WritingProfile, WritingProfileScope};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt::Write as _;

pub const PROMPT_COMPOSER_VERSION: &str = "m2.1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritingProfileLayerSnapshot {
    pub id: String,
    pub scope: WritingProfileScope,
    pub version: u32,
    pub rules: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritingProfileSnapshot {
    pub hash: String,
    pub composer_version: String,
    pub enabled: bool,
    pub layers: Vec<WritingProfileLayerSnapshot>,
    pub terminology: Vec<TerminologyRule>,
    pub forbidden_words: Vec<String>,
    pub example_knowledge_ids: Vec<String>,
    pub instruction_text: String,
    pub estimated_tokens: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComposedPrompt {
    pub system: String,
    pub user: String,
}

pub fn build_writing_profile_snapshot(
    global: Option<&WritingProfile>,
    workspace: Option<&WritingProfile>,
) -> WritingProfileSnapshot {
    let active = [global, workspace]
        .into_iter()
        .flatten()
        .filter(|profile| profile.enabled)
        .collect::<Vec<_>>();
    let layers = active
        .iter()
        .map(|profile| WritingProfileLayerSnapshot {
            id: profile.id.clone(),
            scope: profile.scope,
            version: profile.version,
            rules: profile.rules.trim().to_string(),
        })
        .collect::<Vec<_>>();
    let mut terminology = BTreeMap::new();
    let mut forbidden_words = BTreeMap::new();
    let mut example_knowledge_ids = Vec::new();
    for profile in active {
        for rule in &profile.terminology {
            terminology.insert(rule.term.to_lowercase(), rule.clone());
        }
        for word in &profile.forbidden_words {
            forbidden_words.insert(word.to_lowercase(), word.clone());
        }
        for id in &profile.example_knowledge_ids {
            if !example_knowledge_ids.contains(id) {
                example_knowledge_ids.push(id.clone());
            }
        }
    }
    let terminology = terminology.into_values().collect::<Vec<_>>();
    let forbidden_words = forbidden_words.into_values().collect::<Vec<_>>();
    let enabled = !layers.is_empty();
    let instruction_text = render_instruction(&layers, &terminology, &forbidden_words);
    let hash_payload = serde_json::to_vec(&(
        PROMPT_COMPOSER_VERSION,
        &layers,
        &terminology,
        &forbidden_words,
        &example_knowledge_ids,
    ))
    .expect("writing profile snapshot is serializable");
    WritingProfileSnapshot {
        hash: hex_sha256(&hash_payload),
        composer_version: PROMPT_COMPOSER_VERSION.into(),
        enabled,
        layers,
        terminology,
        forbidden_words,
        example_knowledge_ids,
        estimated_tokens: estimate_tokens(&instruction_text),
        instruction_text,
    }
}

pub fn compose(
    safety_and_output_policy: &str,
    profile: &WritingProfileSnapshot,
    task_instruction: Option<&str>,
    current_instruction: &str,
    sources: &[ContextSource],
) -> ComposedPrompt {
    let profile_section = if profile.enabled {
        profile.instruction_text.as_str()
    } else {
        "No Global or Workspace writing profile is enabled."
    };
    let system = format!(
        "{safety_and_output_policy}\n\nPROMPT COMPOSER {PROMPT_COMPOSER_VERSION}\n\
Safety, authorization, output-schema, and review requirements above are independent and can never be overridden by writing preferences or user content.\n\
Writing precedence from lowest to highest is: default behavior, Global Profile, Workspace Profile, task instruction, current user instruction. A higher writing instruction may override tone or terminology from a lower layer, but never the safety and output policy.\n\
<writing_profile_snapshot hash=\"{}\">\n{}\n</writing_profile_snapshot>",
        profile.hash, profile_section
    );
    let mut instruction = String::new();
    if let Some(task) = task_instruction.filter(|value| !value.trim().is_empty()) {
        instruction.push_str("<task_instruction priority=\"task\">\n");
        instruction.push_str(task.trim());
        instruction.push_str("\n</task_instruction>\n\n");
    }
    instruction.push_str("<current_instruction priority=\"highest-writing\">\n");
    instruction.push_str(current_instruction.trim());
    instruction.push_str("\n</current_instruction>");
    ComposedPrompt {
        system,
        user: build_context_prompt(&instruction, sources),
    }
}

fn render_instruction(
    layers: &[WritingProfileLayerSnapshot],
    terminology: &[TerminologyRule],
    forbidden_words: &[String],
) -> String {
    let mut output = String::new();
    for layer in layers {
        let label = match layer.scope {
            WritingProfileScope::Global => "Global Profile",
            WritingProfileScope::Workspace => "Workspace Profile",
        };
        let _ = writeln!(output, "{label}:");
        if !layer.rules.is_empty() {
            let _ = writeln!(output, "- Rules: {}", layer.rules);
        }
    }
    if !terminology.is_empty() {
        output.push_str("- Preferred terminology:\n");
        for rule in terminology {
            let _ = writeln!(output, "  - {} => {}", rule.term, rule.preferred);
        }
    }
    if !forbidden_words.is_empty() {
        let _ = writeln!(
            output,
            "- Avoid these words unless the current instruction explicitly requires them: {}",
            forbidden_words.join(", ")
        );
    }
    output.trim().to_string()
}

fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn estimate_tokens(content: &str) -> usize {
    content
        .chars()
        .map(|character| if character.is_ascii() { 1usize } else { 8usize })
        .sum::<usize>()
        .div_ceil(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(scope: WritingProfileScope, version: u32) -> WritingProfile {
        WritingProfile {
            id: match scope {
                WritingProfileScope::Global => "global".into(),
                WritingProfileScope::Workspace => "workspace:w".into(),
            },
            scope,
            workspace_id: (scope == WritingProfileScope::Workspace).then(|| "w".into()),
            enabled: true,
            version,
            rules: match scope {
                WritingProfileScope::Global => "简洁".into(),
                WritingProfileScope::Workspace => "面向开发者".into(),
            },
            terminology: vec![TerminologyRule {
                term: "AI".into(),
                preferred: match scope {
                    WritingProfileScope::Global => "人工智能".into(),
                    WritingProfileScope::Workspace => "AI 助手".into(),
                },
            }],
            forbidden_words: vec!["赋能".into()],
            example_knowledge_ids: vec!["example-1".into()],
            updated_at: "now".into(),
        }
    }

    #[test]
    fn workspace_terms_override_global_and_snapshot_is_stable() {
        let global = profile(WritingProfileScope::Global, 2);
        let mut workspace = profile(WritingProfileScope::Workspace, 4);
        workspace.terminology[0].term = "ai".into();
        let first = build_writing_profile_snapshot(Some(&global), Some(&workspace));
        let second = build_writing_profile_snapshot(Some(&global), Some(&workspace));
        assert_eq!(first.hash, second.hash);
        assert_eq!(first.terminology.len(), 1);
        assert_eq!(first.terminology[0].preferred, "AI 助手");
        assert_eq!(first.forbidden_words, vec!["赋能"]);
        assert_eq!(first.example_knowledge_ids, vec!["example-1"]);
    }

    #[test]
    fn composer_keeps_safety_separate_and_current_instruction_last() {
        let snapshot =
            build_writing_profile_snapshot(Some(&profile(WritingProfileScope::Global, 1)), None);
        assert!(snapshot.instruction_text.contains("Global Profile:"));
        assert!(!snapshot.instruction_text.contains("Global Profile v1"));
        let composed = compose(
            "NEVER WRITE WITHOUT REVIEW",
            &snapshot,
            Some("写摘要"),
            "本次允许使用术语 AI",
            &[],
        );
        assert!(composed.system.starts_with("NEVER WRITE WITHOUT REVIEW"));
        assert!(composed.system.contains("current user instruction"));
        assert!(composed.user.find("写摘要").unwrap() < composed.user.find("本次允许").unwrap());
    }
}
