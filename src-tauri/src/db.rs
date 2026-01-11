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
                sort_order INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

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
            "SELECT id, title, base_url, api_key, model, sort_order FROM ai_configs ORDER BY sort_order"
        )?;

        let configs = stmt.query_map([], |row| {
            Ok(AiConfig {
                id: row.get(0)?,
                title: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model: row.get(4)?,
                sort_order: row.get(5)?,
            })
        })?;

        configs.collect()
    }

    pub fn create_ai_config(&self, config: &AiConfig) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO ai_configs (title, base_url, api_key, model, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
            (&config.title, &config.base_url, &config.api_key, &config.model, config.sort_order),
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_ai_config(&self, config: &AiConfig) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE ai_configs SET title = ?1, base_url = ?2, api_key = ?3, model = ?4, sort_order = ?5 WHERE id = ?6",
            (&config.title, &config.base_url, &config.api_key, &config.model, config.sort_order, config.id),
        )?;
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
