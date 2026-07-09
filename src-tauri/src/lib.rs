mod commands;
mod db;
mod docx;
mod jd_parser;
mod pdf;
mod resume_parser;

use commands::app_data::{ensure_app_dirs, get_app_data_info, init_app_data};
use commands::keys::{
    delete_api_key, get_api_key, has_api_key, list_api_key_status, set_api_key,
};
use commands::llm::complete_llm;
use commands::messages::{create_message, delete_message, list_messages};
use commands::profiles::{
    create_profile, delete_profile, get_profile, list_profiles, update_profile,
};
use commands::prompt_presets::{
    create_prompt_preset, delete_prompt_preset, get_prompt_preset, list_prompt_presets,
    update_prompt_preset,
};
use commands::export::{
    convert_docx_to_pdf, create_output, detect_docx_placeholders, get_builtin_template_path,
    get_output, inject_docx_placeholders, list_builtin_templates, list_outputs, read_file_bytes,
    save_export_file,
};
use commands::jd::{parse_jd_from_file, parse_jd_from_text, pick_and_parse_jd};
use commands::resume::{get_profile_resume_text, ingest_resume_file, pick_and_ingest_resume};
use commands::resume_parse::{
    parse_resume_from_file, parse_resume_from_text, pick_and_parse_resume,
};
use commands::sessions::{
    create_session, delete_session, get_session, list_sessions, update_session,
};
use commands::settings::{get_setting, get_settings_map, list_settings, set_setting};
use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = ensure_app_dirs(app.handle())?;
            let db_path = data_dir.join("resumorph.db");
            let database = Database::new(&db_path).map_err(|e| e.to_string())?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_app_data,
            get_app_data_info,
            list_profiles,
            get_profile,
            create_profile,
            update_profile,
            delete_profile,
            list_sessions,
            get_session,
            create_session,
            update_session,
            delete_session,
            list_messages,
            create_message,
            delete_message,
            list_prompt_presets,
            get_prompt_preset,
            create_prompt_preset,
            update_prompt_preset,
            delete_prompt_preset,
            set_api_key,
            get_api_key,
            delete_api_key,
            has_api_key,
            list_api_key_status,
            complete_llm,
            ingest_resume_file,
            pick_and_ingest_resume,
            get_profile_resume_text,
            get_setting,
            set_setting,
            list_settings,
            get_settings_map,
            read_file_bytes,
            save_export_file,
            detect_docx_placeholders,
            get_builtin_template_path,
            list_builtin_templates,
            inject_docx_placeholders,
            convert_docx_to_pdf,
            create_output,
            get_output,
            list_outputs,
            parse_jd_from_text,
            parse_jd_from_file,
            pick_and_parse_jd,
            parse_resume_from_text,
            parse_resume_from_file,
            pick_and_parse_resume,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
