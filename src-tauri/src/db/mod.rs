use rusqlite::{Connection, Result as SqlResult};
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &Path) -> SqlResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                rusqlite::Error::InvalidPath(format!("Failed to create db directory: {e}").into())
            })?;
        }

        let conn = Connection::open(db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_type TEXT NOT NULL,
                template_path TEXT,
                parsed_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prompt_presets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                system_prompt TEXT NOT NULL,
                user_prompt TEXT NOT NULL,
                mode TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                job_description TEXT,
                job_title TEXT,
                company TEXT,
                resume_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS outputs (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content_json TEXT,
                cover_letter TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )?;

        seed_default_settings(&conn)?;
        migrate_default_prompts(&conn)?;
        migrate_retired_anthropic_models(&conn)?;
        migrate_sessions_resume_json(&conn)?;
        migrate_sessions_chat_type(&conn)?;

        Ok(())
    }

    pub fn with_conn<F, T>(&self, f: F) -> SqlResult<T>
    where
        F: FnOnce(&Connection) -> SqlResult<T>,
    {
        let conn = self.conn.lock().unwrap();
        f(&conn)
    }
}

const DEFAULT_TAILOR_SYSTEM: &str = "You are an expert resume writer specializing in ATS-optimized, truth-grounded tailoring.\n\n\
Rules:\n\
- Infer seniority (junior, mid, senior) from the job description and match experience depth accordingly.\n\
- Never fabricate skills, roles, employers, dates, or achievements. Only use facts from the candidate's resume.\n\
- Include every job-description skill that truthfully applies; weave keywords naturally into bullets and skills.\n\
- Write for ATS: clear sections, standard job titles, relevant keywords without stuffing.\n\
- Use varied action verbs. Limit quantified metrics to 2–3 per role at most.\n\
- For the three most recent roles, write 5–6 accomplishment bullets each. For older roles, write 3–4 bullets.\n\
- Show career progression and increasing scope where the resume supports it.\n\
- Be specific and concrete; avoid generic filler and buzzword soup.\n\
- Sound like a skilled human writer, not generic AI output.\n\n\
Output: Respond with valid JSON only—no markdown, no commentary. Keys: name, contact, summary, \
experience (array of {title, company, dates optional, bullets as string array}), skills, education.";

const DEFAULT_TAILOR_USER: &str = "Tailor this resume for the target role.\n\n\
Profile: {{profile_name}}\n\
Role: {{job_title}} at {{company}}\n\n\
Resume:\n{{resume_text}}\n\n\
Structured sections:\n{{resume_json}}\n\n\
Job description:\n{{job_description}}\n\n\
Template placeholders (if any): {{placeholder_keys}}\n\n\
{{user_question}}";

const DEFAULT_COVER_LETTER_SYSTEM: &str = "You are an expert cover letter writer for U.S. job applications.\n\n\
Rules:\n\
- Professional, concise American business tone—warm but not stiff.\n\
- Tie 2–3 real resume highlights to specific job requirements; show fit, not repetition of the resume.\n\
- Never fabricate experience, skills, or enthusiasm for work the candidate has not done.\n\
- Avoid clichés (e.g. \"I am writing to express my interest\", \"I would be honored\", \"perfect fit\").\n\
- Target 250–350 words unless the user asks otherwise.\n\
- Write in a natural human voice; vary sentence length and structure.\n\
- On follow-up messages, revise the letter per user feedback while keeping the same JSON format.\n\n\
Output: Respond with valid JSON only—no markdown, no commentary. Use exactly: { \"cover_letter\": \"full letter text\" }.";

const DEFAULT_COVER_LETTER_USER: &str = "Write a cover letter for this application.\n\n\
Profile: {{profile_name}}\n\
Role: {{job_title}} at {{company}}\n\n\
Resume:\n{{resume_text}}\n\n\
Structured sections:\n{{resume_json}}\n\n\
Job description:\n{{job_description}}\n\n\
{{user_question}}";

const DEFAULT_QA_SYSTEM: &str = "You help candidates answer job application and interview questions.\n\n\
Rules:\n\
- Keep answers short: 2–4 sentences unless the user explicitly asks for more detail.\n\
- Use native American English—direct, confident, and conversational, not robotic or overly formal.\n\
- Ground every answer in the candidate's actual resume and the job description; never fabricate experience or skills.\n\
- If you lack information to answer well, say so briefly and suggest what the candidate could truthfully emphasize.\n\
- Respond in plain prose only—no JSON, no bullet lists unless the user asks for them.";

