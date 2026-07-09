use crate::commands::keys::get_api_key_for_provider;
use crate::db::Database;
use reqwest::blocking::Client;
use std::time::Duration;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessageInput {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteLlmInput {
    pub provider: String,
    pub messages: Vec<LlmMessageInput>,
    pub model: String,
    pub json_mode: Option<bool>,
    pub temperature: Option<f64>,
    pub base_url: Option<String>,
}

#[tauri::command]
pub fn complete_llm(db: State<'_, Database>, input: CompleteLlmInput) -> Result<String, String> {
    let api_key = get_api_key_for_provider(&db, &input.provider)?;
    if api_key.trim().is_empty() {
        return Err("No API key configured. Add one in Settings.".into());
    }

    match input.provider.as_str() {
        "anthropic" => complete_anthropic(&input, &api_key),
        "openai" | "custom" => complete_openai(&input, &api_key),
        other => Err(format!("Unknown provider: {other}")),
    }
}

fn complete_anthropic(input: &CompleteLlmInput, api_key: &str) -> Result<String, String> {
    let system = input
        .messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    let chat_messages: Vec<Value> = input
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            json!({
                "role": if m.role == "assistant" { "assistant" } else { "user" },
                "content": m.content,
            })
        })
        .collect();

    let mut body = json!({
        "model": input.model,
        "max_tokens": 8192,
        "messages": chat_messages,
    });

    if let Some(system) = system {
        body["system"] = json!(system);
    }
    if let Some(temp) = input.temperature {
        body["temperature"] = json!(temp);
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("Content-Type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .map_err(|e| format!("Network error calling Anthropic: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .map_err(|e| format!("Failed to read Anthropic response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Anthropic API error ({status}): {text}"));
    }

    let data: Value =
        serde_json::from_str(&text).map_err(|e| format!("Invalid Anthropic response: {e}"))?;

    let content = data["content"]
        .as_array()
        .ok_or_else(|| "Missing content in Anthropic response".to_string())?;

    let joined = content
        .iter()
        .filter_map(|block| {
            if block["type"].as_str() == Some("text") {
                block["text"].as_str()
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("");

    if joined.trim().is_empty() {
        return Err("Anthropic returned an empty response".into());
    }

    if input.json_mode.unwrap_or(false) {
        Ok(extract_json(&joined))
    } else {
        Ok(joined)
    }
}

fn complete_openai(input: &CompleteLlmInput, api_key: &str) -> Result<String, String> {
    let base_url = input
        .base_url
        .as_deref()
        .unwrap_or("https://api.openai.com/v1/chat/completions");

    let messages: Vec<Value> = input
        .messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();

    let mut body = json!({
        "model": input.model,
        "messages": messages,
    });

    if let Some(temp) = input.temperature {
        body["temperature"] = json!(temp);
    }
    if input.json_mode.unwrap_or(false) {
        body["response_format"] = json!({ "type": "json_object" });
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;
    let response = client
        .post(base_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .map_err(|e| format!("Network error calling LLM: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .map_err(|e| format!("Failed to read LLM response: {e}"))?;

    if !status.is_success() {
        return Err(format!("LLM API error ({status}): {text}"));
    }

    let data: Value =
        serde_json::from_str(&text).map_err(|e| format!("Invalid LLM response: {e}"))?;

    data["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing message content in LLM response".to_string())
}

fn extract_json(text: &str) -> String {
    if let Some(caps) = regex::Regex::new(r"```(?:json)?\s*([\s\S]*?)```")
        .ok()
        .and_then(|re| re.captures(text))
    {
        return caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
    }

    if let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) {
        if end > start {
            return text[start..=end].to_string();
        }
    }

    text.trim().to_string()
}
