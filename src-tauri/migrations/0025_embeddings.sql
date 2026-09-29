CREATE TABLE embedding_settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1), config_json TEXT NOT NULL);
CREATE TABLE embedding_models(model_key TEXT PRIMARY KEY, config_json TEXT NOT NULL);
CREATE TABLE embedding_vectors (
    chunk_id INTEGER NOT NULL REFERENCES search_chunks(id) ON DELETE CASCADE,
    model_key TEXT NOT NULL REFERENCES embedding_models(model_key) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK(dimensions BETWEEN 1 AND 4096),
    vector BLOB NOT NULL,
    PRIMARY KEY(chunk_id,model_key)
);
