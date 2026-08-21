use std::collections::{BTreeMap, BTreeSet, HashMap};

pub const CHUNK_TARGET_CHARACTERS: usize = 1_600;
pub const CHUNK_OVERLAP_CHARACTERS: usize = 200;
const CHUNK_MIN_CHARACTERS: usize = 1_200;

#[derive(Debug, Clone, PartialEq)]
pub struct IndexedChunk {
    pub id: String,
    pub start_character: usize,
    pub end_character: usize,
    pub content: String,
    term_frequency: BTreeMap<String, usize>,
    term_count: usize,
}

#[derive(Debug, Clone)]
struct IndexedDocument {
    content_hash: String,
    chunks: Vec<IndexedChunk>,
}

#[derive(Debug, Clone, Default)]
pub struct ContextIndex {
    documents: HashMap<(String, String), IndexedDocument>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RankedChunk {
    pub source_id: String,
    pub source_order: usize,
    pub chunk: IndexedChunk,
    pub score: f64,
}

impl ContextIndex {
    pub fn retain_workspace(&mut self, workspace_id: &str) {
        self.documents
            .retain(|(indexed_workspace_id, _), _| indexed_workspace_id == workspace_id);
    }

    pub fn chunks(
        &mut self,
        workspace_id: &str,
        source_id: &str,
        content_hash: &str,
        content: &str,
    ) -> Vec<IndexedChunk> {
        let key = (workspace_id.to_string(), source_id.to_string());
        let needs_rebuild = self
            .documents
            .get(&key)
            .map(|document| document.content_hash != content_hash)
            .unwrap_or(true);
        if needs_rebuild {
            self.documents.insert(
                key.clone(),
                IndexedDocument {
                    content_hash: content_hash.to_string(),
                    chunks: chunk_text(content),
                },
            );
        }
        self.documents
            .get(&key)
            .map(|document| document.chunks.clone())
            .unwrap_or_default()
    }

    pub fn clear_workspace(&mut self, workspace_id: &str) -> usize {
        let before = self.documents.len();
        self.documents
            .retain(|(indexed_workspace_id, _), _| indexed_workspace_id != workspace_id);
        before.saturating_sub(self.documents.len())
    }

    pub fn clear_source(&mut self, workspace_id: &str, source_id: &str) -> bool {
        self.documents
            .remove(&(workspace_id.to_string(), source_id.to_string()))
            .is_some()
    }

    pub fn clear(&mut self) -> usize {
        let count = self.documents.len();
        self.documents.clear();
        count
    }

    #[cfg(test)]
    pub fn document_count(&self) -> usize {
        self.documents.len()
    }
}

pub fn rank_chunks(
    query: &str,
    documents: &[(usize, String, Vec<IndexedChunk>)],
) -> Vec<RankedChunk> {
    let query_terms = tokenize(query).into_iter().collect::<BTreeSet<_>>();
    let all_chunks = documents
        .iter()
        .flat_map(|(source_order, source_id, chunks)| {
            chunks
                .iter()
                .cloned()
                .map(move |chunk| (*source_order, source_id.clone(), chunk))
        })
        .collect::<Vec<_>>();
    if all_chunks.is_empty() {
        return Vec::new();
    }

    let average_length = all_chunks
        .iter()
        .map(|(_, _, chunk)| chunk.term_count.max(1) as f64)
        .sum::<f64>()
        / all_chunks.len() as f64;
    let document_frequency = query_terms
        .iter()
        .map(|term| {
            let count = all_chunks
                .iter()
                .filter(|(_, _, chunk)| chunk.term_frequency.contains_key(term))
                .count();
            (term.clone(), count)
        })
        .collect::<BTreeMap<_, _>>();
    let normalized_query = query.trim().to_lowercase();
    let chunk_count = all_chunks.len() as f64;

    let mut ranked = all_chunks
        .into_iter()
        .map(|(source_order, source_id, chunk)| {
            let length = chunk.term_count.max(1) as f64;
            let score = query_terms.iter().fold(0.0, |score, term| {
                let frequency = *chunk.term_frequency.get(term).unwrap_or(&0) as f64;
                if frequency == 0.0 {
                    return score;
                }
                let matching_chunks = *document_frequency.get(term).unwrap_or(&0) as f64;
                let inverse_frequency =
                    (1.0 + (chunk_count - matching_chunks + 0.5) / (matching_chunks + 0.5)).ln();
                let normalization =
                    frequency + 1.2 * (1.0 - 0.75 + 0.75 * length / average_length.max(1.0));
                score + inverse_frequency * (frequency * 2.2) / normalization
            }) + if !normalized_query.is_empty()
                && chunk.content.to_lowercase().contains(&normalized_query)
            {
                2.0
            } else {
                0.0
            };
            RankedChunk {
                source_id,
                source_order,
                chunk,
                score,
            }
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.source_order.cmp(&right.source_order))
            .then_with(|| left.chunk.start_character.cmp(&right.chunk.start_character))
            .then_with(|| left.source_id.cmp(&right.source_id))
    });
    ranked
}

