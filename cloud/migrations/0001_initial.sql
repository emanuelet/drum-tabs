PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expiresAt TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(userId);

CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt TEXT,
    refreshTokenExpiresAt TEXT,
    scope TEXT,
    password TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT,
    updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS tab (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 0,
    is_fav INTEGER NOT NULL DEFAULT 0,
    object_key TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS tab_active_created_idx ON tab(deleted_at, created_at DESC);

CREATE TABLE IF NOT EXISTS tab_audio (
    tab_id TEXT NOT NULL REFERENCES tab(id),
    filename TEXT NOT NULL,
    object_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    sync_method TEXT NOT NULL DEFAULT 'simple' CHECK (sync_method IN ('simple', 'advanced')),
    simple_sync REAL NOT NULL DEFAULT 0,
    advanced_sync TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tab_id, filename)
);

CREATE TABLE IF NOT EXISTS tab_youtube (
    tab_id TEXT NOT NULL REFERENCES tab(id),
    video_id TEXT NOT NULL,
    sync_method TEXT NOT NULL DEFAULT 'simple' CHECK (sync_method IN ('simple', 'advanced')),
    simple_sync REAL NOT NULL DEFAULT 0,
    advanced_sync TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tab_id, video_id)
);

CREATE TABLE IF NOT EXISTS user_setting (
    user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_token (
    token TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL REFERENCES tab(id),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS file_token_expiry_idx ON file_token(expires_at);

CREATE TABLE IF NOT EXISTS exercise (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    tempo INTEGER NOT NULL,
    alpha_tex TEXT NOT NULL,
    is_fav INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
