use crate::db::Database;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageInput {
    pub session_id: String,
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub fn list_messages(db: State<'_, Database>, session_id: String) -> Result<Vec<Message>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, created_at
             FROM messages WHERE session_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([&session_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        rows.collect()
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_message(
    db: State<'_, Database>,
    input: CreateMessageInput,
) -> Result<Message, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&id, &input.session_id, &input.role, &input.content, &now],
        )?;
        Ok(Message {
            id,
            session_id: input.session_id,
            role: input.role,
            content: input.content,
            created_at: now,
        })
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_message(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM messages WHERE id = ?1", [&id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}
