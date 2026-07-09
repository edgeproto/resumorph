use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSection {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedResume {
    pub full_text: String,
    pub sections: Vec<ResumeSection>,
}

const SECTION_HEADERS: &[&str] = &[
    "summary",
    "professional summary",
    "objective",
    "profile",
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "education",
    "skills",
    "technical skills",
    "core competencies",
    "certifications",
    "projects",
    "awards",
    "publications",
    "languages",
    "interests",
    "volunteer",
];

pub fn parse_sections(text: &str) -> ParsedResume {
    let normalized = text.replace('\r', "");
    let lines: Vec<&str> = normalized.lines().collect();

    let header_re = Regex::new(r"^[\s\-\*•]*(.+?)[\s\-\*:]*$").unwrap();
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    let mut preamble: Vec<String> = Vec::new();
    let mut current_header: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();

    for line in &lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(header) = detect_section_header(trimmed, &header_re) {
            if let Some(h) = current_header.take() {
                sections.push((h, std::mem::take(&mut current_lines)));
            } else if !preamble.is_empty() {
                sections.push(("header".to_string(), preamble.clone()));
                preamble.clear();
            }
            current_header = Some(header);
            continue;
        }

        if current_header.is_some() {
            current_lines.push(trimmed.to_string());
        } else {
            preamble.push(trimmed.to_string());
        }
    }

    if let Some(h) = current_header {
        sections.push((h, current_lines));
    } else if !preamble.is_empty() {
        sections.push(("header".to_string(), preamble));
    }

    if sections.is_empty() {
        sections.push(("content".to_string(), normalized.lines().map(String::from).collect()));
    }

    let resume_sections: Vec<ResumeSection> = sections
        .into_iter()
        .map(|(name, lines)| ResumeSection {
            name,
            content: lines.join("\n"),
        })
        .collect();

    ParsedResume {
        full_text: normalized.trim().to_string(),
        sections: resume_sections,
    }
}

fn detect_section_header(line: &str, header_re: &Regex) -> Option<String> {
    let cleaned = line
        .trim_matches(|c: char| c == '-' || c == '*' || c == '•' || c == ':' || c.is_whitespace())
        .to_lowercase();

    if cleaned.len() > 60 {
        return None;
    }

    for header in SECTION_HEADERS {
        if cleaned == *header || cleaned.starts_with(&format!("{header} ")) {
            return Some(normalize_section_name(header));
        }
    }

    if let Some(caps) = header_re.captures(line) {
        let candidate = caps.get(1)?.as_str().trim().to_lowercase();
        if candidate.len() <= 40 && is_likely_header(&candidate) {
            for header in SECTION_HEADERS {
                if candidate.contains(header) {
                    return Some(normalize_section_name(header));
                }
            }
            if candidate.chars().all(|c| c.is_ascii_uppercase() || c.is_whitespace() || c == '&')
                && candidate.len() >= 3
            {
                return Some(normalize_section_name(&candidate));
            }
        }
    }

    None
}

fn is_likely_header(s: &str) -> bool {
    SECTION_HEADERS.iter().any(|h| s.contains(h))
        || (s.chars().filter(|c| c.is_uppercase()).count() > s.len() / 2 && s.len() < 30)
}

fn normalize_section_name(name: &str) -> String {
    let mut map = HashMap::new();
    map.insert("professional summary", "summary");
    map.insert("objective", "summary");
    map.insert("profile", "summary");
    map.insert("work experience", "experience");
    map.insert("professional experience", "experience");
    map.insert("employment", "experience");
    map.insert("technical skills", "skills");
    map.insert("core competencies", "skills");

    map.get(name)
        .map(|s| (*s).to_string())
        .unwrap_or_else(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_sections() {
        let text = "John Doe\nSoftware Engineer\n\nSUMMARY\nExperienced developer.\n\nEXPERIENCE\nAcme Corp - 2020-2024\n\nEDUCATION\nMIT";
        let parsed = parse_sections(text);
        assert!(parsed.sections.iter().any(|s| s.name == "summary"));
        assert!(parsed.sections.iter().any(|s| s.name == "experience"));
        assert!(parsed.sections.iter().any(|s| s.name == "education"));
    }
}
