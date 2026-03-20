use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, Result as SqliteResult};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::snowflake;

const INIT_SQL: &str = include_str!("sql/init.sql");

/// API 密钥已迁移到系统密钥环的占位符
pub const API_KEY_MIGRATED_PLACEHOLDER: &str = "***MIGRATED***";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiConfig {
    pub id: String,
    pub title: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub sort_order: i32,
    pub is_default: bool,
    pub concurrent_limit: i32,
    pub request_timeout: i32, // 请求超时时间（秒），0表示不设置超时，范围0-600，默认180
    pub rate_limit: i32,      // 速率限制（每分钟请求次数），0表示不限制，范围0-1000，默认60
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub theme: String,
    pub tray_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub video_path: String,
    pub subtitle_path: Option<String>,
    pub model_id: Option<String>, // AI model ID used for generating notes
    pub init_status: i32, // Initialization status: 0=not started, 1-6=step completed, 7=fully initialized
    pub full_summary: Option<String>,
    pub detailed_reading: Option<String>,
    pub highlights: Option<String>,
    pub visual_summary: Option<String>,
    pub custom_summary: Option<String>,
    pub ai_note_markdown: Option<String>,
    pub ai_note_meta: Option<String>,
    pub flashcards: Option<String>, // JSON string of flashcard data
    pub panoramic_blueprint: Option<String>, // Panoramic depth reconstruction blueprint (markdown)
    pub quick_notes: Option<String>, // User's quick notes (markdown)
    pub quick_notes_mindmap: Option<String>, // User's mindmap data (JSON)
    pub quick_notes_canvas: Option<String>, // User's canvas data (JSON)
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
    pub model_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateNoteMetadataRequest {
    pub id: String,
    pub title: String,
    pub video_path: String,
    pub subtitle_path: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubtitleChunk {
    pub id: String,
    pub note_id: String,
    pub chunk_index: i32,
    pub start_time: f64,
    pub end_time: f64,
    pub content: String,
    pub embedding: Option<Vec<u8>>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KnowledgeChunk {
    pub id: String,
    pub note_id: String,
    pub chunk_index: i32,
    pub content: String,
    pub embedding: Option<Vec<u8>>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KnowledgeIndexStatus {
    pub note_id: String,
    pub status: String,
    pub chunk_count: i32,
    pub content_hash: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmbeddingConfig {
    pub id: String,
    pub title: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub sort_order: i32,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RerankerConfig {
    pub id: String,
    pub title: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub sort_order: i32,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptConfig {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub content: String,
    pub category: String,
    pub recommended_model_id: Option<String>,
    pub sort_order: i32,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// 优化后的字幕缓存
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OptimizedSubtitle {
    pub id: String,
    pub note_id: String,
    pub chapter_id: String,
    pub optimized_text: String,
    pub created_at: String,
}

/// 笔记的 UI 状态（用于恢复页面状态）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteUiState {
    pub note_id: String,
    pub show_subtitles: bool,
    pub subtitle_optimization_enabled: bool,
}

/// 截图标记（用于辅助模式章节分段）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScreenshotMarker {
    pub id: String,
    pub note_id: String,
    pub subtitle_index: i32,
    pub timestamp: f64,
    pub screenshot_path: String,
    pub created_at: String,
}

/// 合集（资源库）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub sort_order: i32,
    pub item_count: i32,  // 查询时计算
    pub cover_image: Option<String>,  // 封面图片路径
    pub first_item_cover: Option<String>,  // 第一个子合集或笔记的封面（用于无封面时的默认显示）
    pub created_at: String,
    pub updated_at: String,
}

/// 创建合集请求
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateCollectionRequest {
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
}

/// 合集内容关联
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionItem {
    pub id: String,
    pub collection_id: String,
    pub note_id: String,
    pub sort_order: i32,
    pub created_at: String,
}

pub struct Database {
    pub pool: Pool<SqliteConnectionManager>,
}

// Helper type for pooled connection
pub type DbConnection = r2d2::PooledConnection<SqliteConnectionManager>;

impl Database {
    /// 获取数据库连接（从池中）
    pub fn connection(&self) -> DbConnection {
        self.pool.get().expect("Failed to get connection from pool")
    }
}

impl std::fmt::Debug for Database {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").finish()
    }
}

impl Database {
    pub fn new(db_dir: PathBuf) -> SqliteResult<Self> {
        std::fs::create_dir_all(&db_dir).ok();
        let db_path = db_dir.join("vnote.db");

        let manager = SqliteConnectionManager::file(&db_path)
            .with_init(|c| {
                c.execute_batch("
                    PRAGMA journal_mode=WAL;
                    PRAGMA synchronous=NORMAL;
                    PRAGMA foreign_keys=ON;
                    PRAGMA busy_timeout=5000;
                ")
            });

        let pool = r2d2::Pool::builder()
            .max_size(10)
            .build(manager)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let db = Self {
            pool,
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute_batch(INIT_SQL)?;
        Ok(())
    }

    // AI Config CRUD
    pub fn get_all_ai_configs(&self) -> SqliteResult<Vec<AiConfig>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default, concurrent_limit, request_timeout, rate_limit FROM ai_configs ORDER BY is_default DESC, sort_order"
        )?;

        let configs = stmt.query_map([], |row| {
            let config_id: String = row.get(0)?;
            let db_api_key: String = row.get(3)?;

            // Try to get API key from keyring first
            let api_key = crate::keyring_manager::get_api_key(
                crate::keyring_manager::KeyType::AiConfig,
                &config_id,
            ).unwrap_or_else(|_| {
                // If keyring fails, check if we need to migrate from database
                if !db_api_key.is_empty() && db_api_key != API_KEY_MIGRATED_PLACEHOLDER {
                    // Try to migrate to keyring
                    let _ = crate::keyring_manager::store_api_key(
                        crate::keyring_manager::KeyType::AiConfig,
                        &config_id,
                        &db_api_key,
                    );
                }
                db_api_key
            });

            Ok(AiConfig {
                id: config_id,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
                concurrent_limit: row.get(7)?,
                request_timeout: row.get(8)?,
                rate_limit: row.get(9)?,
            })
        })?;

        configs.collect()
    }

    pub fn create_ai_config(&self, config: &AiConfig) -> SqliteResult<String> {
        let conn = self.connection();
        let new_id = snowflake::generate_id_string();

        // Check if this is the first config - auto-set as default
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM ai_configs",
            [],
            |row| row.get(0),
        )?;
        let is_default = if count == 0 { 1 } else { config.is_default as i32 };

        // Store API key to keyring, use placeholder in database
        let db_api_key = if crate::keyring_manager::is_keyring_available() {
            API_KEY_MIGRATED_PLACEHOLDER
        } else {
            &config.api_key
        };

        conn.execute(
            "INSERT INTO ai_configs (id, title, base_url, api_key, model, sort_order, is_default, concurrent_limit, request_timeout, rate_limit) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            (&new_id, &config.title, &config.base_url, db_api_key, &config.model, config.sort_order, is_default, config.concurrent_limit, config.request_timeout, config.rate_limit),
        )?;

        // Store API key to keyring
        if crate::keyring_manager::is_keyring_available() {
            let _ = crate::keyring_manager::store_api_key(
                crate::keyring_manager::KeyType::AiConfig,
                &new_id,
                &config.api_key,
            );
        }

        Ok(new_id)
    }

    pub fn update_ai_config(&self, config: &AiConfig) -> SqliteResult<()> {
        let conn = self.connection();

        // Store API key to keyring, use placeholder in database
        let db_api_key = if crate::keyring_manager::is_keyring_available() {
            API_KEY_MIGRATED_PLACEHOLDER
        } else {
            &config.api_key
        };

        conn.execute(
            "UPDATE ai_configs SET title = ?1, base_url = ?2, api_key = ?3, model = ?4, sort_order = ?5, is_default = ?6, concurrent_limit = ?7, request_timeout = ?8, rate_limit = ?9 WHERE id = ?10",
            (&config.title, &config.base_url, db_api_key, &config.model, config.sort_order, config.is_default as i32, config.concurrent_limit, config.request_timeout, config.rate_limit, &config.id),
        )?;

        // Update API key in keyring
        if crate::keyring_manager::is_keyring_available() {
            let _ = crate::keyring_manager::store_api_key(
                crate::keyring_manager::KeyType::AiConfig,
                &config.id,
                &config.api_key,
            );
        }

        Ok(())
    }

    pub fn set_default_ai_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        // First, unset all defaults
        conn.execute("UPDATE ai_configs SET is_default = 0", [])?;
        // Then set the specified config as default
        conn.execute("UPDATE ai_configs SET is_default = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn unset_default_ai_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("UPDATE ai_configs SET is_default = 0 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get_default_ai_config(&self) -> SqliteResult<Option<AiConfig>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default, concurrent_limit, request_timeout, rate_limit
             FROM ai_configs WHERE is_default = 1 LIMIT 1"
        )?;
        let result = stmt.query_row([], |row| {
            let config_id: String = row.get(0)?;
            let db_api_key: String = row.get(3)?;
            let api_key = crate::keyring_manager::get_api_key(
                crate::keyring_manager::KeyType::AiConfig,
                &config_id,
            ).unwrap_or(db_api_key);
            Ok(AiConfig {
                id: config_id,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
                concurrent_limit: row.get(7)?,
                request_timeout: row.get(8)?,
                rate_limit: row.get(9)?,
            })
        }).optional()?;
        Ok(result)
    }

    pub fn delete_ai_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM ai_configs WHERE id = ?1", [id])?;

        // Delete API key from keyring
        let _ = crate::keyring_manager::delete_api_key(
            crate::keyring_manager::KeyType::AiConfig,
            id,
        );

        Ok(())
    }

    // App Settings
    pub fn get_setting(&self, key: &str) -> SqliteResult<Option<String>> {
        let conn = self.connection();
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let result = stmt.query_row([key], |row| row.get(0));

        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.connection();
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

    // App Settings CRUD
    pub fn get_app_setting(&self, key: &str) -> SqliteResult<Option<String>> {
        let conn = self.connection();
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;

        let result = stmt.query_row([key], |row| row.get(0));

        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_app_setting(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;
        Ok(())
    }

    // Notes CRUD
    pub fn get_all_notes(&self) -> SqliteResult<Vec<Note>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, video_path, subtitle_path, model_id, init_status, full_summary, detailed_reading,
                    highlights, visual_summary, custom_summary, ai_note_markdown, ai_note_meta, flashcards,
                    panoramic_blueprint, quick_notes, quick_notes_mindmap, quick_notes_canvas,
                    suggested_questions, last_playback_position, created_at, updated_at
             FROM notes ORDER BY created_at DESC, rowid DESC"
        )?;

        let notes = stmt.query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                video_path: row.get(2)?,
                subtitle_path: row.get(3)?,
                model_id: row.get(4)?,
                init_status: row.get(5)?,
                full_summary: row.get(6)?,
                detailed_reading: row.get(7)?,
                highlights: row.get(8)?,
                visual_summary: row.get(9)?,
                custom_summary: row.get(10)?,
                ai_note_markdown: row.get(11)?,
                ai_note_meta: row.get(12)?,
                flashcards: row.get(13)?,
                panoramic_blueprint: row.get(14)?,
                quick_notes: row.get(15)?,
                quick_notes_mindmap: row.get(16)?,
                quick_notes_canvas: row.get(17)?,
                suggested_questions: row.get(18)?,
                last_playback_position: row.get(19)?,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        })?;

        notes.collect()
    }

    pub fn get_note_by_id(&self, id: &str) -> SqliteResult<Option<Note>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, video_path, subtitle_path, model_id, init_status, full_summary, detailed_reading,
                    highlights, visual_summary, custom_summary, ai_note_markdown, ai_note_meta, flashcards,
                    panoramic_blueprint, quick_notes, quick_notes_mindmap, quick_notes_canvas,
                    suggested_questions, last_playback_position, created_at, updated_at
             FROM notes WHERE id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                video_path: row.get(2)?,
                subtitle_path: row.get(3)?,
                model_id: row.get(4)?,
                init_status: row.get(5)?,
                full_summary: row.get(6)?,
                detailed_reading: row.get(7)?,
                highlights: row.get(8)?,
                visual_summary: row.get(9)?,
                custom_summary: row.get(10)?,
                ai_note_markdown: row.get(11)?,
                ai_note_meta: row.get(12)?,
                flashcards: row.get(13)?,
                panoramic_blueprint: row.get(14)?,
                quick_notes: row.get(15)?,
                quick_notes_mindmap: row.get(16)?,
                quick_notes_canvas: row.get(17)?,
                suggested_questions: row.get(18)?,
                last_playback_position: row.get(19)?,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        });

        match result {
            Ok(note) => Ok(Some(note)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn create_note(&self, req: &CreateNoteRequest) -> SqliteResult<Note> {
        let conn = self.connection();
        let new_id = snowflake::generate_id_string();

        conn.execute(
            "INSERT INTO notes (id, title, video_path, subtitle_path, model_id, init_status) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            (&new_id, &req.title, &req.video_path, &req.subtitle_path, &req.model_id),
        )?;

        // Return the created note
        let mut stmt = conn.prepare(
            "SELECT id, title, video_path, subtitle_path, model_id, init_status, full_summary, detailed_reading,
                    highlights, visual_summary, custom_summary, ai_note_markdown, ai_note_meta, flashcards,
                    panoramic_blueprint, quick_notes, quick_notes_mindmap, quick_notes_canvas,
                    suggested_questions, last_playback_position, created_at, updated_at
             FROM notes WHERE id = ?1"
        )?;

        stmt.query_row([&new_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                video_path: row.get(2)?,
                subtitle_path: row.get(3)?,
                model_id: row.get(4)?,
                init_status: row.get(5)?,
                full_summary: row.get(6)?,
                detailed_reading: row.get(7)?,
                highlights: row.get(8)?,
                visual_summary: row.get(9)?,
                custom_summary: row.get(10)?,
                ai_note_markdown: row.get(11)?,
                ai_note_meta: row.get(12)?,
                flashcards: row.get(13)?,
                panoramic_blueprint: row.get(14)?,
                quick_notes: row.get(15)?,
                quick_notes_mindmap: row.get(16)?,
                quick_notes_canvas: row.get(17)?,
                suggested_questions: row.get(18)?,
                last_playback_position: row.get(19)?,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        })
    }

    pub fn update_note(&self, note: &Note) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE notes SET
                title = ?1, video_path = ?2, subtitle_path = ?3, model_id = ?4,
                init_status = ?5, full_summary = ?6, detailed_reading = ?7, highlights = ?8,
                visual_summary = ?9, custom_summary = ?10, ai_note_markdown = ?11,
                ai_note_meta = ?12, flashcards = ?13, panoramic_blueprint = ?14, quick_notes = ?15,
                quick_notes_mindmap = ?16, quick_notes_canvas = ?17, suggested_questions = ?18,
                last_playback_position = ?19,
                updated_at = datetime('now', 'localtime')
             WHERE id = ?20",
            rusqlite::params![
                &note.title, &note.video_path, &note.subtitle_path, &note.model_id,
                note.init_status, &note.full_summary, &note.detailed_reading, &note.highlights,
                &note.visual_summary, &note.custom_summary, &note.ai_note_markdown,
                &note.ai_note_meta, &note.flashcards, &note.panoramic_blueprint, &note.quick_notes,
                &note.quick_notes_mindmap, &note.quick_notes_canvas, &note.suggested_questions,
                &note.last_playback_position,
                note.id,
            ],
        )?;
        Ok(())
    }

    pub fn update_note_metadata(&self, req: &UpdateNoteMetadataRequest) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE notes SET title = ?1, video_path = ?2, subtitle_path = ?3, model_id = ?4, updated_at = datetime('now', 'localtime') WHERE id = ?5",
            rusqlite::params![&req.title, &req.video_path, &req.subtitle_path, &req.model_id, &req.id],
        )?;
        Ok(())
    }

    pub fn update_playback_position(&self, note_id: &str, position: f64) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE notes SET last_playback_position = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2",
            rusqlite::params![position, note_id],
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn update_note_questions(&self, note_id: &str, questions_json: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE notes SET suggested_questions = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2",
            [questions_json, note_id],
        )?;
        Ok(())
    }

    /// Update note initialization status (0-6)
    pub fn update_note_init_status(&self, note_id: &str, status: i32) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE notes SET init_status = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2",
            rusqlite::params![status, note_id],
        )?;
        Ok(())
    }

    /// Get notes with incomplete initialization (init_status < 7 and has model_id)
    /// This includes notes that haven't started (status=0) and notes in progress (status=1-6)
    pub fn get_incomplete_notes(&self) -> SqliteResult<Vec<Note>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, video_path, subtitle_path, model_id, init_status, full_summary, detailed_reading,
                    highlights, visual_summary, custom_summary, ai_note_markdown, ai_note_meta, flashcards,
                    panoramic_blueprint, quick_notes, quick_notes_mindmap, quick_notes_canvas,
                    suggested_questions, last_playback_position, created_at, updated_at
             FROM notes WHERE init_status < 7 AND model_id IS NOT NULL ORDER BY created_at ASC, rowid ASC"
        )?;

        let notes = stmt.query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                video_path: row.get(2)?,
                subtitle_path: row.get(3)?,
                model_id: row.get(4)?,
                init_status: row.get(5)?,
                full_summary: row.get(6)?,
                detailed_reading: row.get(7)?,
                highlights: row.get(8)?,
                visual_summary: row.get(9)?,
                custom_summary: row.get(10)?,
                ai_note_markdown: row.get(11)?,
                ai_note_meta: row.get(12)?,
                flashcards: row.get(13)?,
                panoramic_blueprint: row.get(14)?,
                quick_notes: row.get(15)?,
                quick_notes_mindmap: row.get(16)?,
                quick_notes_canvas: row.get(17)?,
                suggested_questions: row.get(18)?,
                last_playback_position: row.get(19)?,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        })?;

        notes.collect()
    }

    // Get AI config by ID
    pub fn get_ai_config_by_id(&self, id: &str) -> SqliteResult<Option<AiConfig>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default, concurrent_limit, request_timeout, rate_limit FROM ai_configs WHERE id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            let config_id: String = row.get(0)?;
            let db_api_key: String = row.get(3)?;

            // Try to get API key from keyring first
            let api_key = crate::keyring_manager::get_api_key(
                crate::keyring_manager::KeyType::AiConfig,
                &config_id,
            ).unwrap_or_else(|_| {
                // If keyring fails, check if we need to migrate from database
                if !db_api_key.is_empty() && db_api_key != API_KEY_MIGRATED_PLACEHOLDER {
                    // Try to migrate to keyring
                    let _ = crate::keyring_manager::store_api_key(
                        crate::keyring_manager::KeyType::AiConfig,
                        &config_id,
                        &db_api_key,
                    );
                }
                db_api_key
            });

            Ok(AiConfig {
                id: config_id,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
                concurrent_limit: row.get(7)?,
                request_timeout: row.get(8)?,
                rate_limit: row.get(9)?,
            })
        });

        match result {
            Ok(config) => Ok(Some(config)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    // Subtitle Chunks CRUD
    pub fn get_subtitle_chunks(&self, note_id: &str) -> SqliteResult<Vec<SubtitleChunk>> {
        let conn = self.connection();
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
        note_id: &str,
        chunk_index: i32,
        start_time: f64,
        end_time: f64,
        content: &str,
        embedding: Option<&[u8]>,
    ) -> SqliteResult<String> {
        let conn = self.connection();
        let new_id = snowflake::generate_id_string();
        conn.execute(
            "INSERT INTO subtitle_chunks (id, note_id, chunk_index, start_time, end_time, content, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![new_id, note_id, chunk_index, start_time, end_time, content, embedding],
        )?;
        Ok(new_id)
    }

    pub fn delete_subtitle_chunks(&self, note_id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM subtitle_chunks WHERE note_id = ?1", [note_id])?;
        Ok(())
    }

    // Subtitle index status management
    pub fn get_index_status(&self, note_id: &str) -> SqliteResult<Option<String>> {
        let conn = self.connection();
        let mut stmt = conn.prepare("SELECT status FROM subtitle_index_status WHERE note_id = ?1")?;
        let result = stmt.query_row([note_id], |row| row.get(0)).optional()?;
        Ok(result)
    }

    pub fn set_index_status(&self, note_id: &str, status: &str, error_message: Option<&str>) -> SqliteResult<()> {
        let conn = self.connection();

        if status == "indexing" {
            conn.execute(
                "INSERT OR REPLACE INTO subtitle_index_status (note_id, status, started_at, completed_at, error_message)
                 VALUES (?1, ?2, datetime('now', 'localtime'), NULL, NULL)",
                rusqlite::params![note_id, status],
            )?;
        } else if status == "completed" {
            conn.execute(
                "UPDATE subtitle_index_status
                 SET status = ?2, completed_at = datetime('now', 'localtime'), error_message = NULL
                 WHERE note_id = ?1",
                rusqlite::params![note_id, status],
            )?;
        } else if status == "failed" {
            conn.execute(
                "UPDATE subtitle_index_status
                 SET status = ?2, completed_at = datetime('now', 'localtime'), error_message = ?3
                 WHERE note_id = ?1",
                rusqlite::params![note_id, status, error_message],
            )?;
        }

        Ok(())
    }

    pub fn get_index_started_at(&self, note_id: &str) -> SqliteResult<Option<String>> {
        let conn = self.connection();
        let mut stmt = conn.prepare("SELECT started_at FROM subtitle_index_status WHERE note_id = ?1")?;
        let result = stmt.query_row([note_id], |row| row.get(0)).optional()?;
        Ok(result)
    }

    pub fn delete_index_status(&self, note_id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM subtitle_index_status WHERE note_id = ?1", [note_id])?;
        Ok(())
    }


    // Embedding Config CRUD
    pub fn get_all_embedding_configs(&self) -> SqliteResult<Vec<EmbeddingConfig>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM embedding_configs ORDER BY is_default DESC, sort_order"
        )?;

        let configs = stmt.query_map([], |row| {
            let config_id: String = row.get(0)?;
            let db_api_key: String = row.get(3)?;

            let api_key = crate::keyring_manager::get_api_key(
                crate::keyring_manager::KeyType::EmbeddingConfig,
                &config_id,
            ).unwrap_or_else(|_| {
                if !db_api_key.is_empty() && db_api_key != API_KEY_MIGRATED_PLACEHOLDER {
                    let _ = crate::keyring_manager::store_api_key(
                        crate::keyring_manager::KeyType::EmbeddingConfig,
                        &config_id,
                        &db_api_key,
                    );
                }
                db_api_key
            });

            Ok(EmbeddingConfig {
                id: config_id,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        })?;

        configs.collect()
    }

    pub fn get_default_embedding_config(&self) -> SqliteResult<Option<EmbeddingConfig>> {
        let conn = self.connection();

        // First try to get the default config
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM embedding_configs WHERE is_default = 1"
        )?;

        let result = stmt.query_row([], |row| {
            let config_id: String = row.get(0)?;
            let db_api_key: String = row.get(3)?;

            // Try to get API key from keyring first
            let api_key = crate::keyring_manager::get_api_key(
                crate::keyring_manager::KeyType::EmbeddingConfig,
                &config_id,
            ).unwrap_or_else(|_| {
                if !db_api_key.is_empty() && db_api_key != API_KEY_MIGRATED_PLACEHOLDER {
                    let _ = crate::keyring_manager::store_api_key(
                        crate::keyring_manager::KeyType::EmbeddingConfig,
                        &config_id,
                        &db_api_key,
                    );
                }
                db_api_key
            });

            Ok(EmbeddingConfig {
                id: config_id,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key,
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
                    let config_id: String = row.get(0)?;
                    let db_api_key: String = row.get(3)?;

                    // Try to get API key from keyring first
                    let api_key = crate::keyring_manager::get_api_key(
                        crate::keyring_manager::KeyType::EmbeddingConfig,
                        &config_id,
                    ).unwrap_or_else(|_| {
                        // If keyring fails, check if we need to migrate from database
                        if !db_api_key.is_empty() && db_api_key != API_KEY_MIGRATED_PLACEHOLDER {
                            // Try to migrate to keyring
                            let _ = crate::keyring_manager::store_api_key(
                                crate::keyring_manager::KeyType::EmbeddingConfig,
                                &config_id,
                                &db_api_key,
                            );
                        }
                        db_api_key
                    });

                    Ok(EmbeddingConfig {
                        id: config_id,
                        title: row.get(1)?,
                        base_url: row.get(2)?,
                        api_key,
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

    pub fn create_embedding_config(&self, config: &EmbeddingConfig) -> SqliteResult<String> {
        let conn = self.connection();
        let new_id = crate::snowflake::generate_id_string();

        // Check if this is the first config - auto-set as default
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM embedding_configs",
            [],
            |row| row.get(0),
        )?;
        let is_default = if count == 0 { 1 } else { config.is_default as i32 };

        // Store API key to keyring, use placeholder in database
        let db_api_key = if crate::keyring_manager::is_keyring_available() {
            API_KEY_MIGRATED_PLACEHOLDER
        } else {
            &config.api_key
        };

        conn.execute(
            "INSERT INTO embedding_configs (id, title, base_url, api_key, model, sort_order, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (&new_id, &config.title, &config.base_url, db_api_key, &config.model, config.sort_order, is_default),
        )?;

        // Store API key to keyring
        if crate::keyring_manager::is_keyring_available() {
            let _ = crate::keyring_manager::store_api_key(
                crate::keyring_manager::KeyType::EmbeddingConfig,
                &new_id,
                &config.api_key,
            );
        }

        Ok(new_id)
    }

    pub fn update_embedding_config(&self, config: &EmbeddingConfig) -> SqliteResult<()> {
        let conn = self.connection();

        // Store API key to keyring, use placeholder in database
        let db_api_key = if crate::keyring_manager::is_keyring_available() {
            API_KEY_MIGRATED_PLACEHOLDER
        } else {
            &config.api_key
        };

        conn.execute(
            "UPDATE embedding_configs SET title = ?1, base_url = ?2, api_key = ?3, model = ?4, sort_order = ?5, is_default = ?6 WHERE id = ?7",
            (&config.title, &config.base_url, db_api_key, &config.model, config.sort_order, config.is_default as i32, &config.id),
        )?;

        // Update API key in keyring
        if crate::keyring_manager::is_keyring_available() {
            let _ = crate::keyring_manager::store_api_key(
                crate::keyring_manager::KeyType::EmbeddingConfig,
                &config.id,
                &config.api_key,
            );
        }

        Ok(())
    }

    pub fn set_default_embedding_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("UPDATE embedding_configs SET is_default = 0", [])?;
        conn.execute("UPDATE embedding_configs SET is_default = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn unset_default_embedding_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("UPDATE embedding_configs SET is_default = 0 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete_embedding_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();

        let is_default: i64 = conn.query_row(
            "SELECT is_default FROM embedding_configs WHERE id = ?1",
            [id],
            |row| row.get(0),
        ).unwrap_or(0);

        conn.execute("DELETE FROM embedding_configs WHERE id = ?1", [id])?;

        let _ = crate::keyring_manager::delete_api_key(
            crate::keyring_manager::KeyType::EmbeddingConfig,
            id,
        );

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
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM reranker_configs ORDER BY is_default DESC, sort_order"
        )?;

        let configs = stmt.query_map([], |row| {
            let config_id: String = row.get(0)?;
            let db_api_key: String = row.get(3)?;

            // Try to get API key from keyring first
            let api_key = crate::keyring_manager::get_api_key(
                crate::keyring_manager::KeyType::RerankerConfig,
                &config_id,
            ).unwrap_or_else(|_| {
                if !db_api_key.is_empty() && db_api_key != API_KEY_MIGRATED_PLACEHOLDER {
                    let _ = crate::keyring_manager::store_api_key(
                        crate::keyring_manager::KeyType::RerankerConfig,
                        &config_id,
                        &db_api_key,
                    );
                }
                db_api_key
            });

            Ok(RerankerConfig {
                id: config_id,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key,
                model: row.get(4)?,
                sort_order: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        })?;

        configs.collect()
    }

    pub fn get_default_reranker_config(&self) -> SqliteResult<Option<RerankerConfig>> {
        let conn = self.connection();

        // First try to get the default config
        let mut stmt = conn.prepare(
            "SELECT id, title, base_url, api_key, model, sort_order, is_default FROM reranker_configs WHERE is_default = 1"
        )?;

        let result = stmt.query_row([], |row| {
            let config_id: String = row.get(0)?;
            let db_api_key: String = row.get(3)?;

            // Try to get API key from keyring first
            let api_key = crate::keyring_manager::get_api_key(
                crate::keyring_manager::KeyType::RerankerConfig,
                &config_id,
            ).unwrap_or_else(|_| {
                if !db_api_key.is_empty() && db_api_key != API_KEY_MIGRATED_PLACEHOLDER {
                    let _ = crate::keyring_manager::store_api_key(
                        crate::keyring_manager::KeyType::RerankerConfig,
                        &config_id,
                        &db_api_key,
                    );
                }
                db_api_key
            });

            Ok(RerankerConfig {
                id: config_id,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key,
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
                    let config_id: String = row.get(0)?;
                    let db_api_key: String = row.get(3)?;

                    // Try to get API key from keyring first
                    let api_key = crate::keyring_manager::get_api_key(
                        crate::keyring_manager::KeyType::RerankerConfig,
                        &config_id,
                    ).unwrap_or_else(|_| {
                        // If keyring fails, check if we need to migrate from database
                        if !db_api_key.is_empty() && db_api_key != API_KEY_MIGRATED_PLACEHOLDER {
                            // Try to migrate to keyring
                            let _ = crate::keyring_manager::store_api_key(
                                crate::keyring_manager::KeyType::RerankerConfig,
                                &config_id,
                                &db_api_key,
                            );
                        }
                        db_api_key
                    });

                    Ok(RerankerConfig {
                        id: config_id,
                        title: row.get(1)?,
                        base_url: row.get(2)?,
                        api_key,
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

    pub fn create_reranker_config(&self, config: &RerankerConfig) -> SqliteResult<String> {
        let conn = self.connection();
        let new_id = crate::snowflake::generate_id_string();

        // Check if this is the first config - auto-set as default
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM reranker_configs",
            [],
            |row| row.get(0),
        )?;
        let is_default = if count == 0 { 1 } else { config.is_default as i32 };

        // Store API key to keyring, use placeholder in database
        let db_api_key = if crate::keyring_manager::is_keyring_available() {
            API_KEY_MIGRATED_PLACEHOLDER
        } else {
            &config.api_key
        };

        conn.execute(
            "INSERT INTO reranker_configs (id, title, base_url, api_key, model, sort_order, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (&new_id, &config.title, &config.base_url, db_api_key, &config.model, config.sort_order, is_default),
        )?;

        // Store API key to keyring
        if crate::keyring_manager::is_keyring_available() {
            let _ = crate::keyring_manager::store_api_key(
                crate::keyring_manager::KeyType::RerankerConfig,
                &new_id,
                &config.api_key,
            );
        }

        Ok(new_id)
    }

    pub fn update_reranker_config(&self, config: &RerankerConfig) -> SqliteResult<()> {
        let conn = self.connection();

        // Store API key to keyring, use placeholder in database
        let db_api_key = if crate::keyring_manager::is_keyring_available() {
            API_KEY_MIGRATED_PLACEHOLDER
        } else {
            &config.api_key
        };

        conn.execute(
            "UPDATE reranker_configs SET title = ?1, base_url = ?2, api_key = ?3, model = ?4, sort_order = ?5, is_default = ?6 WHERE id = ?7",
            (&config.title, &config.base_url, db_api_key, &config.model, config.sort_order, config.is_default as i32, &config.id),
        )?;

        // Update API key in keyring
        if crate::keyring_manager::is_keyring_available() {
            let _ = crate::keyring_manager::store_api_key(
                crate::keyring_manager::KeyType::RerankerConfig,
                &config.id,
                &config.api_key,
            );
        }

        Ok(())
    }

    pub fn set_default_reranker_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("UPDATE reranker_configs SET is_default = 0", [])?;
        conn.execute("UPDATE reranker_configs SET is_default = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn unset_default_reranker_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("UPDATE reranker_configs SET is_default = 0 WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete_reranker_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();

        let is_default: i64 = conn.query_row(
            "SELECT is_default FROM reranker_configs WHERE id = ?1",
            [id],
            |row| row.get(0),
        ).unwrap_or(0);

        conn.execute("DELETE FROM reranker_configs WHERE id = ?1", [id])?;

        let _ = crate::keyring_manager::delete_api_key(
            crate::keyring_manager::KeyType::RerankerConfig,
            id,
        );

        // If deleted config was default, set another one as default
        if is_default != 0 {
            conn.execute(
                "UPDATE reranker_configs SET is_default = 1 WHERE id = (SELECT id FROM reranker_configs ORDER BY sort_order LIMIT 1)",
                [],
            )?;
        }
        Ok(())
    }

    // Prompt Config CRUD
    pub fn get_all_prompt_configs(&self) -> SqliteResult<Vec<PromptConfig>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, description, content, category, recommended_model_id,
                    sort_order, is_default, created_at, updated_at
             FROM prompt_configs ORDER BY is_default DESC, updated_at DESC"
        )?;

        let configs = stmt.query_map([], |row| {
            Ok(PromptConfig {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                content: row.get(3)?,
                category: row.get(4)?,
                recommended_model_id: row.get(5)?,
                sort_order: row.get(6)?,
                is_default: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;

        configs.collect()
    }

    pub fn create_prompt_config(&self, config: &PromptConfig) -> SqliteResult<String> {
        let conn = self.connection();
        let new_id = snowflake::generate_id_string();
        conn.execute(
            "INSERT INTO prompt_configs (id, title, description, content, category, recommended_model_id, sort_order, is_default)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (
                &new_id,
                &config.title,
                &config.description,
                &config.content,
                &config.category,
                &config.recommended_model_id,
                config.sort_order,
                config.is_default as i32
            ),
        )?;
        Ok(new_id)
    }

    pub fn update_prompt_config(&self, config: &PromptConfig) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE prompt_configs SET
                title = ?1, description = ?2, content = ?3, category = ?4,
                recommended_model_id = ?5, sort_order = ?6, is_default = ?7,
                updated_at = datetime('now', 'localtime')
             WHERE id = ?8",
            (
                &config.title,
                &config.description,
                &config.content,
                &config.category,
                &config.recommended_model_id,
                config.sort_order,
                config.is_default as i32,
                &config.id
            ),
        )?;
        Ok(())
    }

    pub fn delete_prompt_config(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM prompt_configs WHERE id = ?1", [id])?;
        Ok(())
    }

    // Optimized Subtitles CRUD
    pub fn get_optimized_subtitles(&self, note_id: &str) -> SqliteResult<Vec<OptimizedSubtitle>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, chapter_id, optimized_text, created_at
             FROM optimized_subtitles WHERE note_id = ?1"
        )?;

        let subtitles = stmt.query_map([note_id], |row| {
            Ok(OptimizedSubtitle {
                id: row.get(0)?,
                note_id: row.get(1)?,
                chapter_id: row.get(2)?,
                optimized_text: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;

        subtitles.collect()
    }

    pub fn save_optimized_subtitle(
        &self,
        note_id: &str,
        chapter_id: &str,
        optimized_text: &str,
    ) -> SqliteResult<String> {
        let conn = self.connection();
        let new_id = snowflake::generate_id_string();
        conn.execute(
            "INSERT OR REPLACE INTO optimized_subtitles (id, note_id, chapter_id, optimized_text)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![new_id, note_id, chapter_id, optimized_text],
        )?;
        Ok(new_id)
    }

    pub fn delete_optimized_subtitles(&self, note_id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM optimized_subtitles WHERE note_id = ?1", [note_id])?;
        Ok(())
    }

    // Note UI State CRUD
    pub fn get_note_ui_state(&self, note_id: &str) -> SqliteResult<Option<NoteUiState>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT note_id, show_subtitles, subtitle_optimization_enabled
             FROM note_ui_state WHERE note_id = ?1"
        )?;

        let result = stmt.query_row([note_id], |row| {
            Ok(NoteUiState {
                note_id: row.get(0)?,
                show_subtitles: row.get::<_, i64>(1)? != 0,
                subtitle_optimization_enabled: row.get::<_, i64>(2)? != 0,
            })
        });

        match result {
            Ok(state) => Ok(Some(state)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn save_note_ui_state(
        &self,
        note_id: &str,
        show_subtitles: bool,
        subtitle_optimization_enabled: bool,
    ) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "INSERT OR REPLACE INTO note_ui_state (note_id, show_subtitles, subtitle_optimization_enabled)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![note_id, show_subtitles as i32, subtitle_optimization_enabled as i32],
        )?;
        Ok(())
    }

    // Screenshot Markers CRUD
    pub fn get_screenshot_markers(&self, note_id: &str) -> SqliteResult<Vec<ScreenshotMarker>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, subtitle_index, timestamp, screenshot_path, created_at
             FROM screenshot_markers WHERE note_id = ?1 ORDER BY subtitle_index"
        )?;

        let markers = stmt.query_map([note_id], |row| {
            Ok(ScreenshotMarker {
                id: row.get(0)?,
                note_id: row.get(1)?,
                subtitle_index: row.get(2)?,
                timestamp: row.get(3)?,
                screenshot_path: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;

        markers.collect()
    }

    pub fn save_screenshot_marker(&self, marker: &ScreenshotMarker) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "INSERT OR REPLACE INTO screenshot_markers (id, note_id, subtitle_index, timestamp, screenshot_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                &marker.id,
                marker.note_id,
                marker.subtitle_index,
                marker.timestamp,
                &marker.screenshot_path,
                &marker.created_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_screenshot_marker(&self, note_id: &str, marker_id: &str) -> SqliteResult<Option<ScreenshotMarker>> {
        let conn = self.connection();

        let mut stmt = conn.prepare(
            "SELECT id, note_id, subtitle_index, timestamp, screenshot_path, created_at
             FROM screenshot_markers WHERE note_id = ?1 AND id = ?2"
        )?;

        let marker = stmt.query_row(rusqlite::params![note_id, marker_id], |row| {
            Ok(ScreenshotMarker {
                id: row.get(0)?,
                note_id: row.get(1)?,
                subtitle_index: row.get(2)?,
                timestamp: row.get(3)?,
                screenshot_path: row.get(4)?,
                created_at: row.get(5)?,
            })
        });

        match marker {
            Ok(m) => {
                conn.execute(
                    "DELETE FROM screenshot_markers WHERE note_id = ?1 AND id = ?2",
                    rusqlite::params![note_id, marker_id],
                )?;
                Ok(Some(m))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn delete_all_screenshot_markers(&self, note_id: &str) -> SqliteResult<Vec<ScreenshotMarker>> {
        let markers = self.get_screenshot_markers(note_id)?;

        let conn = self.connection();
        conn.execute(
            "DELETE FROM screenshot_markers WHERE note_id = ?1",
            [note_id],
        )?;

        Ok(markers)
    }

    // Collection CRUD (合集/资源库)
    pub fn get_all_collections(&self) -> SqliteResult<Vec<Collection>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, c.description, c.parent_id, c.sort_order, c.cover_image, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM collection_items WHERE collection_id = c.id) as item_count
             FROM collections c
             ORDER BY c.sort_order, c.created_at"
        )?;

        let collections: Vec<Collection> = stmt.query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                parent_id: row.get(3)?,
                sort_order: row.get(4)?,
                cover_image: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                item_count: row.get(8)?,
                first_item_cover: None, // 稍后填充
            })
        })?.collect::<SqliteResult<Vec<_>>>()?;

        // 为每个合集计算 first_item_cover 和递归 item_count
        let mut result = collections;

        // 计算递归 item_count（包含所有子合集的笔记数）
        let recursive_counts = Self::calculate_recursive_item_counts(&result);
        for collection in &mut result {
            if let Some(&count) = recursive_counts.get(&collection.id) {
                collection.item_count = count;
            }
            collection.first_item_cover = self.get_first_item_cover_for_collection(&conn, &collection.id);
        }

        Ok(result)
    }

    /// 递归计算每个合集的总笔记数（包含所有子合集）
    fn calculate_recursive_item_counts(collections: &[Collection]) -> std::collections::HashMap<String, i32> {
        use std::collections::HashMap;

        let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
        let mut direct_counts: HashMap<String, i32> = HashMap::new();

        for c in collections {
            direct_counts.insert(c.id.clone(), c.item_count);
            if let Some(ref parent_id) = c.parent_id {
                children_map.entry(parent_id.clone()).or_default().push(c.id.clone());
            }
        }

        fn calc_total(id: &str, children_map: &HashMap<String, Vec<String>>, direct_counts: &HashMap<String, i32>, cache: &mut HashMap<String, i32>) -> i32 {
            if let Some(&cached) = cache.get(id) {
                return cached;
            }

            let mut total = *direct_counts.get(id).unwrap_or(&0);
            if let Some(children) = children_map.get(id) {
                for child_id in children {
                    total += calc_total(child_id, children_map, direct_counts, cache);
                }
            }
            cache.insert(id.to_string(), total);
            total
        }

        let mut result: HashMap<String, i32> = HashMap::new();
        for c in collections {
            calc_total(&c.id, &children_map, &direct_counts, &mut result);
        }
        result
    }

    /// 获取合集的第一个子项封面（子合集或笔记），支持递归查找
    fn get_first_item_cover_for_collection(&self, conn: &Connection, collection_id: &str) -> Option<String> {
        let first_child_collection: Option<(String, Option<String>, i32)> = conn
            .query_row(
                "SELECT id, cover_image, sort_order FROM collections WHERE parent_id = ?1 ORDER BY sort_order LIMIT 1",
                [collection_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();

        let first_note: Option<(Option<String>, i32)> = conn
            .query_row(
                "SELECT n.detailed_reading, ci.sort_order
                 FROM collection_items ci
                 JOIN notes n ON ci.note_id = n.id
                 WHERE ci.collection_id = ?1
                 ORDER BY ci.sort_order LIMIT 1",
                [collection_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        match (first_child_collection, first_note) {
            (Some((child_id, child_cover, child_order)), Some((note_reading, note_order))) => {
                if child_order <= note_order {
                    child_cover
                        .or_else(|| self.get_first_item_cover_for_collection(conn, &child_id))
                        .or_else(|| Self::extract_screenshot_from_detailed_reading(&note_reading))
                } else {
                    Self::extract_screenshot_from_detailed_reading(&note_reading)
                        .or(child_cover)
                        .or_else(|| self.get_first_item_cover_for_collection(conn, &child_id))
                }
            }
            (Some((child_id, child_cover, _)), None) => {
                child_cover.or_else(|| self.get_first_item_cover_for_collection(conn, &child_id))
            }
            (None, Some((note_reading, _))) => Self::extract_screenshot_from_detailed_reading(&note_reading),
            (None, None) => None,
        }
    }

    /// 从 detailed_reading JSON 中提取第一个章节的截图路径
    fn extract_screenshot_from_detailed_reading(detailed_reading: &Option<String>) -> Option<String> {
        let reading = detailed_reading.as_ref()?;
        let parsed: serde_json::Value = serde_json::from_str(reading).ok()?;
        let chapters = parsed.get("chapters")?.as_array()?;

        // 找到第一个有截图的章节
        for chapter in chapters {
            if let Some(screenshot_path) = chapter.get("screenshot_path").and_then(|v| v.as_str()) {
                if !screenshot_path.is_empty() {
                    return Some(screenshot_path.to_string());
                }
            }
        }
        None
    }

    pub fn get_collection_by_id(&self, id: &str) -> SqliteResult<Option<Collection>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, c.description, c.parent_id, c.sort_order, c.cover_image, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM collection_items WHERE collection_id = c.id) as item_count
             FROM collections c
             WHERE c.id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                parent_id: row.get(3)?,
                sort_order: row.get(4)?,
                cover_image: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                item_count: row.get(8)?,
                first_item_cover: None,
            })
        });

        match result {
            Ok(mut collection) => {
                collection.first_item_cover = self.get_first_item_cover_for_collection(&conn, &collection.id);
                Ok(Some(collection))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn create_collection(&self, req: &CreateCollectionRequest) -> SqliteResult<Collection> {
        let conn = self.connection();
        let new_id = snowflake::generate_id_string();

        let max_collection_sort: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM collections WHERE parent_id IS ?1",
                [&req.parent_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        let max_note_sort: i32 = if let Some(ref parent_id) = req.parent_id {
            conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM collection_items WHERE collection_id = ?1",
                [parent_id],
                |row| row.get(0),
            )
            .unwrap_or(-1)
        } else {
            -1
        };

        let max_sort = max_collection_sort.max(max_note_sort);

        conn.execute(
            "INSERT INTO collections (id, name, description, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![new_id, req.name, req.description, req.parent_id, max_sort + 1],
        )?;

        drop(conn);
        self.get_collection_by_id(&new_id).map(|opt| opt.unwrap())
    }

    pub fn update_collection(&self, collection: &Collection) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE collections SET name = ?1, description = ?2, parent_id = ?3, sort_order = ?4, cover_image = ?5,
             updated_at = datetime('now', 'localtime') WHERE id = ?6",
            rusqlite::params![
                collection.name,
                collection.description,
                collection.parent_id,
                collection.sort_order,
                collection.cover_image,
                collection.id
            ],
        )?;
        Ok(())
    }

    pub fn update_collections_order(&self, collection_ids: &[String]) -> SqliteResult<()> {
        let conn = self.connection();
        for (index, id) in collection_ids.iter().enumerate() {
            conn.execute(
                "UPDATE collections SET sort_order = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2",
                rusqlite::params![index as i32, id],
            )?;
        }
        Ok(())
    }

    pub fn delete_collection(&self, id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
        Ok(())
    }

    // Collection Items CRUD (合集内容关联)
    pub fn add_note_to_collection(&self, collection_id: &str, note_id: &str) -> SqliteResult<()> {
        let conn = self.connection();

        // 一个笔记只能属于一个合集，先删除笔记在其他合集中的记录
        conn.execute(
            "DELETE FROM collection_items WHERE note_id = ?1",
            [note_id],
        )?;

        // Get the max sort_order from both child collections and notes for proper mixed ordering
        let max_collection_sort: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM collections WHERE parent_id = ?1",
                [collection_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        let max_note_sort: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM collection_items WHERE collection_id = ?1",
                [collection_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        let max_sort = max_collection_sort.max(max_note_sort);

        let new_id = snowflake::generate_id_string();
        conn.execute(
            "INSERT INTO collection_items (id, collection_id, note_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![new_id, collection_id, note_id, max_sort + 1],
        )?;
        Ok(())
    }

    pub fn remove_note_from_collection(&self, collection_id: &str, note_id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute(
            "DELETE FROM collection_items WHERE collection_id = ?1 AND note_id = ?2",
            rusqlite::params![collection_id, note_id],
        )?;
        Ok(())
    }

    pub fn get_collection_items(&self, collection_id: &str) -> SqliteResult<Vec<CollectionItem>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, collection_id, note_id, sort_order, created_at
             FROM collection_items
             WHERE collection_id = ?1
             ORDER BY sort_order"
        )?;

        let items = stmt.query_map([collection_id], |row| {
            Ok(CollectionItem {
                id: row.get(0)?,
                collection_id: row.get(1)?,
                note_id: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;

        items.collect()
    }

    pub fn update_collection_items_order(&self, collection_id: &str, note_ids: &[String]) -> SqliteResult<()> {
        let conn = self.connection();

        for (index, note_id) in note_ids.iter().enumerate() {
            conn.execute(
                "UPDATE collection_items SET sort_order = ?1 WHERE collection_id = ?2 AND note_id = ?3",
                rusqlite::params![index as i32, collection_id, note_id],
            )?;
        }

        Ok(())
    }

    /// 更新合集内混合内容（子合集+笔记）的排序
    /// items 格式: [{"type": "collection", "id": "123"}, {"type": "note", "id": "456"}, ...]
    pub fn update_collection_mixed_order(&self, parent_id: &str, items: &[(String, String)]) -> SqliteResult<()> {
        let conn = self.connection();

        for (index, (item_type, id)) in items.iter().enumerate() {
            if item_type == "collection" {
                conn.execute(
                    "UPDATE collections SET sort_order = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2 AND parent_id = ?3",
                    rusqlite::params![index as i32, id, parent_id],
                )?;
            } else if item_type == "note" {
                conn.execute(
                    "UPDATE collection_items SET sort_order = ?1 WHERE collection_id = ?2 AND note_id = ?3",
                    rusqlite::params![index as i32, parent_id, id],
                )?;
            }
        }

        Ok(())
    }

    pub fn get_collections_for_note(&self, note_id: &str) -> SqliteResult<Vec<Collection>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name, c.description, c.parent_id, c.sort_order, c.cover_image, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM collection_items WHERE collection_id = c.id) as item_count
             FROM collections c
             INNER JOIN collection_items ci ON c.id = ci.collection_id
             WHERE ci.note_id = ?1
             ORDER BY c.sort_order, c.created_at"
        )?;

        let collections: Vec<Collection> = stmt.query_map([note_id], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                parent_id: row.get(3)?,
                sort_order: row.get(4)?,
                cover_image: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                item_count: row.get(8)?,
                first_item_cover: None, // 此方法不需要计算 first_item_cover
            })
        })?.collect::<SqliteResult<Vec<_>>>()?;

        Ok(collections)
    }

    /// Get all note IDs that are in any collection
    pub fn get_all_notes_in_collections(&self) -> SqliteResult<Vec<String>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT note_id FROM collection_items"
        )?;

        let note_ids = stmt.query_map([], |row| row.get(0))?;
        note_ids.collect()
    }

    /// Get the collection ID that contains a specific note
    pub fn get_note_collection_id(&self, note_id: &str) -> SqliteResult<Option<String>> {
        let conn = self.connection();
        conn.query_row(
            "SELECT collection_id FROM collection_items WHERE note_id = ?1 LIMIT 1",
            [note_id],
            |row| row.get(0),
        ).optional()
    }

    /// Get all note IDs in a collection and its sub-collections (recursive)
    pub fn get_all_note_ids_in_collection_tree(&self, collection_id: &str) -> SqliteResult<Vec<String>> {
        let conn = self.connection();
        let mut all_note_ids = Vec::new();

        // Get note IDs directly in this collection
        let mut stmt = conn.prepare(
            "SELECT note_id FROM collection_items WHERE collection_id = ?1"
        )?;
        let note_ids: Vec<String> = stmt.query_map([collection_id], |row| row.get(0))?
            .collect::<SqliteResult<Vec<_>>>()?;
        all_note_ids.extend(note_ids);

        // Get child collection IDs
        let mut child_stmt = conn.prepare(
            "SELECT id FROM collections WHERE parent_id = ?1"
        )?;
        let child_ids: Vec<String> = child_stmt.query_map([collection_id], |row| row.get(0))?
            .collect::<SqliteResult<Vec<_>>>()?;

        // Recursively get notes from child collections
        for child_id in child_ids {
            let child_notes = self.get_all_note_ids_in_collection_tree(&child_id)?;
            all_note_ids.extend(child_notes);
        }

        Ok(all_note_ids)
    }

    // ========================================================================
    // Knowledge Base CRUD
    // ========================================================================

    pub fn get_knowledge_chunks(&self, note_id: &str) -> SqliteResult<Vec<KnowledgeChunk>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, chunk_index, content, embedding, created_at
             FROM knowledge_chunks WHERE note_id = ?1 ORDER BY chunk_index"
        )?;
        let chunks = stmt.query_map([note_id], |row| {
            Ok(KnowledgeChunk {
                id: row.get(0)?,
                note_id: row.get(1)?,
                chunk_index: row.get(2)?,
                content: row.get(3)?,
                embedding: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        chunks.collect()
    }

    pub fn get_all_knowledge_chunks_with_embeddings(&self) -> SqliteResult<Vec<KnowledgeChunk>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, chunk_index, content, embedding, created_at
             FROM knowledge_chunks WHERE embedding IS NOT NULL ORDER BY note_id, chunk_index"
        )?;
        let chunks = stmt.query_map([], |row| {
            Ok(KnowledgeChunk {
                id: row.get(0)?,
                note_id: row.get(1)?,
                chunk_index: row.get(2)?,
                content: row.get(3)?,
                embedding: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        chunks.collect()
    }

    pub fn create_knowledge_chunk(
        &self,
        note_id: &str,
        chunk_index: i32,
        content: &str,
        embedding: Option<&[u8]>,
    ) -> SqliteResult<()> {
        let conn = self.connection();
        let new_id = snowflake::generate_id_string();
        conn.execute(
            "INSERT INTO knowledge_chunks (id, note_id, chunk_index, content, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![new_id, note_id, chunk_index, content, embedding],
        )?;
        Ok(())
    }

    pub fn delete_knowledge_chunks(&self, note_id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM knowledge_chunks WHERE note_id = ?1", [note_id])?;
        Ok(())
    }

    pub fn get_knowledge_index_status(&self, note_id: &str) -> SqliteResult<Option<KnowledgeIndexStatus>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT note_id, status, chunk_count, content_hash, started_at, completed_at, error_message
             FROM knowledge_index_status WHERE note_id = ?1"
        )?;
        let result = stmt.query_row([note_id], |row| {
            Ok(KnowledgeIndexStatus {
                note_id: row.get(0)?,
                status: row.get(1)?,
                chunk_count: row.get(2)?,
                content_hash: row.get(3)?,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                error_message: row.get(6)?,
            })
        }).optional()?;
        Ok(result)
    }

    pub fn get_all_knowledge_index_statuses(&self) -> SqliteResult<Vec<KnowledgeIndexStatus>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT note_id, status, chunk_count, content_hash, started_at, completed_at, error_message
             FROM knowledge_index_status"
        )?;
        let statuses = stmt.query_map([], |row| {
            Ok(KnowledgeIndexStatus {
                note_id: row.get(0)?,
                status: row.get(1)?,
                chunk_count: row.get(2)?,
                content_hash: row.get(3)?,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                error_message: row.get(6)?,
            })
        })?;
        statuses.collect()
    }

    pub fn set_knowledge_index_status(
        &self,
        note_id: &str,
        status: &str,
        chunk_count: i32,
        content_hash: Option<&str>,
        error_message: Option<&str>,
    ) -> SqliteResult<()> {
        let conn = self.connection();
        if status == "indexing" {
            conn.execute(
                "INSERT OR REPLACE INTO knowledge_index_status (note_id, status, chunk_count, content_hash, started_at, completed_at, error_message)
                 VALUES (?1, ?2, 0, ?3, datetime('now', 'localtime'), NULL, NULL)",
                rusqlite::params![note_id, status, content_hash],
            )?;
        } else if status == "completed" {
            conn.execute(
                "UPDATE knowledge_index_status
                 SET status = ?2, chunk_count = ?3, content_hash = ?4, completed_at = datetime('now', 'localtime'), error_message = NULL
                 WHERE note_id = ?1",
                rusqlite::params![note_id, status, chunk_count, content_hash],
            )?;
        } else if status == "failed" {
            conn.execute(
                "UPDATE knowledge_index_status
                 SET status = ?2, completed_at = datetime('now', 'localtime'), error_message = ?3
                 WHERE note_id = ?1",
                rusqlite::params![note_id, status, error_message],
            )?;
        }
        Ok(())
    }

    pub fn delete_knowledge_index_status(&self, note_id: &str) -> SqliteResult<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM knowledge_index_status WHERE note_id = ?1", [note_id])?;
        Ok(())
    }

    pub fn count_knowledge_chunks(&self) -> SqliteResult<i32> {
        let conn = self.connection();
        let count: i32 = conn.query_row("SELECT COUNT(*) FROM knowledge_chunks", [], |row| row.get(0))?;
        Ok(count)
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use tempfile::TempDir;

    /// Helper function to create a test database in a temporary directory
    fn create_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let db = Database::new(temp_dir.path().to_path_buf()).expect("Failed to create database");
        (db, temp_dir)
    }

    /// Helper function to create a test note and return its ID
    fn create_test_note(db: &Database) -> String {
        let req = CreateNoteRequest {
            title: "Test Note".to_string(),
            video_path: "/test/video.mp4".to_string(),
            subtitle_path: Some("/test/subtitle.srt".to_string()),
            model_id: None,
        };
        let note = db.create_note(&req).expect("Failed to create note");
        note.id
    }

    /// Strategy for generating valid subtitle indices (non-negative)
    fn subtitle_index_strategy() -> impl Strategy<Value = i32> {
        0..10000i32
    }

    /// Strategy for generating valid timestamps (non-negative)
    fn timestamp_strategy() -> impl Strategy<Value = f64> {
        (0.0..36000.0f64).prop_map(|t| (t * 1000.0).round() / 1000.0) // Round to 3 decimal places
    }

    /// Strategy for generating valid screenshot paths
    fn screenshot_path_strategy() -> impl Strategy<Value = String> {
        "[a-zA-Z0-9_/]{1,50}\\.png".prop_map(|s| format!("/screenshots/{}", s))
    }

    /// Strategy for generating a valid ScreenshotMarker (without note_id, which is set separately)
    fn marker_data_strategy() -> impl Strategy<Value = (i32, f64, String)> {
        (
            subtitle_index_strategy(),
            timestamp_strategy(),
            screenshot_path_strategy(),
        )
    }

    // ============================================================================
    // Property 17: Marker Persistence Round-Trip
    // **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
    //
    // *For any* screenshot marker that is saved to the database, querying the 
    // database for that note's markers SHALL return a marker with the same 
    // subtitle_index, timestamp, and screenshot_path. After deletion, the marker 
    // SHALL no longer be returned.
    // ============================================================================

    proptest! {
        /// Property 17.1: Save and retrieve marker - data integrity
        /// 
        /// For any valid marker data, saving to the database and then querying
        /// should return a marker with identical subtitle_index, timestamp, and screenshot_path.
        #[test]
        fn prop_marker_save_and_retrieve_preserves_data(
            (subtitle_index, timestamp, screenshot_path) in marker_data_strategy()
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            let marker_id = uuid::Uuid::new_v4().to_string();
            let marker = ScreenshotMarker {
                id: marker_id.clone(),
                note_id: note_id.clone(),
                subtitle_index,
                timestamp,
                screenshot_path: screenshot_path.clone(),
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };

            // Save the marker
            db.save_screenshot_marker(&marker).expect("Failed to save marker");

            // Retrieve markers for the note
            let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");

            // Verify exactly one marker exists
            prop_assert_eq!(markers.len(), 1, "Expected exactly one marker");

            let retrieved = &markers[0];
            
            // Verify data integrity
            prop_assert_eq!(&retrieved.id, &marker_id, "Marker ID mismatch");
            prop_assert_eq!(&retrieved.note_id, &note_id, "Note ID mismatch");
            prop_assert_eq!(retrieved.subtitle_index, subtitle_index, "Subtitle index mismatch");
            prop_assert!((retrieved.timestamp - timestamp).abs() < 0.001, "Timestamp mismatch");
            prop_assert_eq!(&retrieved.screenshot_path, &screenshot_path, "Screenshot path mismatch");
        }

        /// Property 17.2: Delete marker removes it from query results
        /// 
        /// For any marker that is saved and then deleted, querying the database
        /// should no longer return that marker.
        #[test]
        fn prop_marker_delete_removes_from_results(
            (subtitle_index, timestamp, screenshot_path) in marker_data_strategy()
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            let marker_id = uuid::Uuid::new_v4().to_string();
            let marker = ScreenshotMarker {
                id: marker_id.clone(),
                note_id: note_id.clone(),
                subtitle_index,
                timestamp,
                screenshot_path,
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };

            // Save the marker
            db.save_screenshot_marker(&marker).expect("Failed to save marker");

            // Verify marker exists
            let markers_before = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
            prop_assert_eq!(markers_before.len(), 1, "Marker should exist before deletion");

            // Delete the marker
            let deleted = db.delete_screenshot_marker(&note_id, &marker_id)
                .expect("Failed to delete marker");
            prop_assert!(deleted.is_some(), "Delete should return the deleted marker");

            // Verify marker no longer exists
            let markers_after = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
            prop_assert_eq!(markers_after.len(), 0, "Marker should not exist after deletion");
        }

        /// Property 17.3: Multiple markers with different indices are all persisted
        /// 
        /// For any set of markers with distinct subtitle indices, all markers
        /// should be retrievable after saving.
        #[test]
        fn prop_multiple_markers_all_persisted(
            indices in prop::collection::hash_set(subtitle_index_strategy(), 1..10)
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            let indices_vec: Vec<i32> = indices.into_iter().collect();
            let expected_count = indices_vec.len();

            // Save markers for each index
            for &idx in &indices_vec {
                let marker = ScreenshotMarker {
                    id: uuid::Uuid::new_v4().to_string(),
                    note_id: note_id.clone(),
                    subtitle_index: idx,
                    timestamp: idx as f64 * 1.5,
                    screenshot_path: format!("/screenshots/marker_{}.png", idx),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save marker");
            }

            // Retrieve all markers
            let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");

            // Verify count matches
            prop_assert_eq!(markers.len(), expected_count, "Marker count mismatch");

            // Verify all indices are present
            let retrieved_indices: std::collections::HashSet<i32> = 
                markers.iter().map(|m| m.subtitle_index).collect();
            let expected_indices: std::collections::HashSet<i32> = 
                indices_vec.into_iter().collect();
            prop_assert_eq!(retrieved_indices, expected_indices, "Indices mismatch");
        }

        /// Property 17.4: Markers are ordered by subtitle_index
        /// 
        /// When retrieving markers, they should be ordered by subtitle_index ascending.
        #[test]
        fn prop_markers_ordered_by_subtitle_index(
            indices in prop::collection::hash_set(subtitle_index_strategy(), 2..10)
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            // Save markers in random order (hash_set iteration order is arbitrary)
            for idx in indices {
                let marker = ScreenshotMarker {
                    id: uuid::Uuid::new_v4().to_string(),
                    note_id: note_id.clone(),
                    subtitle_index: idx,
                    timestamp: idx as f64,
                    screenshot_path: format!("/screenshots/marker_{}.png", idx),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save marker");
            }

            // Retrieve markers
            let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");

            // Verify ordering
            for i in 1..markers.len() {
                prop_assert!(
                    markers[i-1].subtitle_index < markers[i].subtitle_index,
                    "Markers should be ordered by subtitle_index"
                );
            }
        }

        /// Property 17.5: Update marker (same subtitle_index) replaces existing
        /// 
        /// When saving a marker with the same note_id and subtitle_index as an existing
        /// marker, the existing marker should be replaced (due to UNIQUE constraint).
        #[test]
        fn prop_marker_update_replaces_existing(
            subtitle_index in subtitle_index_strategy(),
            (timestamp1, timestamp2) in (timestamp_strategy(), timestamp_strategy()),
            (path1, path2) in (screenshot_path_strategy(), screenshot_path_strategy())
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            // Save first marker
            let marker1 = ScreenshotMarker {
                id: uuid::Uuid::new_v4().to_string(),
                note_id: note_id.clone(),
                subtitle_index,
                timestamp: timestamp1,
                screenshot_path: path1,
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            db.save_screenshot_marker(&marker1).expect("Failed to save first marker");

            // Save second marker with same subtitle_index but different data
            let marker2_id = uuid::Uuid::new_v4().to_string();
            let marker2 = ScreenshotMarker {
                id: marker2_id.clone(),
                note_id: note_id.clone(),
                subtitle_index,
                timestamp: timestamp2,
                screenshot_path: path2.clone(),
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            db.save_screenshot_marker(&marker2).expect("Failed to save second marker");

            // Retrieve markers
            let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");

            // Should only have one marker (the second one replaced the first)
            prop_assert_eq!(markers.len(), 1, "Should have exactly one marker after update");
            
            // The marker should have the second marker's data
            let retrieved = &markers[0];
            prop_assert_eq!(&retrieved.id, &marker2_id, "Should have second marker's ID");
            prop_assert!((retrieved.timestamp - timestamp2).abs() < 0.001, "Should have second marker's timestamp");
            prop_assert_eq!(&retrieved.screenshot_path, &path2, "Should have second marker's path");
        }
    }

    // ============================================================================
    // Additional unit tests for edge cases
    // ============================================================================

    #[test]
    fn test_get_markers_empty_note() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert!(markers.is_empty(), "New note should have no markers");
    }

    #[test]
    fn test_delete_nonexistent_marker() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        let result = db.delete_screenshot_marker(&note_id, "nonexistent-id")
            .expect("Delete should not fail");
        assert!(result.is_none(), "Deleting nonexistent marker should return None");
    }

    #[test]
    fn test_delete_all_markers() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        // Add multiple markers
        for i in 0..5 {
            let marker = ScreenshotMarker {
                id: uuid::Uuid::new_v4().to_string(),
                note_id: note_id.clone(),
                subtitle_index: i,
                timestamp: i as f64 * 10.0,
                screenshot_path: format!("/screenshots/marker_{}.png", i),
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            db.save_screenshot_marker(&marker).expect("Failed to save marker");
        }

        // Verify markers exist
        let markers_before = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert_eq!(markers_before.len(), 5, "Should have 5 markers");

        // Delete all markers
        let deleted = db.delete_all_screenshot_markers(&note_id).expect("Failed to delete all markers");
        assert_eq!(deleted.len(), 5, "Should return 5 deleted markers");

        // Verify no markers remain
        let markers_after = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert!(markers_after.is_empty(), "Should have no markers after delete all");
    }

    #[test]
    fn test_markers_isolated_between_notes() {
        let (db, _temp_dir) = create_test_db();
        let note_id_1 = create_test_note(&db);
        let note_id_2 = create_test_note(&db);

        // Add marker to note 1
        let marker1 = ScreenshotMarker {
            id: uuid::Uuid::new_v4().to_string(),
            note_id: note_id_1.clone(),
            subtitle_index: 0,
            timestamp: 10.0,
            screenshot_path: "/screenshots/note1_marker.png".to_string(),
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };
        db.save_screenshot_marker(&marker1).expect("Failed to save marker");

        // Add marker to note 2
        let marker2 = ScreenshotMarker {
            id: uuid::Uuid::new_v4().to_string(),
            note_id: note_id_2.clone(),
            subtitle_index: 0,
            timestamp: 20.0,
            screenshot_path: "/screenshots/note2_marker.png".to_string(),
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };
        db.save_screenshot_marker(&marker2).expect("Failed to save marker");

        // Verify each note only sees its own markers
        let markers_1 = db.get_screenshot_markers(&note_id_1).expect("Failed to get markers");
        let markers_2 = db.get_screenshot_markers(&note_id_2).expect("Failed to get markers");

        assert_eq!(markers_1.len(), 1, "Note 1 should have 1 marker");
        assert_eq!(markers_2.len(), 1, "Note 2 should have 1 marker");
        assert_eq!(markers_1[0].screenshot_path, "/screenshots/note1_marker.png");
        assert_eq!(markers_2[0].screenshot_path, "/screenshots/note2_marker.png");
    }

    #[test]
    fn test_cascade_delete_on_note_deletion() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        // Add markers
        for i in 0..3 {
            let marker = ScreenshotMarker {
                id: uuid::Uuid::new_v4().to_string(),
                note_id: note_id.clone(),
                subtitle_index: i,
                timestamp: i as f64 * 10.0,
                screenshot_path: format!("/screenshots/marker_{}.png", i),
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            db.save_screenshot_marker(&marker).expect("Failed to save marker");
        }

        // Verify markers exist
        let markers_before = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert_eq!(markers_before.len(), 3, "Should have 3 markers");

        // Delete the note
        db.delete_note(&note_id).expect("Failed to delete note");

        // Verify markers are cascade deleted
        let markers_after = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert!(markers_after.is_empty(), "Markers should be cascade deleted with note");
    }

    // ============================================================================
    // Property 18: Screenshot File Lifecycle
    // **Validates: Requirements 8.1, 8.2, 8.4**
    //
    // *For any* screenshot capture operation, the screenshot file SHALL exist at 
    // the specified path after capture. After marker deletion, the screenshot file 
    // SHALL no longer exist at that path. User-added screenshots SHALL NOT be 
    // deleted during chapter regeneration.
    //
    // Note: Since actual FFmpeg and file system operations are complex, these tests
    // focus on the database layer's file path management logic:
    // - File path is correctly recorded when saving a marker (8.1)
    // - File path is correctly returned when deleting a marker for cleanup (8.2)
    // - Batch deletion returns all file paths for cleanup (8.2)
    // - User-added markers are preserved (identifiable) during operations (8.4)
    // ============================================================================

    proptest! {
        /// Property 18.1: Screenshot path is correctly recorded after save
        /// 
        /// For any screenshot capture operation (simulated by saving a marker),
        /// the screenshot_path SHALL be correctly stored and retrievable.
        /// **Validates: Requirement 8.1**
        #[test]
        fn prop_screenshot_path_recorded_after_save(
            screenshot_path in screenshot_path_strategy(),
            subtitle_index in subtitle_index_strategy(),
            timestamp in timestamp_strategy()
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            let marker_id = uuid::Uuid::new_v4().to_string();
            let marker = ScreenshotMarker {
                id: marker_id.clone(),
                note_id: note_id.clone(),
                subtitle_index,
                timestamp,
                screenshot_path: screenshot_path.clone(),
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };

            // Save the marker (simulates screenshot capture + save)
            db.save_screenshot_marker(&marker).expect("Failed to save marker");

            // Retrieve and verify the path is correctly recorded
            let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
            prop_assert_eq!(markers.len(), 1, "Should have exactly one marker");
            prop_assert_eq!(
                &markers[0].screenshot_path, 
                &screenshot_path, 
                "Screenshot path should be correctly recorded"
            );
        }

        /// Property 18.2: Delete marker returns screenshot path for file cleanup
        /// 
        /// After marker deletion, the delete operation SHALL return the marker data
        /// including the screenshot_path so the file can be cleaned up.
        /// **Validates: Requirement 8.2**
        #[test]
        fn prop_delete_marker_returns_path_for_cleanup(
            screenshot_path in screenshot_path_strategy(),
            subtitle_index in subtitle_index_strategy(),
            timestamp in timestamp_strategy()
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            let marker_id = uuid::Uuid::new_v4().to_string();
            let marker = ScreenshotMarker {
                id: marker_id.clone(),
                note_id: note_id.clone(),
                subtitle_index,
                timestamp,
                screenshot_path: screenshot_path.clone(),
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };

            // Save the marker
            db.save_screenshot_marker(&marker).expect("Failed to save marker");

            // Delete the marker and verify the returned data contains the path
            let deleted = db.delete_screenshot_marker(&note_id, &marker_id)
                .expect("Failed to delete marker");
            
            prop_assert!(deleted.is_some(), "Delete should return the deleted marker");
            let deleted_marker = deleted.unwrap();
            prop_assert_eq!(
                &deleted_marker.screenshot_path, 
                &screenshot_path, 
                "Deleted marker should contain the screenshot path for file cleanup"
            );
        }

        /// Property 18.3: Batch delete returns all screenshot paths for cleanup
        /// 
        /// When deleting all markers for a note, the operation SHALL return all
        /// marker data including screenshot_paths so all files can be cleaned up.
        /// **Validates: Requirement 8.2**
        #[test]
        fn prop_batch_delete_returns_all_paths_for_cleanup(
            paths in prop::collection::vec(screenshot_path_strategy(), 1..10)
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            // Save markers with different paths
            let mut expected_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
            for (i, path) in paths.iter().enumerate() {
                let marker = ScreenshotMarker {
                    id: uuid::Uuid::new_v4().to_string(),
                    note_id: note_id.clone(),
                    subtitle_index: i as i32,
                    timestamp: i as f64 * 10.0,
                    screenshot_path: path.clone(),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save marker");
                expected_paths.insert(path.clone());
            }

            // Delete all markers and verify all paths are returned
            let deleted = db.delete_all_screenshot_markers(&note_id)
                .expect("Failed to delete all markers");

            // Allow duplicate paths if markers are distinct (e.g. two markers pointing to same file)
            // We just need to ensure all the expected paths are present in the returned list

            let returned_paths: std::collections::HashSet<String> =
                deleted.iter().map(|m| m.screenshot_path.clone()).collect();
            prop_assert_eq!(
                returned_paths,
                expected_paths,
                "All screenshot paths should be returned for file cleanup"
            );
        }

        /// Property 18.4: User-added markers are identifiable and preserved
        /// 
        /// User-added screenshot markers SHALL be identifiable by their marker_id
        /// and can be selectively preserved during operations (e.g., chapter regeneration).
        /// **Validates: Requirement 8.4**
        #[test]
        fn prop_user_markers_identifiable_and_preservable(
            user_indices in prop::collection::hash_set(0..50i32, 1..5),
            auto_indices in prop::collection::hash_set(50..100i32, 1..5)
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            // Save user-added markers (simulating manual screenshot additions)
            let mut user_marker_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
            for idx in &user_indices {
                let marker_id = uuid::Uuid::new_v4().to_string();
                let marker = ScreenshotMarker {
                    id: marker_id.clone(),
                    note_id: note_id.clone(),
                    subtitle_index: *idx,
                    timestamp: *idx as f64,
                    screenshot_path: format!("/screenshots/user_marker_{}.png", idx),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save user marker");
                user_marker_ids.insert(marker_id);
            }

            // Save auto-generated markers (simulating system-generated screenshots)
            let mut auto_marker_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
            for idx in &auto_indices {
                let marker_id = uuid::Uuid::new_v4().to_string();
                let marker = ScreenshotMarker {
                    id: marker_id.clone(),
                    note_id: note_id.clone(),
                    subtitle_index: *idx,
                    timestamp: *idx as f64,
                    screenshot_path: format!("/screenshots/auto_marker_{}.png", idx),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save auto marker");
                auto_marker_ids.insert(marker_id);
            }

            // Simulate chapter regeneration: delete only auto-generated markers
            // (In real implementation, this would be done by tracking which markers are user-added)
            for auto_id in &auto_marker_ids {
                db.delete_screenshot_marker(&note_id, auto_id)
                    .expect("Failed to delete auto marker");
            }

            // Verify user markers are preserved
            let remaining_markers = db.get_screenshot_markers(&note_id)
                .expect("Failed to get markers");
            
            prop_assert_eq!(
                remaining_markers.len(), 
                user_marker_ids.len(), 
                "Only user markers should remain after selective deletion"
            );

            let remaining_ids: std::collections::HashSet<String> = 
                remaining_markers.iter().map(|m| m.id.clone()).collect();
            prop_assert_eq!(
                remaining_ids, 
                user_marker_ids, 
                "User marker IDs should be preserved"
            );

            // Verify user marker paths are intact
            for marker in &remaining_markers {
                prop_assert!(
                    marker.screenshot_path.contains("user_marker"),
                    "User marker paths should be preserved"
                );
            }
        }
    }

    // ============================================================================
    // Property 18: Additional unit tests for file lifecycle edge cases
    // ============================================================================

    #[test]
    fn test_screenshot_path_with_special_characters() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        // Test path with spaces and unicode characters
        let special_path = "/screenshots/视频截图 2024-01-15 10:30:45.png".to_string();
        let marker = ScreenshotMarker {
            id: uuid::Uuid::new_v4().to_string(),
            note_id: note_id.clone(),
            subtitle_index: 0,
            timestamp: 10.0,
            screenshot_path: special_path.clone(),
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };

        db.save_screenshot_marker(&marker).expect("Failed to save marker");

        let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].screenshot_path, special_path, "Special characters in path should be preserved");
    }

    #[test]
    fn test_screenshot_path_with_long_path() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        // Test very long path
        let long_path = format!("/screenshots/{}/marker.png", "a".repeat(500));
        let marker = ScreenshotMarker {
            id: uuid::Uuid::new_v4().to_string(),
            note_id: note_id.clone(),
            subtitle_index: 0,
            timestamp: 10.0,
            screenshot_path: long_path.clone(),
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };

        db.save_screenshot_marker(&marker).expect("Failed to save marker");

        let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].screenshot_path, long_path, "Long path should be preserved");
    }

    #[test]
    fn test_delete_returns_correct_path_among_multiple() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        // Add multiple markers with different paths
        let paths = vec![
            "/screenshots/first.png",
            "/screenshots/second.png",
            "/screenshots/third.png",
        ];
        let mut marker_ids = Vec::new();

        for (i, path) in paths.iter().enumerate() {
            let marker_id = uuid::Uuid::new_v4().to_string();
            let marker = ScreenshotMarker {
                id: marker_id.clone(),
                note_id: note_id.clone(),
                subtitle_index: i as i32,
                timestamp: i as f64 * 10.0,
                screenshot_path: path.to_string(),
                created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            db.save_screenshot_marker(&marker).expect("Failed to save marker");
            marker_ids.push(marker_id);
        }

        // Delete the middle marker and verify correct path is returned
        let deleted = db.delete_screenshot_marker(&note_id, &marker_ids[1])
            .expect("Failed to delete marker");
        
        assert!(deleted.is_some());
        assert_eq!(
            deleted.unwrap().screenshot_path, 
            "/screenshots/second.png",
            "Should return the correct path for the deleted marker"
        );

        // Verify other markers still exist with correct paths
        let remaining = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert_eq!(remaining.len(), 2);
        assert_eq!(remaining[0].screenshot_path, "/screenshots/first.png");
        assert_eq!(remaining[1].screenshot_path, "/screenshots/third.png");
    }

    #[test]
    fn test_batch_delete_empty_returns_empty() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        // Delete all markers from a note with no markers
        let deleted = db.delete_all_screenshot_markers(&note_id)
            .expect("Failed to delete all markers");
        
        assert!(deleted.is_empty(), "Deleting from empty should return empty vec");
    }

    #[test]
    fn test_marker_path_preserved_after_update() {
        let (db, _temp_dir) = create_test_db();
        let note_id = create_test_note(&db);

        // Save initial marker
        let original_path = "/screenshots/original.png".to_string();
        let marker = ScreenshotMarker {
            id: uuid::Uuid::new_v4().to_string(),
            note_id: note_id.clone(),
            subtitle_index: 5,
            timestamp: 50.0,
            screenshot_path: original_path.clone(),
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };
        db.save_screenshot_marker(&marker).expect("Failed to save marker");

        // Update with new marker at same index (different path)
        let new_path = "/screenshots/updated.png".to_string();
        let updated_marker = ScreenshotMarker {
            id: uuid::Uuid::new_v4().to_string(),
            note_id: note_id.clone(),
            subtitle_index: 5, // Same index
            timestamp: 55.0,
            screenshot_path: new_path.clone(),
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };
        db.save_screenshot_marker(&updated_marker).expect("Failed to save updated marker");

        // Verify only the new path exists
        let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
        assert_eq!(markers.len(), 1);
        assert_eq!(
            markers[0].screenshot_path, 
            new_path,
            "Updated marker should have new path"
        );
        // Note: In real implementation, the old file at original_path should be cleaned up
        // before saving the new marker. This test verifies the DB correctly stores the new path.
    }

    // ============================================================================
    // Property 19: Cleanup on Note Deletion
    // **Validates: Requirements 8.3**
    //
    // *For any* note with associated screenshot markers, after the note is deleted,
    // all screenshot marker records for that note SHALL be removed from the database.
    //
    // Note: File system cleanup is handled by the Tauri command layer (lib.rs),
    // which deletes the entire note cache directory. These tests verify the database
    // cascade deletion behavior that supports the cleanup process.
    // ============================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10))]

        /// Property 19.1: All markers are cascade deleted when note is deleted
        /// 
        /// For any note with N screenshot markers (N >= 0), after the note is deleted,
        /// querying for that note's markers SHALL return an empty list.
        /// **Validates: Requirement 8.3**
        #[test]
        fn prop_all_markers_cascade_deleted_on_note_deletion(
            marker_count in 0..10usize
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            // Add markers to the note
            for i in 0..marker_count {
                let marker = ScreenshotMarker {
                    id: uuid::Uuid::new_v4().to_string(),
                    note_id: note_id.clone(),
                    subtitle_index: i as i32,
                    timestamp: i as f64 * 10.0,
                    screenshot_path: format!("/screenshots/marker_{}.png", i),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save marker");
            }

            // Verify markers exist before deletion
            let markers_before = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
            prop_assert_eq!(
                markers_before.len(), 
                marker_count, 
                "Should have {} markers before deletion", marker_count
            );

            // Delete the note
            db.delete_note(&note_id).expect("Failed to delete note");

            // Verify all markers are cascade deleted
            let markers_after = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
            prop_assert!(
                markers_after.is_empty(), 
                "All markers should be cascade deleted with note, but found {} markers", 
                markers_after.len()
            );
        }

        /// Property 19.2: Markers from other notes are not affected by deletion
        /// 
        /// For any two notes with markers, deleting one note SHALL only remove
        /// markers associated with that note, leaving other notes' markers intact.
        /// **Validates: Requirement 8.3**
        #[test]
        fn prop_other_notes_markers_preserved_on_deletion(
            note1_marker_count in 1..5usize,
            note2_marker_count in 1..5usize
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id_1 = create_test_note(&db);
            let note_id_2 = create_test_note(&db);

            // Add markers to note 1
            for i in 0..note1_marker_count {
                let marker = ScreenshotMarker {
                    id: uuid::Uuid::new_v4().to_string(),
                    note_id: note_id_1.clone(),
                    subtitle_index: i as i32,
                    timestamp: i as f64 * 10.0,
                    screenshot_path: format!("/screenshots/note1_marker_{}.png", i),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save marker");
            }

            // Add markers to note 2
            for i in 0..note2_marker_count {
                let marker = ScreenshotMarker {
                    id: uuid::Uuid::new_v4().to_string(),
                    note_id: note_id_2.clone(),
                    subtitle_index: i as i32,
                    timestamp: i as f64 * 10.0,
                    screenshot_path: format!("/screenshots/note2_marker_{}.png", i),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save marker");
            }

            // Delete note 1
            db.delete_note(&note_id_1).expect("Failed to delete note 1");

            // Verify note 1's markers are deleted
            let note1_markers = db.get_screenshot_markers(&note_id_1).expect("Failed to get markers");
            prop_assert!(
                note1_markers.is_empty(), 
                "Note 1's markers should be deleted"
            );

            // Verify note 2's markers are preserved
            let note2_markers = db.get_screenshot_markers(&note_id_2).expect("Failed to get markers");
            prop_assert_eq!(
                note2_markers.len(), 
                note2_marker_count, 
                "Note 2's markers should be preserved"
            );

            // Verify note 2's marker paths are intact
            for marker in &note2_markers {
                prop_assert!(
                    marker.screenshot_path.contains("note2_marker"),
                    "Note 2's marker paths should be preserved"
                );
            }
        }

        /// Property 19.3: Marker file paths are retrievable before note deletion
        /// 
        /// For any note with markers, before deletion, all marker file paths
        /// SHALL be retrievable for file system cleanup purposes.
        /// **Validates: Requirement 8.3**
        #[test]
        fn prop_marker_paths_retrievable_before_deletion(
            paths in prop::collection::vec(screenshot_path_strategy(), 1..5)
        ) {
            let (db, _temp_dir) = create_test_db();
            let note_id = create_test_note(&db);

            // Save markers with different paths
            let mut expected_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
            for (i, path) in paths.iter().enumerate() {
                let marker = ScreenshotMarker {
                    id: uuid::Uuid::new_v4().to_string(),
                    note_id: note_id.clone(),
                    subtitle_index: i as i32,
                    timestamp: i as f64 * 10.0,
                    screenshot_path: path.clone(),
                    created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                };
                db.save_screenshot_marker(&marker).expect("Failed to save marker");
                expected_paths.insert(path.clone());
            }

            // Retrieve markers before deletion (for file cleanup)
            let markers = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
            let retrieved_paths: std::collections::HashSet<String> = 
                markers.iter().map(|m| m.screenshot_path.clone()).collect();

            prop_assert_eq!(
                retrieved_paths, 
                expected_paths, 
                "All marker paths should be retrievable before note deletion for file cleanup"
            );

            // Now delete the note
            db.delete_note(&note_id).expect("Failed to delete note");

            // Verify markers are gone
            let markers_after = db.get_screenshot_markers(&note_id).expect("Failed to get markers");
            prop_assert!(markers_after.is_empty(), "Markers should be deleted with note");
        }
    }
}