pub fn chunk_text(content: &str) -> Vec<IndexedChunk> {
    let characters = content.chars().collect::<Vec<_>>();
    if characters.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < characters.len() {
        let target_end = (start + CHUNK_TARGET_CHARACTERS).min(characters.len());
        let end = if target_end == characters.len() {
            target_end
        } else {
            preferred_boundary(&characters, start, target_end)
        };
        let content = characters[start..end].iter().collect::<String>();
        let terms = tokenize(&content);
        let mut term_frequency = BTreeMap::new();
        for term in &terms {
            *term_frequency.entry(term.clone()).or_insert(0) += 1;
        }
        chunks.push(IndexedChunk {
            id: format!("chunk-{:04}", chunks.len() + 1),
            start_character: start,
            end_character: end,
            content,
            term_frequency,
            term_count: terms.len(),
        });
        if end == characters.len() {
            break;
        }
        let next = end.saturating_sub(CHUNK_OVERLAP_CHARACTERS);
        start = next.max(start + 1);
    }
    chunks
}

fn preferred_boundary(characters: &[char], start: usize, target_end: usize) -> usize {
    let search_start = (start + CHUNK_MIN_CHARACTERS).min(target_end);
    for index in (search_start..target_end).rev() {
        if characters[index] == '\n' {
            return index + 1;
        }
    }
    for index in (search_start..target_end).rev() {
        if matches!(
            characters[index],
            '。' | '！' | '？' | '.' | '!' | '?' | ';' | '；'
        ) {
            return index + 1;
        }
    }
    target_end
}

fn tokenize(content: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut cjk = Vec::new();

    let flush_word = |word: &mut String, tokens: &mut Vec<String>| {
        if !word.is_empty() {
            tokens.push(std::mem::take(word));
        }
    };
    let flush_cjk = |cjk: &mut Vec<char>, tokens: &mut Vec<String>| {
        if cjk.len() == 1 {
            tokens.push(cjk[0].to_string());
        } else {
            tokens.extend(cjk.windows(2).map(|pair| pair.iter().collect::<String>()));
        }
        cjk.clear();
    };

    for character in content.to_lowercase().chars() {
        if is_cjk(character) {
            flush_word(&mut word, &mut tokens);
            cjk.push(character);
        } else if character.is_alphanumeric() || character == '_' {
            flush_cjk(&mut cjk, &mut tokens);
            word.push(character);
        } else {
            flush_word(&mut word, &mut tokens);
            flush_cjk(&mut cjk, &mut tokens);
        }
    }
    flush_word(&mut word, &mut tokens);
    flush_cjk(&mut cjk, &mut tokens);
    tokens
}

fn is_cjk(character: char) -> bool {
    matches!(
        character,
        '\u{3400}'..='\u{4dbf}'
            | '\u{4e00}'..='\u{9fff}'
            | '\u{f900}'..='\u{faff}'
            | '\u{20000}'..='\u{2fa1f}'
    )
}

#[cfg(test)]
mod tests {
    use super::{chunk_text, rank_chunks, ContextIndex, CHUNK_OVERLAP_CHARACTERS};

    #[test]
    fn chunks_are_deterministic_and_overlap_by_character() {
        let content = (0..140)
            .map(|index| format!("## 标题 {index}\n这一段用于验证结构化分块。\n\n"))
            .collect::<String>();
        let first = chunk_text(&content);
        let second = chunk_text(&content);
        assert_eq!(first, second);
        assert!(first.len() > 1);
        assert_eq!(
            first[1].start_character,
            first[0].end_character - CHUNK_OVERLAP_CHARACTERS
        );
        assert!(first[0].content.ends_with('\n'));
    }

    #[test]
    fn ranking_is_reproducible_for_english_and_chinese_queries() {
        let meeting = chunk_text("预算讨论和发布计划。budget review and launch plan.");
        let unrelated = chunk_text("天气预报。weather only.");
        let documents = vec![
            (0, "meeting".to_string(), meeting),
            (1, "weather".to_string(), unrelated),
        ];
        for query in ["预算发布", "budget launch"] {
            let first = rank_chunks(query, &documents);
            let second = rank_chunks(query, &documents);
            assert_eq!(first, second);
            assert_eq!(first[0].source_id, "meeting");
        }
    }

    #[test]
    fn cache_rebuilds_on_hash_change_and_can_be_cleared_by_scope() {
        let mut index = ContextIndex::default();
        index.chunks("workspace-a", "source-a", "hash-a", "first");
        index.chunks("workspace-a", "source-b", "hash-b", "second");
        assert_eq!(index.document_count(), 2);
        index.chunks("workspace-a", "source-a", "hash-c", "changed");
        assert_eq!(index.document_count(), 2);
        assert!(index.clear_source("workspace-a", "source-a"));
        assert_eq!(index.clear_workspace("workspace-a"), 1);
        assert_eq!(index.document_count(), 0);
    }
}
