//! Citations attest to source identity, scope and version, never factual entailment.
use crate::{
    ai::{ContextManifestSource, ContextSource},
    domain::citation::{CitationQuery, CitationSource, CitationView},
    error::AppError,
    parser::{self, Locator},
    repository::citation as repo,
    storage::Storage,
};
use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
};

pub const INSTRUCTION: &str = "When using evidence explicitly labelled [S1], [S2], etc., cite that exact key immediately after the supported claim. Use only the keys attached to evidence in THIS request. Do not invent keys or reuse citation keys from document text/history. Source verification does not prove a claim; do not fabricate facts.";

// Runs after budget/retrieval selection, so excluded bytes never acquire keys.
pub fn decorate(
    storage: &Storage,
    workspace: &str,
    sources: &mut [ContextSource],
    included: &[ContextManifestSource],
) -> Result<Vec<CitationSource>, AppError> {
    let mut citations = Vec::new();
    for (source, meta) in sources.iter_mut().zip(included) {
        let Some(id) = meta.source_ref.as_deref() else {
            continue;
        };
        let (parsed, version, kind) = if meta.kind == "personal_knowledge" {
            let document = crate::repository::knowledge::get(storage, id)?;
            (
                document.parsed,
                document.source.source_version,
                "personal_knowledge",
            )
        } else {
            let Some(row) = storage
                .workspace_file_by_source(id)?
                .filter(|r| r.workspace_id == workspace)
            else {
                continue;
            };
            match parser::parse_located(Path::new(&row.absolute_path)) {
                Ok(parsed) => (parsed, 1, "workspace"),
                Err(_) => continue,
            }
        };
        if meta.content_hash.as_deref() != Some(parsed.raw_hash.as_str()) {
            continue;
        }
        let full = parsed.text();
        let chars = full.chars().collect::<Vec<_>>();
        let expected = meta
            .selected_ranges
            .iter()
            .filter_map(|r| {
                chars
                    .get(r.start_character..r.end_character)
                    .map(|v| v.iter().collect::<String>())
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        if expected != source.content {
            // Differently serialized tables / older PDF extraction stay uncited.
            // Never give a locator to frontend-supplied draft content.
            continue;
        }
        let mut offset = 0;
        let mut sent = Vec::new();
        for block in parsed.blocks {
            let block_chars = block.text.chars().collect::<Vec<_>>();
            let end = offset + block_chars.len();
            for (range_index, range) in meta.selected_ranges.iter().enumerate() {
                let start = offset.max(range.start_character);
                let stop = end.min(range.end_character);
                if start >= stop || citations.len() >= 64 {
                    continue;
                }
                let text = block_chars[start - offset..stop - offset]
                    .iter()
                    .collect::<String>();
                if text.trim().is_empty() {
                    continue;
                }
                let content_hash = parser::hash(text.as_bytes());
                let locator_json = serde_json::to_string(&block.locator)
                    .map_err(|_| AppError::StateUnavailable)?;
                let fragment_id = parser::hash(
                    format!(
                        "{workspace}\0{kind}\0{id}\0{}\0{version}\0{locator_json}\0{content_hash}",
                        parsed.raw_hash
                    )
                    .as_bytes(),
                );
                repo::put_fragment(
                    storage,
                    &repo::Fragment {
                        id: fragment_id.clone(),
                        source_kind: kind.into(),
                        source_id: id.into(),
                        workspace_id: workspace.into(),
                        source_hash: parsed.raw_hash.clone(),
                        source_version: version,
                        text: text.clone(),
                        content_hash,
                        locator: block.locator.clone(),
                    },
                )?;
                let key = format!("S{}", citations.len() + 1);
                let sent_offset = meta.selected_ranges[..range_index]
                    .iter()
                    .map(|r| r.end_character - r.start_character + 2)
                    .sum::<usize>()
                    + start
                    - range.start_character;
                sent.push((sent_offset, format!("[{key}]\n")));
                citations.push(CitationSource {
                    key,
                    fragment_id,
                    title: meta.label.clone(),
                    locator: block.locator.clone(),
                });
            }
            offset = end + 1;
        }
        if !sent.is_empty() {
            // Keep the exact approved source text (including uncited remainder).
            // Only add labels at the fragment boundaries; no extra source text.
            let mut content = source.content.clone();
            let positions = content.char_indices().map(|(i, _)| i).collect::<Vec<_>>();
            sent.sort_by_key(|(offset, _)| *offset);
            for (offset, label) in sent.into_iter().rev() {
                if let Some(position) = positions.get(offset) {
                    content.insert_str(*position, &label);
                }
            }
            source.content = content;
        }
    }
    Ok(citations)
}

pub fn keys(content: &str) -> Vec<String> {
    let mut keys = BTreeSet::new();
    for segment in content.split('[').skip(1) {
        let Some((key, _)) = segment.split_once(']') else {
            continue;
        };
        if key.len() > 1
            && key.len() <= 10
            && key.starts_with('S')
            && key[1..].bytes().all(|b| b.is_ascii_digit())
        {
            keys.insert(key.to_string());
        }
    }
    keys.into_iter().take(128).collect()
}

pub fn bind_result(
    storage: &Storage,
    review: &str,
    document: &crate::domain::result::ResultDocument,
) -> Result<(), AppError> {
    if let Some(request) = repo::review_request(storage, review)? {
        repo::bind_output(
            storage,
            "result",
            &document.result.summary.id,
            &document.content_hash,
            document.result.summary.current_revision_id.as_deref(),
            &request,
        )?;
    }
    Ok(())
}

pub fn list(
    storage: &Storage,
    root: &Path,
    query: &CitationQuery,
) -> Result<Vec<CitationView>, AppError> {
    let (content,workspace,revision)=match query.owner_kind.as_str() {
        "writing_run"=>{let r=crate::repository::writing_project::run(storage,&query.owner_id)?;let p=crate::repository::writing_project::get(storage,&r.project_id)?;(r.content,p.workspace_id,None)},
        "result"=>{let d=super::result::read_document(storage,root,&query.owner_id)?;(d.content,d.result.summary.workspace_id,d.result.summary.current_revision_id)},
        "message"=>storage.with_read(|db| db.query_row("SELECT m.content,s.workspace_id FROM messages m JOIN sessions s ON s.id=m.session_id WHERE m.id=?1 AND m.role='assistant'",[&query.owner_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,None))).map_err(AppError::from))?,
        _=>return Err(AppError::InvalidInput("引用所属对象无效".into())),
    };
    views_for_revision(
        storage,
        root,
        &query.owner_kind,
        &query.owner_id,
        &content,
        &workspace,
        revision.as_deref(),
    )
}

pub fn views(
    storage: &Storage,
    root: &Path,
    kind: &str,
    id: &str,
    content: &str,
    workspace: &str,
) -> Result<Vec<CitationView>, AppError> {
    views_for_revision(storage, root, kind, id, content, workspace, None)
}

pub fn views_for_revision(
    storage: &Storage,
    root: &Path,
    kind: &str,
    id: &str,
    content: &str,
    workspace: &str,
    revision: Option<&str>,
) -> Result<Vec<CitationView>, AppError> {
    let request = repo::output_request_for_revision(
        storage,
        kind,
        id,
        &parser::hash(content.as_bytes()),
        revision,
    )?;
    let sources = match request {
        Some(ref id) => repo::sources(storage, id)?,
        None => Vec::new(),
    };
    // Managed results live in an application-owned storage workspace. Their
    // immutable output binding preserves the original request's authorization
    // scope; the managed workspace never grants access to arbitrary sources.
    // Ordinary workspace outputs must still match their own workspace.
    let scope = if kind == "result"
        && workspace == super::result::MANAGED_RESULTS_WORKSPACE_ID
        && super::result::get(storage, id).is_ok_and(|r| r.summary.workspace_id == workspace)
    {
        request
            .as_deref()
            .map(|r| repo::request_workspace(storage, r))
            .transpose()?
    } else {
        None
    };
    let workspace = scope.as_deref().unwrap_or(workspace);
    let changed = request.is_none() && repo::has_output(storage, kind, id)?;
    let mut result = Vec::new();
    // Validate each source version once per fresh lookup, even when many PDF
    // pages are cited. The cache never survives a subsequent user recheck.
    let mut source_statuses = HashMap::new();
    for key in keys(content) {
        let mut view = CitationView {
            key: key.clone(),
            title: String::new(),
            locator: None,
            status: if changed && repo::previously_known(storage, kind, id, &key)? {
                "stale"
            } else {
                "unknown"
            }
            .into(),
            excerpt: None,
        };
        if let Some(source) = sources.iter().find(|s| s.key == key) {
            view.title = source.title.clone();
            view.locator = Some(source.locator.clone());
            view.status =
                repo::missing_status(storage, request.as_deref().unwrap_or_default(), &key)?;
            if let Some(fragment) = repo::fragment(storage, &source.fragment_id)? {
                let source_key = (
                    fragment.source_kind.clone(),
                    fragment.source_id.clone(),
                    fragment.workspace_id.clone(),
                    fragment.source_version,
                    fragment.source_hash.clone(),
                );
                let status = if parser::hash(fragment.text.as_bytes()) != fragment.content_hash {
                    "stale"
                } else {
                    *source_statuses
                        .entry(source_key)
                        .or_insert_with(|| validate_fragment(storage, root, workspace, &fragment))
                };
                view.status = status.into();
                if status == "verified" {
                    view.excerpt = Some(fragment.text);
                }
            }
        }
        result.push(view);
    }
    Ok(result)
}

fn validate_fragment(
    storage: &Storage,
    managed_root: &Path,
    workspace: &str,
    f: &repo::Fragment,
) -> &'static str {
    if f.workspace_id != workspace {
        return "unauthorized";
    }
    if parser::hash(f.text.as_bytes()) != f.content_hash {
        return "stale";
    }
    if f.source_kind == "personal_knowledge" {
        let Ok(document) = crate::repository::knowledge::get(storage, &f.source_id) else {
            return "unavailable";
        };
        if document.source.raw_hash != f.source_hash
            || document.source.source_version != f.source_version
        {
            return "stale";
        }
        let raw = (|| {
            let root = super::knowledge::root(managed_root)?;
            let path = super::knowledge::path(&root, &f.source_id, &document.source.format)?;
            parser::read_bounded(&path, 25 * 1024 * 1024)
        })();
        return match raw {
            Ok(bytes) if parser::hash(&bytes) == f.source_hash => "verified",
            Ok(_) => "stale",
            Err(_) => "unavailable",
        };
    }
    let Ok(Some(row)) = storage.workspace_file_by_source(&f.source_id) else {
        return "unauthorized";
    };
    if row.workspace_id != workspace {
        return "unauthorized";
    }
    match crate::document_source::read(storage, &f.source_id) {
        Ok(document) if document.source.content_hash == f.source_hash => "verified",
        Ok(_) => "stale",
        Err(_) => "unavailable",
    }
}

