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
    match keyring_entry(provider) {
        Ok(entry) => match entry.get_password() {
            Ok(key) => Ok(key),
            Err(keyring::Error::NoEntry) => read_fallback_key(db, provider)?
                .ok_or_else(|| "No API key configured. Add one in Settings.".into()),
            Err(e) => match read_fallback_key(db, provider)? {
                Some(key) => Ok(key),
                None => Err(format!("Failed to retrieve API key: {e}")),
            },
        },
        Err(e) => read_fallback_key(db, provider)?
            .ok_or_else(|| format!("Failed to retrieve API key: {e}")),
    }
}

pub fn has_api_key_for_provider(db: &Database, provider: &str) -> Result<bool, String> {
    match keyring_entry(provider) {
        Ok(entry) => match entry.get_password() {
            Ok(key) => Ok(!key.trim().is_empty()),
            Err(keyring::Error::NoEntry) => Ok(read_fallback_key(db, provider)?.is_some()),
            Err(_) => Ok(read_fallback_key(db, provider)?.is_some()),
        },
        Err(_) => Ok(read_fallback_key(db, provider)?.is_some()),
    }
}

#[tauri::command]
pub fn set_api_key(
    db: State<'_, Database>,
    provider: String,
    api_key: String,
) -> Result<(), String> {
    match keyring_entry(&provider) {
        Ok(entry) => match entry.set_password(&api_key) {
            Ok(()) => {
                remove_fallback_key(&db, &provider).ok();
                Ok(())
            }
            Err(e) => {
                eprintln!(
                    "Warning: OS keychain storage failed for provider '{provider}', \
                     falling back to local database: {e}"
                );
                write_fallback_key(&db, &provider, &api_key)
            }
        },
        Err(e) => {
            eprintln!(
                "Warning: OS keychain unavailable for provider '{provider}', \
                 storing in local database: {e}"
            );
            write_fallback_key(&db, &provider, &api_key)
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
    fn list_api_key_status_reflects_fallback() {
        let (db, _path) = temp_db();
        write_fallback_key(&db, "openai", "sk-openai-test").unwrap();
        let statuses: Vec<ApiKeyStatus> = ["anthropic", "openai", "custom"]
            .iter()
            .map(|p| ApiKeyStatus {
                provider: (*p).to_string(),
                has_key: has_api_key_for_provider(&db, p).unwrap(),
            })
            .collect();
        let openai = statuses.iter().find(|s| s.provider == "openai").unwrap();
        assert!(openai.has_key);
        let anthropic = statuses.iter().find(|s| s.provider == "anthropic").unwrap();
        assert!(!anthropic.has_key);
    }
}
