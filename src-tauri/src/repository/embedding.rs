use crate::{domain::semantic_search::EmbeddingConfig, error::AppError, storage::Storage};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

pub(crate) fn hash(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Clone)]
pub(crate) struct Chunk {
    pub id: i64,
    pub key: String,
    pub text: String,
    pub hash: String,
    pub vector: Option<Vec<f32>>,
}

pub(crate) fn config(storage: &Storage) -> Result<Option<EmbeddingConfig>, AppError> {
    storage.with_read(|db| {
        let json: Option<String> = db
            .query_row(
                "SELECT config_json FROM embedding_settings WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        json.map(|j| serde_json::from_str(&j).map_err(|_| AppError::StateUnavailable))
            .transpose()
    })
}

pub(crate) fn register_model(
    storage: &Storage,
    key: &str,
    config: &EmbeddingConfig,
    provider: &crate::ai::ProviderConfig,
) -> Result<(), AppError> {
    let json =
        serde_json::to_string(&(config, provider)).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        db.execute(
            "INSERT OR IGNORE INTO embedding_models VALUES(?1,?2)",
            params![key, json],
        )?;
        Ok(())
    })
}
pub(crate) fn save_config(storage: &Storage, config: &EmbeddingConfig) -> Result<(), AppError> {
    let json = serde_json::to_string(config).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| { db.execute("INSERT INTO embedding_settings VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET config_json=excluded.config_json",[json])?; Ok(()) })
}
pub(crate) fn chunks(
    storage: &Storage,
    scope: &str,
    model_key: &str,
    dimensions: usize,
    keys: &[String],
) -> Result<Vec<Chunk>, AppError> {
    let keys = serde_json::to_string(keys).map_err(|_| AppError::StateUnavailable)?;
    storage.with_read(|db| {
        let mut s=db.prepare("SELECT c.id,d.source_key,c.text,e.content_hash,e.dimensions,e.vector FROM search_chunks c JOIN search_documents d ON d.id=c.document_id LEFT JOIN embedding_vectors e ON e.chunk_id=c.id AND e.model_key=?2 WHERE d.scope=?1 AND d.index_version=?3 AND d.source_key IN (SELECT value FROM json_each(?4)) ORDER BY d.source_key,c.ordinal LIMIT 10001")?;
        let rows=s.query_map(params![scope,model_key,crate::repository::search::INDEX_VERSION,keys],|r|{
            let text:String=r.get(2)?; let hash=hash(&text);
            let saved_hash:Option<String>=r.get(3)?;
            let saved_dim:Option<i64>=r.get(4)?;
            let bytes:Option<Vec<u8>>=r.get(5)?;
            let vector=bytes.filter(|b|b.len()==dimensions*4 && saved_hash.as_ref()==Some(&hash) && saved_dim==Some(dimensions as i64))
                .and_then(|b|crate::ai::embedding::normalize(b.chunks_exact(4).map(|v|f32::from_le_bytes(v.try_into().expect("four bytes"))).collect(),dimensions).ok());
            Ok(Chunk {id:r.get(0)?,key:r.get(1)?,text,hash,vector})
        })?.collect::<Result<Vec<_>,_>>()?;
        if rows.len()>10000 { return Err(AppError::InvalidInput("语义检索本次最多处理一万个片段，请缩小资料范围".into())); }
        Ok(rows)
    })
}
pub(crate) fn store(
    storage: &Storage,
    key: &str,
    chunks: &[Chunk],
    vectors: &[Vec<f32>],
    generation: i64,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        let current:i64=db.query_row("SELECT generation FROM search_state",[],|r|r.get(0))?;
        if current!=generation {return Err(AppError::FileConflict);}
        for (chunk,vector) in chunks.iter().zip(vectors) {
            let current:Option<String>=db.query_row("SELECT text FROM search_chunks WHERE id=?1",[chunk.id],|r|r.get(0)).optional()?;
            if current.as_deref()!=Some(chunk.text.as_str()) {return Err(AppError::FileConflict);}
            let bytes=vector.iter().flat_map(|v|v.to_le_bytes()).collect::<Vec<_>>();
            db.execute("INSERT INTO embedding_vectors VALUES(?1,?2,?3,?4,?5) ON CONFLICT(chunk_id,model_key) DO UPDATE SET content_hash=excluded.content_hash,dimensions=excluded.dimensions,vector=excluded.vector",params![chunk.id,key,chunk.hash,vector.len() as i64,bytes])?;
        }
        Ok(())
    })
}
