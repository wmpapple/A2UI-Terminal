use super::search::{
    self, SearchAuthorizedContentInput, SearchAuthorizedContentItem, SearchAuthorizedContentOutput,
};
use crate::{
    ai::{
        embedding::{normalize, EmbeddingProvider, HttpEmbeddingProvider},
        ProviderConfig,
    },
    error::AppError,
    repository::{embedding as repo, provider::ProviderRepository, search as lexical},
    state::AppState,
    storage::Storage,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

pub use crate::domain::semantic_search::EmbeddingConfig;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanInput {
    pub search: SearchAuthorizedContentInput,
    pub config: EmbeddingConfig,
    pub source_keys: Option<Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSource {
    pub key: String,
    pub title: String,
    pub fragments: usize,
    pub missing_fragments: usize,
    pub characters: usize,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub id: String,
    pub config: EmbeddingConfig,
    pub endpoint: String,
    pub query: String,
    pub sources: Vec<PlannedSource>,
    pub total_chunks: usize,
    pub missing_chunks: usize,
    pub characters: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepOutput {
    pub done: bool,
    pub completed: usize,
    pub total: usize,
    pub result: Option<SearchAuthorizedContentOutput>,
    pub fallback_reason: Option<String>,
}

pub struct Entry {
    pub created: Instant,
    pub cancelled: Arc<AtomicBool>,
    pending: tokio::sync::Mutex<Pending>,
}
struct Pending {
    input: PlanInput,
    provider: ProviderConfig,
    key: String,
    chunks: Vec<repo::Chunk>,
    metadata: BTreeMap<String, SearchAuthorizedContentItem>,
    lexical: SearchAuthorizedContentOutput,
    started: bool,
    terminal: bool,
}

pub fn config(storage: &Storage) -> Result<Option<EmbeddingConfig>, AppError> {
    repo::config(storage)
}
fn provider(storage: &Storage, config: &EmbeddingConfig) -> Result<ProviderConfig, AppError> {
    if !(1..=4096).contains(&config.dimensions)
        || config.revision.trim().is_empty()
        || config.revision.len() > 128
    {
        return Err(AppError::InvalidInput(
            "请填写模型版本和有效向量维度（1–4096）".into(),
        ));
    }
    let mut provider = ProviderRepository::new(storage)
        .find(&config.provider_id)?
        .ok_or_else(|| AppError::InvalidInput("服务配置不存在，请先到设置中配置".into()))?;
    provider.model = config.model.clone();
    provider.validate()?;
    let local = super::provider::normalized_loopback_endpoint(&provider.endpoint).is_some();
    if config.location != if local { "local" } else { "cloud" } {
        return Err(AppError::InvalidInput(
            "处理位置与服务地址不符，请重新选择本地或云端".into(),
        ));
    }
    Ok(provider)
}
fn key(config: &EmbeddingConfig, provider: &ProviderConfig) -> Result<String, AppError> {
    Ok(repo::hash(
        &serde_json::to_string(&(config, provider)).map_err(|_| AppError::StateUnavailable)?,
    ))
}
fn scope(input: &SearchAuthorizedContentInput) -> String {
    input
        .workspace_id
        .as_ref()
        .map(|w| format!("workspace:{}", w.trim()))
        .unwrap_or_else(|| "global".into())
}

pub fn plan(state: &AppState, mut input: PlanInput) -> Result<PlanView, AppError> {
    input.search.workspace_id = input.search.workspace_id.map(|w| w.trim().to_owned());
    let provider = provider(&state.storage, &input.config)?;
    let key = key(&input.config, &provider)?;
    let _guard = state
        .search_guard
        .lock()
        .map_err(|_| AppError::StateUnavailable)?;
    let (mut lexical, mut metadata) = search::semantic_snapshot(
        &state.storage,
        &state.managed_results_dir,
        input.search.clone(),
    )?;
    if let Some(keys) = &input.source_keys {
        if keys.is_empty() || keys.len() > 1000 || keys.iter().any(|k| !metadata.contains_key(k)) {
            return Err(AppError::InvalidInput("所选资料不可用，请重新规划".into()));
        }
        metadata.retain(|k, _| keys.contains(k));
    }
    lexical
        .items
        .retain(|i| metadata.contains_key(&search::item_key(i)));
    let chunks = repo::chunks(
        &state.storage,
        &scope(&input.search),
        &key,
        input.config.dimensions,
        &metadata.keys().cloned().collect::<Vec<_>>(),
    )?
    .into_iter()
    .filter(|c| metadata.contains_key(&c.key))
    .collect::<Vec<_>>();
    if chunks.is_empty() {
        return Err(AppError::InvalidInput(
            "没有可供语义搜索的资料，请先导入资料".into(),
        ));
    }
    let sources = metadata
        .iter()
        .filter_map(|(key, m)| {
            let rows = chunks.iter().filter(|c| &c.key == key).collect::<Vec<_>>();
            if rows.is_empty() {
                return None;
            }
            Some(PlannedSource {
                key: key.clone(),
                title: m.title.clone(),
                fragments: rows.len(),
                missing_fragments: rows.iter().filter(|c| c.vector.is_none()).count(),
                characters: rows
                    .iter()
                    .filter(|c| c.vector.is_none())
                    .map(|c| c.text.chars().count())
                    .sum(),
            })
        })
        .collect::<Vec<_>>();
    let view = PlanView {
        id: uuid::Uuid::new_v4().to_string(),
        config: input.config.clone(),
        endpoint: provider.endpoint.clone(),
        query: input.search.query.clone(),
        total_chunks: chunks.len(),
        missing_chunks: chunks.iter().filter(|c| c.vector.is_none()).count(),
        characters: sources.iter().map(|s| s.characters).sum::<usize>()
            + input.search.query.chars().count(),
        sources,
    };
    repo::save_config(&state.storage, &input.config)?;
    repo::register_model(&state.storage, &key, &input.config, &provider)?;
    let mut registry = state
        .semantic_searches
        .lock()
        .map_err(|_| AppError::StateUnavailable)?;
    registry.retain(|_, v| {
        if v.created.elapsed() >= Duration::from_secs(15 * 60) {
            v.cancelled.store(true, Ordering::Release);
        }
        v.created.elapsed() < Duration::from_secs(15 * 60) && !v.cancelled.load(Ordering::Acquire)
    });
    if registry.len() >= 8 {
        return Err(AppError::InvalidInput(
            "待确认搜索过多，请关闭之前的搜索窗口".into(),
        ));
    }
    registry.insert(
        view.id.clone(),
        Arc::new(Entry {
            created: Instant::now(),
            cancelled: Arc::new(AtomicBool::new(false)),
            pending: tokio::sync::Mutex::new(Pending {
                input,
                provider,
                key,
                chunks,
                metadata,
                lexical,
                started: false,
                terminal: false,
            }),
        }),
    );
    Ok(view)
}
pub fn cancel(state: &AppState, id: &str) -> Result<(), AppError> {
    if let Some(entry) = state
        .semantic_searches
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .remove(id)
    {
        entry.cancelled.store(true, Ordering::Release);
    }
    Ok(())
}

fn refresh(state: &AppState, pending: &mut Pending) -> Result<i64, AppError> {
    if key(
        &pending.input.config,
        &provider(&state.storage, &pending.input.config)?,
    )? != pending.key
    {
        return Err(AppError::InvalidInput(
            "模型配置已变化，请重新确认发送范围".into(),
        ));
    }
    let _guard = state
        .search_guard
        .lock()
        .map_err(|_| AppError::StateUnavailable)?;
    let (mut output, metadata) = search::semantic_snapshot(
        &state.storage,
        &state.managed_results_dir,
        pending.input.search.clone(),
    )?;
    let current = repo::chunks(
        &state.storage,
        &scope(&pending.input.search),
        &pending.key,
        pending.input.config.dimensions,
        &pending.metadata.keys().cloned().collect::<Vec<_>>(),
    )?;
    let current = current
        .iter()
        .map(|c| (c.id, c.hash.as_str()))
        .collect::<BTreeMap<_, _>>();
    if pending
        .chunks
        .iter()
        .any(|c| !metadata.contains_key(&c.key) || current.get(&c.id) != Some(&c.hash.as_str()))
    {
        return Err(AppError::FileConflict);
    }
    let keys = pending.metadata.keys().cloned().collect::<Vec<_>>();
    output.items = lexical::query_selected(
        &state.storage,
        &scope(&pending.input.search),
        &pending.input.search.query,
        50,
        Some(&keys),
    )?
    .into_iter()
    .filter_map(|hit| {
        let mut item = pending.metadata.get(&hit.key)?.clone();
        item.snippet = hit.content.chars().take(220).collect();
        item.score = hit.score;
        Some(item)
    })
    .collect();
    pending.lexical = output;
    lexical::generation(&state.storage)
}

pub async fn step(state: &AppState, id: &str, confirmed: bool) -> Result<StepOutput, AppError> {
    step_with_provider(state, id, confirmed, &HttpEmbeddingProvider::default()).await
}

pub async fn step_with_provider<P: EmbeddingProvider>(
    state: &AppState,
    id: &str,
    confirmed: bool,
    adapter: &P,
) -> Result<StepOutput, AppError> {
    let entry = state
        .semantic_searches
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::InvalidInput("发送计划已失效，请重新规划".into()))?;
    let mut p = entry
        .pending
        .try_lock()
        .map_err(|_| AppError::InvalidInput("搜索正在处理，请勿重复发送".into()))?;
    if entry.created.elapsed() > Duration::from_secs(15 * 60)
        || entry.cancelled.load(Ordering::Acquire)
        || p.terminal
    {
        return Err(AppError::RequestCancelled);
    }
    if !confirmed && !p.started {
        return Err(AppError::InvalidInput("请先确认语义检索发送范围".into()));
    }
    p.started = true;
    refresh(state, &mut p)?;
    let missing = p
        .chunks
        .iter()
        .filter(|c| c.vector.is_none())
        .take(8)
        .cloned()
        .collect::<Vec<_>>();
    let texts = if missing.is_empty() {
        vec![p.input.search.query.clone()]
    } else {
        missing.iter().map(|c| c.text.clone()).collect()
    };
    let returned = adapter
        .embed(
            &p.provider,
            &texts,
            p.input.config.dimensions,
            entry.cancelled.clone(),
        )
        .await;
    if entry.cancelled.load(Ordering::Acquire) {
        return Err(AppError::RequestCancelled);
    }
    let generation = refresh(state, &mut p)?;
    let vectors = returned.and_then(|v| {
        if v.len() != texts.len() {
            return Err(AppError::InvalidInput("向量数量不匹配".into()));
        }
        v.into_iter()
            .map(|v| normalize(v, p.input.config.dimensions))
            .collect::<Result<Vec<_>, _>>()
    });
    let output = match vectors {
        Ok(vectors) if !missing.is_empty() => {
            repo::store(&state.storage, &p.key, &missing, &vectors, generation)?;
            for (c, v) in missing.iter().zip(vectors) {
                if let Some(chunk) = p.chunks.iter_mut().find(|x| x.id == c.id) {
                    chunk.vector = Some(v);
                }
            }
            Ok(StepOutput {
                done: false,
                completed: p.chunks.iter().filter(|c| c.vector.is_some()).count(),
                total: p.chunks.len(),
                result: None,
                fallback_reason: None,
            })
        }
        Ok(vectors) => {
            let ranked = rank(&p.chunks, &vectors[0], &p.lexical.items);
            let mut result = p.lexical.clone();
            result.items = ranked
                .into_iter()
                .take(p.input.search.limit.unwrap_or(20))
                .filter_map(|(key, text, score)| {
                    let mut item = p.metadata.get(&key)?.clone();
                    item.snippet = text.chars().take(220).collect();
                    item.score = score;
                    Some(item)
                })
                .collect();
            result.index_mode = "hybrid".into();
            result.indexed_documents = p.metadata.len();
            p.terminal = true;
            Ok(StepOutput {
                done: true,
                completed: p.chunks.len(),
                total: p.chunks.len(),
                result: Some(result),
                fallback_reason: None,
            })
        }
        Err(error) => {
            p.terminal = true;
            let limit = p.input.search.limit.unwrap_or(20);
            p.lexical.items.truncate(limit);
            p.lexical.indexed_documents = p.metadata.len();
            Ok(StepOutput {
                done: true,
                completed: p.chunks.iter().filter(|c| c.vector.is_some()).count(),
                total: p.chunks.len(),
                result: Some(p.lexical.clone()),
                fallback_reason: Some(format!(
                    "{}；已返回关键词搜索结果。",
                    error.public_message()
                )),
            })
        }
    };
    if output.as_ref().is_ok_and(|v| v.done) {
        state
            .semantic_searches
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .remove(id);
    }
    output
}

// Reciprocal rank fusion; stable document deduplication occurs before fusion.
fn rank(
    chunks: &[repo::Chunk],
    query: &[f32],
    lexical: &[SearchAuthorizedContentItem],
) -> Vec<(String, String, f64)> {
    let mut semantic = BTreeMap::<String, (f64, String)>::new();
    for chunk in chunks {
        if let Some(vector) = &chunk.vector {
            let score = vector
                .iter()
                .zip(query)
                .map(|(a, b)| f64::from(*a) * f64::from(*b))
                .sum::<f64>();
            if score <= 0.0 {
                continue;
            }
            let entry = semantic
                .entry(chunk.key.clone())
                .or_insert((f64::NEG_INFINITY, String::new()));
            if score > entry.0 {
                *entry = (score, chunk.text.clone());
            }
        }
    }
    let mut semantic = semantic.into_iter().collect::<Vec<_>>();
    semantic.sort_by(|a, b| b.1 .0.total_cmp(&a.1 .0).then_with(|| a.0.cmp(&b.0)));
    let mut combined = BTreeMap::<String, (f64, String)>::new();
    for (position, (key, (_, text))) in semantic.into_iter().take(50).enumerate() {
        combined.insert(key, (1.0 / (60.0 + position as f64 + 1.0), text));
    }
    for (position, item) in lexical.iter().enumerate() {
        let value = combined
            .entry(search::item_key(item))
            .or_insert((0.0, item.snippet.clone()));
        value.0 += 1.0 / (60.0 + position as f64 + 1.0);
    }
    let mut ranked = combined
        .into_iter()
        .map(|(key, (score, text))| (key, text, score))
        .collect::<Vec<_>>();
    ranked.sort_by(|a, b| b.2.total_cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    ranked
}
