CREATE TABLE collaboration_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL
);
INSERT INTO collaboration_identity VALUES(1, lower(hex(randomblob(16))), '本机用户');
CREATE TABLE result_ownership (
    result_id TEXT PRIMARY KEY REFERENCES results(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES collaboration_identity(id)
);
INSERT INTO result_ownership SELECT r.id, i.id FROM results r CROSS JOIN collaboration_identity i;
CREATE TRIGGER result_local_owner AFTER INSERT ON results BEGIN
    INSERT INTO result_ownership SELECT NEW.id, id FROM collaboration_identity WHERE singleton=1;
END;
CREATE TABLE collaboration_shares (
    id TEXT PRIMARY KEY,
    result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    permission TEXT NOT NULL CHECK(permission IN ('read', 'review')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
    package_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE collaboration_inbox (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('share','feedback')),
    package_hash TEXT NOT NULL,
    package_json TEXT NOT NULL,
    reply_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE collaboration_reviews (
    review_id TEXT PRIMARY KEY REFERENCES review_requests(id) ON DELETE CASCADE,
    share_id TEXT NOT NULL REFERENCES collaboration_shares(id) ON DELETE CASCADE,
    inbox_id TEXT NOT NULL UNIQUE REFERENCES collaboration_inbox(id) ON DELETE CASCADE
);
CREATE TABLE collaboration_audit (
    id INTEGER PRIMARY KEY,
    event TEXT NOT NULL,
    record_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
