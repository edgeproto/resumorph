use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataInfo {
    pub data_dir: String,
    pub db_path: String,
    pub profiles_dir: String,
}

pub fn ensure_app_dirs(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;

    let profiles_dir = data_dir.join("profiles");
    std::fs::create_dir_all(&profiles_dir)
        .map_err(|e| format!("Failed to create profiles directory: {e}"))?;

    Ok(data_dir)
}

pub fn profile_dir(app: &AppHandle, profile_id: &str) -> Result<std::path::PathBuf, String> {
    let data_dir = ensure_app_dirs(app)?;
    let dir = data_dir.join("profiles").join(profile_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create profile directory: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn get_app_data_info(app: AppHandle) -> Result<AppDataInfo, String> {
    let data_dir = ensure_app_dirs(&app)?;
    let db_path = data_dir.join("resumorph.db");
    let profiles_dir = data_dir.join("profiles");

    Ok(AppDataInfo {
        data_dir: data_dir.to_string_lossy().into_owned(),
        db_path: db_path.to_string_lossy().into_owned(),
        profiles_dir: profiles_dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn init_app_data(app: AppHandle) -> Result<AppDataInfo, String> {
    get_app_data_info(app)
}
