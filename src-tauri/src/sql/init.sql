PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_configs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL DEFAULT 'off'
        CHECK (reasoning_effort IN ('off', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    concurrent_limit INTEGER NOT NULL DEFAULT 5,
    request_timeout INTEGER NOT NULL DEFAULT 180,
    rate_limit INTEGER NOT NULL DEFAULT 60
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('theme', 'dark');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('tray_enabled', 'false');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('initialization_template_selected_keys', '');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('initialization_template_regenerate', 'false');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('initialization_template_model_id', '');

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    video_path TEXT NOT NULL,
    subtitle_path TEXT,
    full_summary TEXT,
    detailed_reading TEXT,
    highlights TEXT,
    visual_summary TEXT,
    custom_summary TEXT,
    ai_note_markdown TEXT,
    ai_note_meta TEXT,
    suggested_questions TEXT,
    last_playback_position REAL,
    flashcards TEXT,
    panoramic_blueprint TEXT,
    quick_notes TEXT,
    quick_notes_mindmap TEXT,
    quick_notes_canvas TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS note_initialization_runs (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('idle', 'queued', 'running', 'completed', 'partial_failed', 'failed', 'canceled')),
    model_override_id TEXT,
    last_error TEXT,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_initialization_runs_status ON note_initialization_runs(status);
CREATE INDEX IF NOT EXISTS idx_note_initialization_runs_updated_at ON note_initialization_runs(updated_at DESC);

CREATE TABLE IF NOT EXISTS note_initialization_items (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'queued', 'running', 'completed', 'skipped', 'failed', 'blocked', 'canceled')),
    depends_on_json TEXT,
    last_model_id TEXT,
    last_error TEXT,
    output_present INTEGER NOT NULL DEFAULT 0,
    config_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    UNIQUE(note_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_note_initialization_items_note_id ON note_initialization_items(note_id);
CREATE INDEX IF NOT EXISTS idx_note_initialization_items_status ON note_initialization_items(status);
CREATE INDEX IF NOT EXISTS idx_note_initialization_items_note_status ON note_initialization_items(note_id, status);

CREATE TABLE IF NOT EXISTS subtitle_chunks (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    UNIQUE(note_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_subtitle_chunks_note ON subtitle_chunks(note_id);

CREATE TABLE IF NOT EXISTS embedding_configs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reranker_configs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompt_configs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS optimized_subtitles (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    optimized_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    UNIQUE(note_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_optimized_subtitles_note ON optimized_subtitles(note_id);

CREATE TABLE IF NOT EXISTS note_ui_state (
    note_id TEXT PRIMARY KEY,
    show_subtitles INTEGER NOT NULL DEFAULT 0,
    subtitle_optimization_enabled INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS screenshot_markers (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    subtitle_index INTEGER NOT NULL,
    timestamp REAL NOT NULL,
    screenshot_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    UNIQUE(note_id, subtitle_index)
);

CREATE INDEX IF NOT EXISTS idx_screenshot_markers_note_id ON screenshot_markers(note_id);

CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    parent_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    cover_image TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (parent_id) REFERENCES collections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collection_items (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    UNIQUE(collection_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_note ON collection_items(note_id);

CREATE TABLE IF NOT EXISTS subtitle_index_status (
    note_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('indexing', 'completed', 'failed')),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subtitle_index_status_status ON subtitle_index_status(status);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_note ON knowledge_chunks(note_id);

CREATE TABLE IF NOT EXISTS knowledge_index_status (
    note_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('indexing', 'completed', 'failed')),
    chunk_count INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_index_status_status ON knowledge_index_status(status);

CREATE TABLE IF NOT EXISTS knowledge_chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('standard', 'agent')),
    model_id TEXT,
    prompt_id TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_message_at TEXT,
    FOREIGN KEY (model_id) REFERENCES ai_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (prompt_id) REFERENCES prompt_configs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chat_sessions_updated_at ON knowledge_chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chat_sessions_last_message_at ON knowledge_chat_sessions(last_message_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('streaming', 'completed', 'error', 'aborted')),
    request_id TEXT,
    parent_message_id TEXT,
    model_id TEXT,
    prompt_id TEXT,
    error_message TEXT,
    images_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_id) REFERENCES knowledge_chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_message_id) REFERENCES knowledge_chat_messages(id) ON DELETE SET NULL,
    FOREIGN KEY (model_id) REFERENCES ai_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (prompt_id) REFERENCES prompt_configs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chat_messages_session_id ON knowledge_chat_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chat_messages_request_id ON knowledge_chat_messages(request_id);

CREATE TABLE IF NOT EXISTS knowledge_chat_message_sources (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    score REAL,
    query_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (message_id) REFERENCES knowledge_chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chat_message_sources_message_id ON knowledge_chat_message_sources(message_id, rank ASC);

CREATE TABLE IF NOT EXISTS knowledge_agent_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'aborted')),
    iteration_count INTEGER NOT NULL DEFAULT 0,
    plan_summary TEXT,
    final_summary TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    completed_at TEXT,
    FOREIGN KEY (session_id) REFERENCES knowledge_chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES knowledge_chat_messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_agent_runs_session_id ON knowledge_agent_runs(session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_agent_runs_message_id ON knowledge_agent_runs(message_id);

CREATE TABLE IF NOT EXISTS knowledge_agent_trace_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (run_id) REFERENCES knowledge_agent_runs(id) ON DELETE CASCADE,
    UNIQUE(run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_agent_trace_steps_run_id ON knowledge_agent_trace_steps(run_id, step_index ASC);

CREATE TABLE IF NOT EXISTS knowledge_chat_preferences (
    id TEXT PRIMARY KEY,
    default_mode TEXT NOT NULL DEFAULT 'agent' CHECK(default_mode IN ('standard', 'agent')),
    default_model_id TEXT,
    default_prompt_id TEXT,
    show_agent_trace INTEGER NOT NULL DEFAULT 1,
    show_sources_expanded INTEGER NOT NULL DEFAULT 1,
    compact_message_density INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (default_model_id) REFERENCES ai_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (default_prompt_id) REFERENCES prompt_configs(id) ON DELETE SET NULL
);