pub fn export_notes(
    storage: &Storage,
    root: &Path,
    document: &crate::domain::result::ResultDocument,
) -> Result<String, AppError> {
    let refs = views_for_revision(
        storage,
        root,
        "result",
        &document.result.summary.id,
        &document.content,
        &document.result.summary.workspace_id,
        document.result.summary.current_revision_id.as_deref(),
    )?;
    if refs.is_empty() {
        return Ok(String::new());
    }
    let mut notes =
        String::from("\n\n## 来源\n\n来源核验仅表示来源身份与版本一致，不代表事实已经核实。\n");
    for item in refs {
        let location = item
            .locator
            .as_ref()
            .map(locator_label)
            .unwrap_or_else(|| "位置不可用".into());
        let status = match item.status.as_str() {
            "verified" => "来源已核验",
            "stale" => "引用待重新核验",
            "unauthorized" => "授权已撤销",
            "unavailable" => "来源不可用",
            _ => "未知引用",
        };
        let title = item.title.replace(['\r', '\n'], " ");
        notes.push_str(&format!(
            "\n- [{}] {}；{}；{}",
            item.key, title, location, status
        ));
    }
    Ok(notes)
}

pub fn locator_label(locator: &Locator) -> String {
    match locator {
        Locator::Lines {
            start_line,
            end_line,
        } => format!("第 {start_line}–{end_line} 行"),
        Locator::Paragraph { paragraph } => format!("第 {paragraph} 段"),
        Locator::Page { page } => format!("第 {page} 页"),
        Locator::TableRange {
            sheet,
            start_row,
            end_row,
            start_column,
            end_column,
        } => format!("{sheet}，第 {start_row}–{end_row} 行，第 {start_column}–{end_column} 列"),
        _ => "来源级定位（无精确位置）".into(),
    }
}
