use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "resumorph";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub provider: String,
    pub has_key: bool,
}

fn keyring_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, provider).map_err(|e| format!("Keyring error: {e}"))
}

#[tauri::command]
pub fn set_api_key(provider: String, api_key: String) -> Result<(), String> {
    let entry = keyring_entry(&provider)?;
    entry
        .set_password(&api_key)
        .map_err(|e| format!("Failed to store API key: {e}"))
}

#[tauri::command]
pub fn get_api_key(provider: String) -> Result<String, String> {
    let entry = keyring_entry(&provider)?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to retrieve API key: {e}"))
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    let entry = keyring_entry(&provider)?;
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete API key: {e}"))
}

#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    match keyring_entry(&provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to check API key: {e}")),
    }
}

#[tauri::command]
pub fn list_api_key_status() -> Result<Vec<ApiKeyStatus>, String> {
    let providers = ["anthropic", "openai", "custom"];
    providers
        .iter()
        .map(|p| {
            Ok(ApiKeyStatus {
                provider: (*p).to_string(),
                has_key: has_api_key((*p).to_string())?,
            })
        })
        .collect()
}
