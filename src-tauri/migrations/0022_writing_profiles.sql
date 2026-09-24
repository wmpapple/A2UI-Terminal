CREATE TABLE writing_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('global', 'workspace')),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    rules TEXT NOT NULL DEFAULT '' CHECK(length(rules) <= 12000),
    terminology_json TEXT NOT NULL DEFAULT '[]',
    forbidden_words_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK(
        (scope = 'global' AND id = 'global' AND workspace_id IS NULL) OR
        (scope = 'workspace' AND workspace_id IS NOT NULL AND id = 'workspace:' || workspace_id)
    )
);

CREATE UNIQUE INDEX writing_profiles_workspace_scope
    ON writing_profiles(workspace_id)
    WHERE scope = 'workspace';

CREATE TABLE writing_profile_examples (
    profile_id TEXT NOT NULL REFERENCES writing_profiles(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES personal_knowledge(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    PRIMARY KEY(profile_id, source_id),
    UNIQUE(profile_id, position)
);

CREATE INDEX writing_profile_examples_source
    ON writing_profile_examples(source_id, profile_id);

INSERT INTO writing_profiles(id, scope, workspace_id, enabled, version)
VALUES ('global', 'global', NULL, 0, 1);
