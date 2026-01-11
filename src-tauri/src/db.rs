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
}