const DEFAULT_QA_USER: &str = "Profile: {{profile_name}}\n\
Role: {{job_title}} at {{company}}\n\n\
Resume:\n{{resume_text}}\n\n\
Structured sections:\n{{resume_json}}\n\n\
Job description:\n{{job_description}}\n\n\
Question: {{user_question}}";

const DEFAULT_SESSION_SYSTEM: &str = "You are an expert career assistant for job applications. \
You help tailor resumes, write cover letters, answer application questions, and identify gaps. \
Never fabricate experience or skills. Use the resume and job description provided in context. \
Reference earlier messages in this conversation when relevant. \
When asked to tailor a resume, respond with valid JSON only (keys: name, contact, summary, experience as array of {title, company, bullets}, skills, education, cover_letter optional). \
Otherwise respond in clear, professional prose.";

const DEFAULT_SESSION_USER: &str = "{{user_question}}";

fn migrate_sessions_resume_json(conn: &Connection) -> SqlResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !cols.iter().any(|c| c == "resume_json") {
        conn.execute("ALTER TABLE sessions ADD COLUMN resume_json TEXT", [])?;
    }

    let session_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM prompt_presets WHERE mode = 'session'",
        [],
        |row| row.get(0),
    )?;
    if session_count == 0 {
        conn.execute(
            "INSERT INTO prompt_presets (id, name, system_prompt, user_prompt, mode, is_default)
             VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                "Default Session",
                DEFAULT_SESSION_SYSTEM,
                DEFAULT_SESSION_USER,
                "session"
            ],
        )?;
    }
    Ok(())
}

fn migrate_sessions_chat_type(conn: &Connection) -> SqlResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !cols.iter().any(|c| c == "chat_type") {
        conn.execute(
            "ALTER TABLE sessions ADD COLUMN chat_type TEXT NOT NULL DEFAULT 'qa'",
            [],
        )?;
    }
    Ok(())
}

fn migrate_default_prompts(conn: &Connection) -> SqlResult<()> {
    const PROMPTS_VERSION: &str = "2";

    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'default_prompts_version'",
            [],
            |row| row.get(0),
        )
        .ok();

    if version.as_deref() == Some(PROMPTS_VERSION) {
        return Ok(());
    }

    upsert_default_preset(
        conn,
        "tailor",
        "Default Tailor",
        DEFAULT_TAILOR_SYSTEM,
        DEFAULT_TAILOR_USER,
    )?;
    upsert_default_preset(
        conn,
        "cover_letter",
        "Default Cover Letter",
        DEFAULT_COVER_LETTER_SYSTEM,
        DEFAULT_COVER_LETTER_USER,
    )?;
    upsert_default_preset(
        conn,
        "qa",
        "Default Q&A",
        DEFAULT_QA_SYSTEM,
        DEFAULT_QA_USER,
    )?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('default_prompts_version', ?1)",
        [PROMPTS_VERSION],
    )?;

    Ok(())
}

fn upsert_default_preset(
    conn: &Connection,
    mode: &str,
    name: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> SqlResult<()> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM prompt_presets WHERE mode = ?1 AND is_default = 1",
            [mode],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        conn.execute(
            "UPDATE prompt_presets SET name = ?1, system_prompt = ?2, user_prompt = ?3 WHERE id = ?4",
            rusqlite::params![name, system_prompt, user_prompt, id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO prompt_presets (id, name, system_prompt, user_prompt, mode, is_default)
             VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                name,
                system_prompt,
                user_prompt,
                mode
            ],
        )?;
    }
    Ok(())
}

fn migrate_retired_anthropic_models(conn: &Connection) -> SqlResult<()> {
    const CURRENT: &str = "claude-sonnet-4-6";
    const RETIRED: &[&str] = &[
        "claude-sonnet-4-20250514",
        "claude-sonnet-4-0",
        "claude-sonnet-4",
        "claude-opus-4-20250514",
    ];

    let current: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'default_model_anthropic'",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(model) = current {
        if RETIRED.iter().any(|r| *r == model.as_str()) {
            conn.execute(
                "UPDATE settings SET value = ?1 WHERE key = 'default_model_anthropic'",
                [CURRENT],
            )?;
        }
    }
    Ok(())
}

fn seed_default_settings(conn: &Connection) -> SqlResult<()> {
    let defaults = [
        ("default_provider", "anthropic"),
        ("default_model_anthropic", "claude-sonnet-4-6"),
        ("default_model_openai", "gpt-4o"),
        ("default_model_custom", "gpt-4o"),
        ("custom_base_url", "http://localhost:11434/v1/chat/completions"),
        ("temperature", "0.7"),
        ("export_include_pdf", "false"),
        ("pdf_converter", "auto"),
    ];

    for (key, value) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
    }
    Ok(())
}
