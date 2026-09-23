use crate::ai::{rank_chunks, ContextIndex};
use crate::document_source::{self, DocumentSourceContent, DocumentSourceKind};
use crate::error::AppError;
use crate::security::{is_hidden_path, is_sensitive_path};
use crate::storage::Storage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::Path;

const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 50;
const MAX_QUERY_CHARACTERS: usize = 200;
const MAX_INDEXED_CHARACTERS_PER_DOCUMENT: usize = 2_000_000;
const MAX_SNIPPET_CHARACTERS: usize = 220;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchAuthorizedContentInput {
    pub workspace_id: Option<String>,
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchItemKind {
    Result,
    DocumentSource,
    ContextPack,
    PersonalKnowledge,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchAuthorizedContentItem {
    pub id: String,
    pub kind: SearchItemKind,
    pub title: String,
    pub snippet: String,
    pub updated_at: Option<String>,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchAuthorizedContentOutput {
    pub query: String,
    pub items: Vec<SearchAuthorizedContentItem>,
    pub indexed_documents: usize,
    pub skipped_documents: usize,
    pub index_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RebuildAuthorizedSearchIndexOutput {
    pub cleared_documents: usize,
    pub result_data_changed: bool,
}

#[derive(Debug)]
struct SearchDocument {
    id: String,
    kind: SearchItemKind,
    title: String,
    content: String,
    content_hash: String,
    updated_at: Option<String>,
}

pub fn search(
    storage: &Storage,
    managed_results_dir: &Path,
    index: &mut ContextIndex,
    input: SearchAuthorizedContentInput,
) -> Result<SearchAuthorizedContentOutput, AppError> {
    let query = input.query.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARACTERS {
        return Err(AppError::InvalidInput(
            "搜索内容不能为空且不能超过 200 个字符".into(),
        ));
    }
    let limit = input.limit.unwrap_or(DEFAULT_LIMIT);
    if limit == 0 || limit > MAX_LIMIT {
        return Err(AppError::InvalidInput(
            "搜索结果数量必须在 1 到 50 之间".into(),
        ));
    }
    let workspace_id = input
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if input.workspace_id.is_some() && workspace_id.is_none() {
        return Err(AppError::InvalidInput("工作区标识无效".into()));
    }
    if let Some(workspace_id) = workspace_id {
        if workspace_id.chars().count() > 128 || storage.workspace(workspace_id)?.is_none() {
            return Err(AppError::InvalidInput("工作区不存在或标识无效".into()));
        }
    }

    let (documents, skipped_documents) =
        collect_documents(storage, managed_results_dir, workspace_id)?;
    let scope = format!("authorized-search:{}", workspace_id.unwrap_or("global"));
    index.retain_workspace(&scope);
    let mut indexed = Vec::with_capacity(documents.len());
    let mut allowed_ids = BTreeSet::new();
    let metadata = documents
        .into_iter()
        .enumerate()
        .map(|(order, document)| {
            let source_id = format!("{}:{}", kind_key(document.kind), document.id);
            allowed_ids.insert(source_id.clone());
            let chunks = index.chunks(
                &scope,
                &source_id,
                &document.content_hash,
                &document.content,
            );
            indexed.push((order, source_id.clone(), chunks));
            (source_id, document)
        })
        .collect::<BTreeMap<_, _>>();
    index.retain_sources(&scope, &allowed_ids);

    let mut best_by_document = BTreeMap::new();
    for ranked in rank_chunks(query, &indexed)
        .into_iter()
        .filter(|item| item.score > 0.0)
    {
        best_by_document
            .entry(ranked.source_id.clone())
            .or_insert(ranked);
    }
    let mut items = best_by_document
        .into_iter()
        .filter_map(|(source_id, ranked)| {
            let document = metadata.get(&source_id)?;
            Some(SearchAuthorizedContentItem {
                id: document.id.clone(),
                kind: document.kind,
                title: document.title.clone(),
                snippet: snippet(&ranked.chunk.content, query, &document.title),
                updated_at: document.updated_at.clone(),
                score: ranked.score,
            })
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.id.cmp(&right.id))
    });
    items.truncate(limit);

    Ok(SearchAuthorizedContentOutput {
        query: query.to_string(),
        items,
        indexed_documents: metadata.len(),
        skipped_documents,
        index_mode: "memory_lexical".into(),
    })
}

pub fn rebuild(index: &mut ContextIndex) -> RebuildAuthorizedSearchIndexOutput {
    RebuildAuthorizedSearchIndexOutput {
        cleared_documents: index.clear(),
        result_data_changed: false,
    }
}

fn collect_documents(
    storage: &Storage,
    managed_results_dir: &Path,
    workspace_id: Option<&str>,
) -> Result<(Vec<SearchDocument>, usize), AppError> {
    let mut documents = Vec::new();
    let mut skipped = 0;

    for summary in crate::application::result::list(storage, None, false)? {
        let Some(source) = storage.result_source(&summary.id)? else {
            skipped += 1;
            continue;
        };
        if source.source_kind == "workspace_file" && excluded_path(Path::new(&source.source_ref)) {
            skipped += 1;
            continue;
        }
        let Ok(document) =
            crate::application::result::read_document(storage, managed_results_dir, &summary.id)
        else {
            skipped += 1;
            continue;
        };
        let body = cap_characters(&document.content);
        documents.push(SearchDocument {
            id: summary.id,
            kind: SearchItemKind::Result,
            title: summary.title.clone(),
            content: format!("{}\n{}", summary.title, body),
            content_hash: document.content_hash,
            updated_at: Some(summary.updated_at),
        });
    }

    let mut after = None;
    loop {
        let page = crate::repository::knowledge::list(
            storage,
            crate::domain::knowledge::ListKnowledgeInput {
                after,
                limit: Some(100),
                query: None,
            },
        )?;
        for source in page.items {
            if source.status != "ready" {
                continue;
            }
            let document = crate::repository::knowledge::get(storage, &source.id)?;
            let content = format!(
                "{}\n{}\n{}",
                source.title,
                source.tags.join(" "),
                document.parsed.text()
            );
            documents.push(SearchDocument {
                id: source.id,
                kind: SearchItemKind::PersonalKnowledge,
                title: source.title,
                content_hash: sha256(content.as_bytes()),
                content,
                updated_at: Some(source.updated_at),
            });
        }
        after = page.next_cursor;
        if after.is_none() {
            break;
        }
    }
    if let Some(workspace_id) = workspace_id {
        for row in storage.workspace_files(workspace_id)? {
            if excluded_path(Path::new(&row.absolute_path))
                || excluded_path(Path::new(&row.virtual_path))
            {
                skipped += 1;
                continue;
            }
            let Ok(content) = document_source::read(storage, &row.source_id) else {
                skipped += 1;
                continue;
            };
            let text = searchable_source_text(&content);
            documents.push(SearchDocument {
                id: content.source.id.clone(),
                kind: SearchItemKind::DocumentSource,
                title: content.source.name.clone(),
                content: format!("{}\n{}", content.source.name, text),
                content_hash: content.source.content_hash,
                updated_at: None,
            });
        }

        for pack in crate::application::context_pack::list(storage, workspace_id)? {
            let labels = pack
                .items
                .iter()
                .map(|item| item.label.as_str())
                .filter(|label| !excluded_path(Path::new(label)))
                .collect::<Vec<_>>();
            let content = format!("{}\n{}", pack.name, labels.join("\n"));
            documents.push(SearchDocument {
                id: pack.id.clone(),
                kind: SearchItemKind::ContextPack,
                title: pack.name.clone(),
                content_hash: sha256(content.as_bytes()),
                content,
                updated_at: Some(pack.updated_at),
            });
        }
    }
    Ok((documents, skipped))
}

fn searchable_source_text(content: &DocumentSourceContent) -> String {
    match content.source.kind {
        DocumentSourceKind::Text => cap_characters(content.text_content.as_deref().unwrap_or("")),
        DocumentSourceKind::Table => {
            let mut output = String::new();
            if let Some(table) = &content.table_content {
                'sheets: for sheet in &table.sheets {
                    let _ = writeln!(output, "{}", sheet.name);
                    for row in &sheet.rows {
                        let _ = writeln!(
                            output,
                            "{}",
                            row.iter()
                                .map(|cell| cell.value.as_str())
                                .collect::<Vec<_>>()
                                .join("\t")
                        );
                        if output.chars().count() >= MAX_INDEXED_CHARACTERS_PER_DOCUMENT {
                            break 'sheets;
                        }
                    }
                }
            }
            cap_characters(&output)
        }
        DocumentSourceKind::Image => String::new(),
    }
}

fn excluded_path(path: &Path) -> bool {
    is_sensitive_path(path) || is_hidden_path(path)
}

fn cap_characters(value: &str) -> String {
    value
        .chars()
        .take(MAX_INDEXED_CHARACTERS_PER_DOCUMENT)
        .collect()
}

fn snippet(content: &str, query: &str, fallback: &str) -> String {
    let normalized = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return fallback.chars().take(MAX_SNIPPET_CHARACTERS).collect();
    }
    let lower = normalized.to_lowercase();
    let query = query.to_lowercase();
    let start_byte = lower.find(&query).unwrap_or(0);
    let start_character = lower[..start_byte].chars().count().saturating_sub(45);
    let snippet = normalized
        .chars()
        .skip(start_character)
        .take(MAX_SNIPPET_CHARACTERS)
        .collect::<String>();
    if start_character > 0 {
        format!("…{snippet}")
    } else {
        snippet
    }
}

fn kind_key(kind: SearchItemKind) -> &'static str {
    match kind {
        SearchItemKind::Result => "result",
        SearchItemKind::DocumentSource => "source",
        SearchItemKind::ContextPack => "pack",
        SearchItemKind::PersonalKnowledge => "knowledge",
    }
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::{rebuild, search, SearchAuthorizedContentInput, SearchItemKind};
    use crate::ai::ContextIndex;
    use crate::application::{context_pack, result};
    use crate::domain::context_pack::CreateContextPackInput;
    use crate::domain::result::{CreateTextResultInput, SaveResultDocumentInput, TextResultFormat};
    use crate::storage::Storage;
    use std::fs;

    #[test]
    fn searches_results_authorized_sources_and_pack_metadata_without_sensitive_paths() {
        let directory = tempfile::tempdir().unwrap();
        let managed = result::prepare_managed_results_dir(directory.path()).unwrap();
        let source_path = directory.path().join("meeting.md");
        let sensitive_path = directory.path().join("credentials.json");
        fs::write(&source_path, "发布蓝图和客户反馈").unwrap();
        fs::write(&sensitive_path, "TOPSECRET credential").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        storage
            .create_standalone_workspace("workspace-search", "Search")
            .unwrap();
        storage
            .attach_workspace_file(
                "workspace-search",
                "source-meeting",
                source_path.to_str().unwrap(),
                "meeting.md",
            )
            .unwrap();
        storage
            .attach_workspace_file(
                "workspace-search",
                "source-sensitive",
                sensitive_path.to_str().unwrap(),
                "credentials.json",
            )
            .unwrap();
        let pack = context_pack::create(
            &storage,
            CreateContextPackInput {
                workspace_id: "workspace-search".into(),
                name: "发布资料包".into(),
                source_ids: vec!["source-meeting".into()],
            },
        )
        .unwrap();
        let created = result::create_text(
            &storage,
            &managed,
            CreateTextResultInput {
                title: "季度规划".into(),
                file_name: "quarter.md".into(),
                result_type: Default::default(),
                format: TextResultFormat::Markdown,
            },
        )
        .unwrap();
        result::save_document(
            &storage,
            &managed,
            SaveResultDocumentInput {
                result_id: created.result.summary.id.clone(),
                content: "# 季度规划\n\n确定北极星目标".into(),
                base_hash: created.content_hash,
            },
        )
        .unwrap();
        let mut index = ContextIndex::default();

        let result_hit = search(
            &storage,
            &managed,
            &mut index,
            input("workspace-search", "北极星"),
        )
        .unwrap();
        assert_eq!(result_hit.items[0].kind, SearchItemKind::Result);

        let source_hit = search(
            &storage,
            &managed,
            &mut index,
            input("workspace-search", "客户反馈"),
        )
        .unwrap();
        assert_eq!(source_hit.items[0].id, "source-meeting");

        let pack_hit = search(
            &storage,
            &managed,
            &mut index,
            input("workspace-search", "资料包"),
        )
        .unwrap();
        assert_eq!(pack_hit.items[0].id, pack.id);

        let excluded = search(
            &storage,
            &managed,
            &mut index,
            input("workspace-search", "TOPSECRET"),
        )
        .unwrap();
        assert!(excluded.items.is_empty());
        assert!(excluded.skipped_documents >= 1);

        crate::document_source::revoke(&storage, "workspace-search", "source-meeting").unwrap();
        let revoked = search(
            &storage,
            &managed,
            &mut index,
            input("workspace-search", "客户反馈"),
        )
        .unwrap();
        assert!(revoked.items.is_empty());

        let rebuilt = rebuild(&mut index);
        assert!(rebuilt.cleared_documents > 0);
        assert!(!rebuilt.result_data_changed);
        assert!(result::get(&storage, &created.result.summary.id).is_ok());
    }

    fn input(workspace_id: &str, query: &str) -> SearchAuthorizedContentInput {
        SearchAuthorizedContentInput {
            workspace_id: Some(workspace_id.into()),
            query: query.into(),
            limit: Some(20),
        }
    }
}
