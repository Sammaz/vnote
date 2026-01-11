use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiConfig {
    pub id: i64,
    pub title: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub sort_order: i32,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub theme: String,
    pub tray_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub video_path: String,
    pub subtitle_path: Option<String>,
    pub model_id: Option<i64>, // AI model ID used for generating notes
    pub full_summary: Option<String>,
    pub detailed_reading: Option<String>,
    pub highlights: Option<String>,
    pub visual_summary: Option<String>,
    pub custom_summary: Option<String>,
    pub suggested_questions: Option<String>, // JSON array of questions
    pub last_playback_position: Option<f64>, // Last playback position in seconds
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateNoteRequest {
    pub title: String,
    pub video_path: String,
    pub subtitle_path: Option<String>,
    pub model_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubtitleChunk {
    pub id: i64,
    pub note_id: i64,
    pub chunk_index: i32,
    pub start_time: f64,
    pub end_time: f64,
    pub content: String,
    pub embedding: Option<Vec<u8>>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmbeddingConfig {
    pub id: i64,
    pub title: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub sort_order: i32,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RerankerConfig {
    pub id: i64,
    pub title: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub sort_order: i32,
    pub is_default: bool,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl std::fmt::Debug for Database {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").finish()
    }
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> SqliteResult<Self> {
        std::fs::create_dir_all(&app_data_dir).ok();
        let db_path = app_data_dir.join("vnote.db");
        let conn = Connection::open(db_path)?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS ai_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_default INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        // Migration: Add is_default column if not exists
        let has_is_default: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('ai_configs') WHERE name='is_default'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_is_default {
            conn.execute(
                "ALTER TABLE ai_configs ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Initialize default settings if not exist
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('theme', 'dark')",
            [],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('tray_enabled', 'false')",
            [],
        )?;

        // Notes table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                video_path TEXT NOT NULL,
                subtitle_path TEXT,
                model_id INTEGER,
                full_summary TEXT,
                detailed_reading TEXT,
                highlights TEXT,
                visual_summary TEXT,
                custom_summary TEXT,
                suggested_questions TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            )",
            [],
        )?;

        // Migration: Add model_id column if not exists
        let has_model_id: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='model_id'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_model_id {
            conn.execute(
                "ALTER TABLE notes ADD COLUMN model_id INTEGER",
                [],
            )?;
        }

        // Migration: Add last_playback_position column if not exists
        let has_playback_position: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='last_playback_position'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_playback_position {
            conn.execute(
                "ALTER TABLE notes ADD COLUMN last_playback_position REAL",
                [],
            )?;
        }

        // Subtitle chunks table for RAG
        conn.execute(
            "CREATE TABLE IF NOT EXISTS subtitle_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                content TEXT NOT NULL,
                embedding BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
                UNIQUE(note_id, chunk_index)
            )",
            [],
        )?;

        // Create index for subtitle chunks
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_subtitle_chunks_note ON subtitle_chunks(note_id)",
            [],
        )?;

        // Embedding configs table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS embedding_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_default INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        // Reranker configs table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS reranker_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_default INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        Ok(())
    }

    // AI Config CRUD
    pub fn get_all_ai_configs(&self) -> SqliteResult<Vec<AiConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM ai_configs ORDER BY is_default DESC, sort_order"
        )?;

        let configs = stmt.query_map([], |row| {
            Ok(AiConfig {
                id: row.get(0)?,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        })?;

        configs.collect()
    }

    pub fn create_ai_config(&self, config: &AiConfig) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO ai_configs (title, base_url, api_key, model, sort_order, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (&config.title, &config.base_url, &config.api_key, &config.model, config.sort_order, config.is_default as i32),
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_ai_config(&self, config: &AiConfig) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE ai_configs SET title = ?1, base_url = ?2, api_key = ?3, model = ?4, sort_order = ?5, is_default = ?6 WHERE id = ?7",
            (&config.title, &config.base_url, &config.api_key, &config.model, config.sort_order, config.is_default as i32, config.id),
        )?;
        Ok(())
    }

    pub fn set_default_ai_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        // First, unset all defaults
        conn.execute("UPDATE ai_configs SET is_default = 0", [])?;
        // Then set the specified config as default
        conn.execute("UPDATE ai_configs SET is_default = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn unset_default_ai_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE ai_configs SET is_default = 0 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete_ai_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM ai_configs WHERE id = ?1", [id])?;
        Ok(())
    }

    // App Settings
    pub fn get_setting(&self, key: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let result = stmt.query_row([key], |row| row.get(0));

        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            [key, value],
        )?;
        Ok(())
    }

    pub fn get_app_settings(&self) -> SqliteResult<AppSettings> {
        let theme = self.get_setting("theme")?.unwrap_or_else(|| "dark".to_string());
        let tray_enabled = self.get_setting("tray_enabled")?.unwrap_or_else(|| "false".to_string()) == "true";

        Ok(AppSettings {
            theme,
            tray_enabled,
        })
    }

    // Notes CRUD
    pub fn get_all_notes(&self) -> SqliteResult<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, video_path, subtitle_path, model_id, full_summary, detailed_reading,
                    highlights, visual_summary, custom_summary, suggested_questions, last_playback_position,
                    created_at, updated_at
             FROM notes ORDER BY created_at DESC"
        )?;

        let notes = stmt.query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                video_path: row.get(2)?,
                subtitle_path: row.get(3)?,
                model_id: row.get(4)?,
                full_summary: row.get(5)?,
                detailed_reading: row.get(6)?,
                highlights: row.get(7)?,
                visual_summary: row.get(8)?,
                custom_summary: row.get(9)?,
                suggested_questions: row.get(10)?,
                last_playback_position: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })?;

        notes.collect()
    }

    pub fn get_note_by_id(&self, id: i64) -> SqliteResult<Option<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, video_path, subtitle_path, model_id, full_summary, detailed_reading,
                    highlights, visual_summary, custom_summary, suggested_questions, last_playback_position,
                    created_at, updated_at
             FROM notes WHERE id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                video_path: row.get(2)?,
                subtitle_path: row.get(3)?,
                model_id: row.get(4)?,
                full_summary: row.get(5)?,
                detailed_reading: row.get(6)?,
                highlights: row.get(7)?,
                visual_summary: row.get(8)?,
                custom_summary: row.get(9)?,
                suggested_questions: row.get(10)?,
                last_playback_position: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        });

        match result {
            Ok(note) => Ok(Some(note)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn create_note(&self, req: &CreateNoteRequest) -> SqliteResult<Note> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO notes (title, video_path, subtitle_path, model_id) VALUES (?1, ?2, ?3, ?4)",
            (&req.title, &req.video_path, &req.subtitle_path, &req.model_id),
        )?;
        let id = conn.last_insert_rowid();

        // Return the created note
        let mut stmt = conn.prepare(
            "SELECT id, title, video_path, subtitle_path, model_id, full_summary, detailed_reading,
                    highlights, visual_summary, custom_summary, suggested_questions, last_playback_position,
                    created_at, updated_at
             FROM notes WHERE id = ?1"
        )?;

        stmt.query_row([id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                video_path: row.get(2)?,
                subtitle_path: row.get(3)?,
                model_id: row.get(4)?,
                full_summary: row.get(5)?,
                detailed_reading: row.get(6)?,
                highlights: row.get(7)?,
                visual_summary: row.get(8)?,
                custom_summary: row.get(9)?,
                suggested_questions: row.get(10)?,
                last_playback_position: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
    }

    pub fn update_note(&self, note: &Note) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE notes SET
                title = ?1, video_path = ?2, subtitle_path = ?3, model_id = ?4,
                full_summary = ?5, detailed_reading = ?6, highlights = ?7,
                visual_summary = ?8, custom_summary = ?9, suggested_questions = ?10,
                last_playback_position = ?11,
                updated_at = datetime('now', 'localtime')
             WHERE id = ?12",
            (
                &note.title, &note.video_path, &note.subtitle_path, &note.model_id,
                &note.full_summary, &note.detailed_reading, &note.highlights,
                &note.visual_summary, &note.custom_summary, &note.suggested_questions,
                &note.last_playback_position,
                note.id,
            ),
        )?;
        Ok(())
    }

    pub fn update_playback_position(&self, note_id: i64, position: f64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE notes SET last_playback_position = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2",
            (position, note_id),
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn update_note_questions(&self, note_id: i64, questions_json: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE notes SET suggested_questions = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2",
            (questions_json, note_id),
        )?;
        Ok(())
    }

    // Get AI config by ID
    pub fn get_ai_config_by_id(&self, id: i64) -> SqliteResult<Option<AiConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM ai_configs WHERE id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            Ok(AiConfig {
                id: row.get(0)?,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        });

        match result {
            Ok(config) => Ok(Some(config)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    // Subtitle Chunks CRUD
    pub fn get_subtitle_chunks(&self, note_id: i64) -> SqliteResult<Vec<SubtitleChunk>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, chunk_index, start_time, end_time, content, embedding, created_at
             FROM subtitle_chunks WHERE note_id = ?1 ORDER BY chunk_index"
        )?;

        let chunks = stmt.query_map([note_id], |row| {
            Ok(SubtitleChunk {
                id: row.get(0)?,
                note_id: row.get(1)?,
                chunk_index: row.get(2)?,
                start_time: row.get(3)?,
                end_time: row.get(4)?,
                content: row.get(5)?,
                embedding: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;

        chunks.collect()
    }

    pub fn create_subtitle_chunk(
        &self,
        note_id: i64,
        chunk_index: i32,
        start_time: f64,
        end_time: f64,
        content: &str,
        embedding: Option<&[u8]>,
    ) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO subtitle_chunks (note_id, chunk_index, start_time, end_time, content, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![note_id, chunk_index, start_time, end_time, content, embedding],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn delete_subtitle_chunks(&self, note_id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM subtitle_chunks WHERE note_id = ?1", [note_id])?;
        Ok(())
    }

    // Embedding Config CRUD
    pub fn get_all_embedding_configs(&self) -> SqliteResult<Vec<EmbeddingConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM embedding_configs ORDER BY is_default DESC, sort_order"
        )?;

        let configs = stmt.query_map([], |row| {
            Ok(EmbeddingConfig {
                id: row.get(0)?,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        })?;

        configs.collect()
    }

    pub fn get_default_embedding_config(&self) -> SqliteResult<Option<EmbeddingConfig>> {
        let conn = self.conn.lock().unwrap();

        // First try to get the default config
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM embedding_configs WHERE is_default = 1"
        )?;

        let result = stmt.query_row([], |row| {
            Ok(EmbeddingConfig {
                id: row.get(0)?,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        });

        match result {
            Ok(config) => Ok(Some(config)),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Fallback: return first config if no default is set
                let mut stmt = conn.prepare(
                    "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM embedding_configs ORDER BY sort_order LIMIT 1"
                )?;
                let fallback = stmt.query_row([], |row| {
                    Ok(EmbeddingConfig {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        base_url: row.get(2)?,
                        api_key: row.get(3)?,
                        model: row.get(4)?,
                        sort_order: row.get(5)?,
                        is_default: row.get::<_, i64>(6)? != 0,
                    })
                });
                match fallback {
                    Ok(config) => Ok(Some(config)),
                    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                    Err(e) => Err(e),
                }
            }
            Err(e) => Err(e),
        }
    }

    pub fn create_embedding_config(&self, config: &EmbeddingConfig) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();

        // Check if this is the first config - auto-set as default
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM embedding_configs",
            [],
            |row| row.get(0),
        )?;
        let is_default = if count == 0 { 1 } else { config.is_default as i32 };

        conn.execute(
            "INSERT INTO embedding_configs (title, base_url, api_key, model, sort_order, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (&config.title, &config.base_url, &config.api_key, &config.model, config.sort_order, is_default),
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_embedding_config(&self, config: &EmbeddingConfig) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE embedding_configs SET title = ?1, base_url = ?2, api_key = ?3, model = ?4, sort_order = ?5, is_default = ?6 WHERE id = ?7",
            (&config.title, &config.base_url, &config.api_key, &config.model, config.sort_order, config.is_default as i32, config.id),
        )?;
        Ok(())
    }

    pub fn set_default_embedding_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE embedding_configs SET is_default = 0", [])?;
        conn.execute("UPDATE embedding_configs SET is_default = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn unset_default_embedding_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE embedding_configs SET is_default = 0 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete_embedding_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        // Check if deleting the default config
        let is_default: i64 = conn.query_row(
            "SELECT is_default FROM embedding_configs WHERE id = ?1",
            [id],
            |row| row.get(0),
        ).unwrap_or(0);

        conn.execute("DELETE FROM embedding_configs WHERE id = ?1", [id])?;

        // If deleted config was default, set another one as default
        if is_default != 0 {
            conn.execute(
                "UPDATE embedding_configs SET is_default = 1 WHERE id = (SELECT id FROM embedding_configs ORDER BY sort_order LIMIT 1)",
                [],
            )?;
        }
        Ok(())
    }

    // Reranker Config CRUD
    pub fn get_all_reranker_configs(&self) -> SqliteResult<Vec<RerankerConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM reranker_configs ORDER BY is_default DESC, sort_order"
        )?;

        let configs = stmt.query_map([], |row| {
            Ok(RerankerConfig {
                id: row.get(0)?,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        })?;

        configs.collect()
    }

    pub fn get_default_reranker_config(&self) -> SqliteResult<Option<RerankerConfig>> {
        let conn = self.conn.lock().unwrap();

        // First try to get the default config
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM reranker_configs WHERE is_default = 1"
        )?;

        let result = stmt.query_row([], |row| {
            Ok(RerankerConfig {
                id: row.get(0)?,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        });

        match result {
            Ok(config) => Ok(Some(config)),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Fallback: return first config if no default is set
                let mut stmt = conn.prepare(
                    "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM reranker_configs ORDER BY sort_order LIMIT 1"
                )?;
                let fallback = stmt.query_row([], |row| {
                    Ok(RerankerConfig {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        base_url: row.get(2)?,
                        api_key: row.get(3)?,
                        model: row.get(4)?,
                        sort_order: row.get(5)?,
                        is_default: row.get::<_, i64>(6)? != 0,
                    })
                });
                match fallback {
                    Ok(config) => Ok(Some(config)),
                    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                    Err(e) => Err(e),
                }
            }
            Err(e) => Err(e),
        }
    }

    pub fn create_reranker_config(&self, config: &RerankerConfig) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();

        // Check if this is the first config - auto-set as default
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM reranker_configs",
            [],
            |row| row.get(0),
        )?;
        let is_default = if count == 0 { 1 } else { config.is_default as i32 };

        conn.execute(
            "INSERT INTO reranker_configs (title, base_url, api_key, model, sort_order, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (&config.title, &config.base_url, &config.api_key, &config.model, config.sort_order, is_default),
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_reranker_config(&self, config: &RerankerConfig) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE reranker_configs SET title = ?1, base_url = ?2, api_key = ?3, model = ?4, sort_order = ?5, is_default = ?6 WHERE id = ?7",
            (&config.title, &config.base_url, &config.api_key, &config.model, config.sort_order, config.is_default as i32, config.id),
        )?;
        Ok(())
    }

    pub fn set_default_reranker_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE reranker_configs SET is_default = 0", [])?;
        conn.execute("UPDATE reranker_configs SET is_default = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn unset_default_reranker_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE reranker_configs SET is_default = 0 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete_reranker_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        // Check if deleting the default config
        let is_default: i64 = conn.query_row(
            "SELECT is_default FROM reranker_configs WHERE id = ?1",
            [id],
            |row| row.get(0),
        ).unwrap_or(0);

        conn.execute("DELETE FROM reranker_configs WHERE id = ?1", [id])?;

        // If deleted config was default, set another one as default
        if is_default != 0 {
            conn.execute(
                "UPDATE reranker_configs SET is_default = 1 WHERE id = (SELECT id FROM reranker_configs ORDER BY sort_order LIMIT 1)",
                [],
            )?;
        }
        Ok(())
    }
}
