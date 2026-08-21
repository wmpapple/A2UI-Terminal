use super::retrieval::{chunk_text, rank_chunks, ContextIndex, IndexedChunk};
use super::{ContextSource, ContextSourceKind};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const FULL_CONTEXT_CHARACTERS: usize = 24_000;
const HYBRID_FULL_SOURCE_CHARACTERS: usize = 12_000;
const MAX_RETRIEVED_CHUNKS: usize = 32;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextStrategy {
    Full,
    Retrieval,
    Hybrid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceMode {
    Full,
    Retrieved,
    Excluded,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextIndexMode {
    None,
    MemoryLexical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextChunkRange {
    pub chunk_id: String,
    pub start_character: usize,
    pub end_character: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextManifestSource {
    pub kind: String,
    pub label: String,
    pub source_ref: Option<String>,
    pub content_hash: Option<String>,
    pub size_bytes: u64,
    pub character_count: usize,
    pub mode: ContextSourceMode,
    pub selected_ranges: Vec<ContextChunkRange>,
    pub exclusion_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct ResolvedTextSource {
    pub kind: ContextSourceKind,
    pub manifest_kind: String,
    pub label: String,
    pub source_id: Option<String>,
    pub content: String,
    pub content_hash: String,
    pub size_bytes: u64,
    pub base_hash: Option<String>,
}

#[derive(Debug)]
pub(super) struct SourcePlan {
    pub strategy: ContextStrategy,
    pub sources: Vec<ContextSource>,
    pub included_sources: Vec<ContextManifestSource>,
    pub excluded_sources: Vec<ContextManifestSource>,
    pub character_count: usize,
    pub retrieved_chunk_count: usize,
}

pub(super) fn plan_text_sources(
    index: &mut ContextIndex,
    workspace_id: &str,
    query: &str,
    resolved_sources: Vec<ResolvedTextSource>,
    source_token_budget: usize,
) -> SourcePlan {
    let total_characters = resolved_sources
        .iter()
        .map(|source| source.content.chars().count())
        .sum::<usize>();
    let total_tokens = resolved_sources
        .iter()
        .map(|source| estimate_tokens(&source.content))
        .sum::<usize>();
    if total_characters <= FULL_CONTEXT_CHARACTERS && total_tokens <= source_token_budget {
        let full_source_orders = (0..resolved_sources.len()).collect::<HashSet<_>>();
        return build_source_plan(
            ContextStrategy::Full,
            resolved_sources,
            full_source_orders,
            HashMap::new(),
        );
    }

    let mut remaining_tokens = source_token_budget;
    let mut full_source_orders = HashSet::new();
    for (source_order, source) in resolved_sources.iter().enumerate() {
        let count = source.content.chars().count();
        let tokens = estimate_tokens(&source.content);
        let is_priority = matches!(
            source.kind,
            ContextSourceKind::Selection | ContextSourceKind::CurrentFile
        );
        if is_priority && count <= HYBRID_FULL_SOURCE_CHARACTERS && tokens <= remaining_tokens {
            full_source_orders.insert(source_order);
            remaining_tokens = remaining_tokens.saturating_sub(tokens);
        }
    }
    let strategy = if full_source_orders.is_empty() {
        ContextStrategy::Retrieval
    } else {
        ContextStrategy::Hybrid
    };

    let documents = resolved_sources
        .iter()
        .enumerate()
        .filter(|(source_order, _)| !full_source_orders.contains(source_order))
        .map(|(source_order, source)| {
            let source_key = source
                .source_id
                .clone()
                .unwrap_or_else(|| format!("selection-{source_order}"));
            let chunks = source
                .source_id
                .as_deref()
                .map(|source_id| {
                    index.chunks(
                        workspace_id,
                        source_id,
                        &source.content_hash,
                        &source.content,
                    )
                })
                .unwrap_or_else(|| chunk_text(&source.content));
            (source_order, source_key, chunks)
        })
        .collect::<Vec<_>>();
    let mut ranked = rank_chunks(query, &documents);
    if ranked
        .first()
        .map(|chunk| chunk.score <= 0.0)
        .unwrap_or(false)
    {
        ranked.sort_by(|left, right| {
            left.chunk
                .start_character
                .cmp(&right.chunk.start_character)
                .then_with(|| left.source_order.cmp(&right.source_order))
                .then_with(|| left.source_id.cmp(&right.source_id))
        });
    }

    let mut selected_chunks = HashMap::<usize, Vec<IndexedChunk>>::new();
    let mut selected_count = 0usize;
    for ranked_chunk in ranked {
        if selected_count >= MAX_RETRIEVED_CHUNKS {
            break;
        }
        let separator_characters = if selected_chunks
            .get(&ranked_chunk.source_order)
            .map(Vec::is_empty)
            .unwrap_or(true)
        {
            0
        } else {
            2
        };
        let chunk_tokens =
            estimate_tokens(&ranked_chunk.chunk.content) + separator_characters.min(1);
        if chunk_tokens > remaining_tokens {
            continue;
        }
        remaining_tokens -= chunk_tokens;
        selected_chunks
            .entry(ranked_chunk.source_order)
            .or_default()
            .push(ranked_chunk.chunk);
        selected_count += 1;
    }

    build_source_plan(
        strategy,
        resolved_sources,
        full_source_orders,
        selected_chunks,
    )
}

pub(super) fn estimate_tokens(content: &str) -> usize {
    let (ascii, non_ascii) = content.chars().fold((0usize, 0usize), |counts, character| {
        if character.is_ascii() {
            (counts.0 + 1, counts.1)
        } else {
            (counts.0, counts.1 + 1)
        }
    });
    ascii.div_ceil(4) + non_ascii.saturating_mul(2)
}

fn build_source_plan(
    strategy: ContextStrategy,
    resolved_sources: Vec<ResolvedTextSource>,
    full_source_orders: HashSet<usize>,
    mut selected_chunks: HashMap<usize, Vec<IndexedChunk>>,
) -> SourcePlan {
    let mut plan = SourcePlan {
        strategy,
        sources: Vec::new(),
        included_sources: Vec::new(),
        excluded_sources: Vec::new(),
        character_count: 0,
        retrieved_chunk_count: 0,
    };
    for (source_order, source) in resolved_sources.into_iter().enumerate() {
        if full_source_orders.contains(&source_order) {
            let count = source.content.chars().count();
            plan.character_count += count;
            plan.included_sources.push(ContextManifestSource {
                kind: source.manifest_kind,
                label: source.label.clone(),
                source_ref: source.source_id,
                content_hash: Some(source.content_hash),
                size_bytes: source.size_bytes,
                character_count: count,
                mode: ContextSourceMode::Full,
                selected_ranges: vec![ContextChunkRange {
                    chunk_id: "full".into(),
                    start_character: 0,
                    end_character: count,
                }],
                exclusion_reason: None,
            });
            plan.sources.push(ContextSource {
                kind: source.kind,
                label: source.label,
                content: source.content,
                base_hash: source.base_hash,
            });
            continue;
        }

        let Some(mut chunks) = selected_chunks.remove(&source_order) else {
            plan.excluded_sources.push(ContextManifestSource {
                kind: source.manifest_kind,
                label: source.label,
                source_ref: source.source_id,
                content_hash: Some(source.content_hash),
                size_bytes: source.size_bytes,
                character_count: 0,
                mode: ContextSourceMode::Excluded,
                selected_ranges: Vec::new(),
                exclusion_reason: Some("没有分块进入本次输入预算；可缩小范围或调整问题".into()),
            });
            continue;
        };
        chunks.sort_by_key(|chunk| chunk.start_character);
        chunks.dedup_by(|left, right| left.id == right.id);
        let selected_ranges = chunks
            .iter()
            .map(|chunk| ContextChunkRange {
                chunk_id: chunk.id.clone(),
                start_character: chunk.start_character,
                end_character: chunk.end_character,
            })
            .collect::<Vec<_>>();
        let content = chunks
            .iter()
            .map(|chunk| chunk.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let count = content.chars().count();
        plan.character_count += count;
        plan.retrieved_chunk_count += chunks.len();
        plan.included_sources.push(ContextManifestSource {
            kind: source.manifest_kind,
            label: source.label.clone(),
            source_ref: source.source_id,
            content_hash: Some(source.content_hash),
            size_bytes: source.size_bytes,
            character_count: count,
            mode: ContextSourceMode::Retrieved,
            selected_ranges,
            exclusion_reason: None,
        });
        plan.sources.push(ContextSource {
            kind: source.kind,
            label: source.label,
            content,
            base_hash: source.base_hash,
        });
    }
    plan
}

#[cfg(test)]
mod tests {
    use super::{
        estimate_tokens, plan_text_sources, ContextSourceMode, ContextStrategy, ResolvedTextSource,
    };
    use crate::ai::{ContextIndex, ContextSourceKind};

    #[test]
    fn token_estimate_is_conservative_for_cjk_and_compact_for_ascii() {
        assert_eq!(estimate_tokens(&"中".repeat(100)), 200);
        assert_eq!(estimate_tokens(&"a".repeat(400)), 100);
    }

    #[test]
    fn selects_full_retrieval_and_hybrid_deterministically() {
        let short = ResolvedTextSource {
            kind: ContextSourceKind::CurrentFile,
            manifest_kind: "current_file".into(),
            label: "short.md".into(),
            source_id: Some("short".into()),
            content: "短文全文".repeat(100),
            content_hash: "short-hash".into(),
            size_bytes: 1_000,
            base_hash: Some("short-hash".into()),
        };
        let long_content = (0..120)
            .map(|index| {
                let relevant = if index == 91 {
                    "火星预算批准和发布安排"
                } else {
                    "普通背景材料"
                };
                format!("## 章节 {index}\n{}{relevant}\n\n", "背景内容".repeat(120))
            })
            .collect::<String>();
        let long = ResolvedTextSource {
            kind: ContextSourceKind::AttachedDocument,
            manifest_kind: "attached_document".into(),
            label: "long.md".into(),
            source_id: Some("long".into()),
            content: long_content,
            content_hash: "long-hash".into(),
            size_bytes: 100_000,
            base_hash: Some("long-hash".into()),
        };

        let full = plan_text_sources(
            &mut ContextIndex::default(),
            "workspace",
            "总结",
            vec![short.clone()],
            20_000,
        );
        assert_eq!(full.strategy, ContextStrategy::Full);
        assert_eq!(full.included_sources[0].mode, ContextSourceMode::Full);

        let retrieval = plan_text_sources(
            &mut ContextIndex::default(),
            "workspace",
            "火星预算发布",
            vec![long.clone()],
            12_000,
        );
        let repeated = plan_text_sources(
            &mut ContextIndex::default(),
            "workspace",
            "火星预算发布",
            vec![long.clone()],
            12_000,
        );
        assert_eq!(retrieval.strategy, ContextStrategy::Retrieval);
        assert!(retrieval.sources[0].content.contains("火星预算批准"));
        assert!(estimate_tokens(&retrieval.sources[0].content) <= 12_000);
        assert_eq!(
            retrieval.included_sources[0].selected_ranges,
            repeated.included_sources[0].selected_ranges
        );

        let hybrid = plan_text_sources(
            &mut ContextIndex::default(),
            "workspace",
            "火星预算发布",
            vec![short, long],
            20_000,
        );
        assert_eq!(hybrid.strategy, ContextStrategy::Hybrid);
        assert_eq!(hybrid.included_sources[0].mode, ContextSourceMode::Full);
        assert_eq!(
            hybrid.included_sources[1].mode,
            ContextSourceMode::Retrieved
        );
        assert!(
            hybrid
                .sources
                .iter()
                .map(|source| estimate_tokens(&source.content))
                .sum::<usize>()
                <= 20_000
        );
    }
}
