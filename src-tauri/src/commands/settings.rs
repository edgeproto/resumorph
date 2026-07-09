use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSetting {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub fn get_setting(db: State<'_, Database>, key: String) -> Result<Option<String>, String> {
    db.with_conn(|conn| {
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [&key],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(
    db: State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![&key, &value],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_settings(db: State<'_, Database>) -> Result<Vec<AppSetting>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
        let rows = stmt.query_map([], |row| {
            Ok(AppSetting {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })?;
        rows.collect()
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings_map(db: State<'_, Database>) -> Result<std::collections::HashMap<String, String>, String> {
    let settings = list_settings(db)?;
    Ok(settings.into_iter().map(|s| (s.key, s.value)).collect())
}
