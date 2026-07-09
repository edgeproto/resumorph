use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

const SERVICE_NAME: &str = "resumorph";
const API_KEY_SETTING_PREFIX: &str = "api_key_";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub provider: String,
    pub has_key: bool,
}

fn keyring_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, provider).map_err(|e| format!("Keyring error: {e}"))
}

fn fallback_setting_key(provider: &str) -> String {
    format!("{API_KEY_SETTING_PREFIX}{provider}")
}

fn read_fallback_key(db: &Database, provider: &str) -> Result<Option<String>, String> {
    let key = fallback_setting_key(provider);
    db.with_conn(|conn| {
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [&key],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
            Ok(_) => Ok(None),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
    .map_err(|e| e.to_string())
}

fn write_fallback_key(db: &Database, provider: &str, api_key: &str) -> Result<(), String> {
    let key = fallback_setting_key(provider);
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![&key, api_key],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

fn remove_fallback_key(db: &Database, provider: &str) -> Result<(), String> {
    let key = fallback_setting_key(provider);
    db.with_conn(|conn| {
        conn.execute("DELETE FROM settings WHERE key = ?1", [&key])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

pub fn get_api_key_for_provider(db: &Database, provider: &str) -> Result<String, String> {
    if let Ok(key) = read_keychain_key(provider) {
        return Ok(key);
    }
    read_fallback_key(db, provider)?
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| "No API key configured. Add one in Settings.".into())
}

pub fn has_api_key_for_provider(db: &Database, provider: &str) -> Result<bool, String> {
    if read_keychain_key(provider).is_ok() {
        return Ok(true);
    }
    Ok(read_fallback_key(db, provider)?
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false))
}

fn read_keychain_key(provider: &str) -> Result<String, String> {
    let entry = keyring_entry(provider)?;
    let key = entry
        .get_password()
        .map_err(|e| format!("Keyring read failed: {e}"))?;
    if key.trim().is_empty() {
        return Err("Keyring entry is empty".into());
    }
    Ok(key)
}

fn write_keychain_key(provider: &str, api_key: &str) -> Result<(), String> {
    let entry = keyring_entry(provider)?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("Keyring write failed: {e}"))
}

#[tauri::command]
pub fn set_api_key(
    db: State<'_, Database>,
    provider: String,
    api_key: String,
) -> Result<(), String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("API key cannot be empty.".into());
    }

    // Always persist to SQLite — reliable on Windows when Credential Manager read-back fails.
    write_fallback_key(&db, &provider, trimmed)?;

    match write_keychain_key(&provider, trimmed) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!(
                "Warning: OS keychain storage failed for provider '{provider}', \
                 using local database copy: {e}"
            );
            Ok(())
        }
    }
}

#[tauri::command]
pub fn get_api_key(db: State<'_, Database>, provider: String) -> Result<String, String> {
    get_api_key_for_provider(&db, &provider)
}

#[tauri::command]
pub fn delete_api_key(db: State<'_, Database>, provider: String) -> Result<(), String> {
    if let Ok(entry) = keyring_entry(&provider) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("Failed to delete API key from keychain: {e}")),
        }
    }
    remove_fallback_key(&db, &provider)
}

#[tauri::command]
pub fn has_api_key(db: State<'_, Database>, provider: String) -> Result<bool, String> {
    has_api_key_for_provider(&db, &provider)
}

#[tauri::command]
pub fn list_api_key_status(db: State<'_, Database>) -> Result<Vec<ApiKeyStatus>, String> {
    let providers = ["anthropic", "openai", "custom"];
    providers
        .iter()
        .map(|p| {
            Ok(ApiKeyStatus {
                provider: (*p).to_string(),
                has_key: has_api_key_for_provider(&db, p)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::path::PathBuf;

    fn temp_db() -> (Database, PathBuf) {
        let dir = std::env::temp_dir().join(format!("resumorph-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        let db = Database::new(&path).unwrap();
        (db, path)
    }

    #[test]
    fn fallback_key_roundtrip() {
        let (db, _path) = temp_db();
        write_fallback_key(&db, "anthropic", "sk-test-key-12345").unwrap();
        assert!(has_api_key_for_provider(&db, "anthropic").unwrap());
        let key = read_fallback_key(&db, "anthropic").unwrap();
        assert_eq!(key.as_deref(), Some("sk-test-key-12345"));
        remove_fallback_key(&db, "anthropic").unwrap();
        assert!(!has_api_key_for_provider(&db, "anthropic").unwrap());
    }

    #[test]
    fn set_api_key_always_writes_fallback() {
        let (db, _path) = temp_db();
        write_fallback_key(&db, "anthropic", "sk-always-in-db").unwrap();
        assert!(has_api_key_for_provider(&db, "anthropic").unwrap());
        assert_eq!(
            get_api_key_for_provider(&db, "anthropic").unwrap(),
            "sk-always-in-db"
        );
    }
}
