use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedJobDescription {
    pub text: String,
    pub job_title: Option<String>,
    pub company: Option<String>,
    pub source_type: String,
}

pub fn parse_jd_text(text: &str, source_type: &str) -> ParsedJobDescription {
    let normalized = text.replace('\r', "").trim().to_string();
    let (job_title, company) = extract_metadata(&normalized);

    ParsedJobDescription {
        text: normalized,
        job_title,
        company,
        source_type: source_type.to_string(),
    }
}

fn extract_metadata(text: &str) -> (Option<String>, Option<String>) {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take(20)
        .collect();

    if lines.is_empty() {
        return (None, None);
    }

    let mut job_title = None;
    let mut company = None;

    // Labeled fields: "Job Title: ...", "Company: ..."
    let label_re = Regex::new(r"(?i)^(job\s*title|position|role|title)\s*[:\-]\s*(.+)$").unwrap();
    let company_re =
        Regex::new(r"(?i)^(company|employer|organization|organisation)\s*[:\-]\s*(.+)$").unwrap();

    for line in &lines {
        if job_title.is_none() {
            if let Some(caps) = label_re.captures(line) {
                job_title = Some(clean_field(caps.get(2).unwrap().as_str()));
                continue;
            }
        }
        if company.is_none() {
            if let Some(caps) = company_re.captures(line) {
                company = Some(clean_field(caps.get(2).unwrap().as_str()));
                continue;
            }
        }
    }

    // "Senior Engineer at Acme Corp" / "Senior Engineer @ Acme"
    let at_re = Regex::new(r"^(.+?)\s+(?:at|@)\s+(.+)$").unwrap();
    if job_title.is_none() || company.is_none() {
        for line in &lines[..lines.len().min(5)] {
            if let Some(caps) = at_re.captures(line) {
                if job_title.is_none() {
                    job_title = Some(clean_field(caps.get(1).unwrap().as_str()));
                }
                if company.is_none() {
                    company = Some(clean_field(caps.get(2).unwrap().as_str()));
                }
                break;
            }
        }
    }

    // "Job Title - Company" on first line
    let dash_re = Regex::new(r"^(.+?)\s*[\-\u{2013}\u{2014}]\s*(.+)$").unwrap();
    if (job_title.is_none() || company.is_none()) && !lines.is_empty() {
        if let Some(caps) = dash_re.captures(lines[0]) {
            let left = clean_field(caps.get(1).unwrap().as_str());
            let right = clean_field(caps.get(2).unwrap().as_str());
            if looks_like_title(&left) && !looks_like_title(&right) {
                if job_title.is_none() {
                    job_title = Some(left);
                }
                if company.is_none() {
                    company = Some(right);
                }
            } else if looks_like_title(&left) {
                if job_title.is_none() {
                    job_title = Some(left);
                }
                if company.is_none() && right.len() < 80 {
                    company = Some(right);
                }
            }
        }
    }

    // First line as title, second as company (common in postings)
    if job_title.is_none() && !lines.is_empty() {
        let first = clean_field(lines[0]);
        if looks_like_title(&first) && first.len() < 100 {
            job_title = Some(first);
        }
    }
    if company.is_none() && lines.len() > 1 && job_title.is_some() {
        let second = clean_field(lines[1]);
        if looks_like_company(&second) {
            company = Some(second);
        }
    }

    // "About {Company}" section hint
    let about_re = Regex::new(r"(?i)^about\s+(.+)$").unwrap();
    if company.is_none() {
        for line in &lines {
            if let Some(caps) = about_re.captures(line) {
                company = Some(clean_field(caps.get(1).unwrap().as_str()));
                break;
            }
        }
    }

    (job_title, company)
}

fn clean_field(s: &str) -> String {
    s.trim()
        .trim_matches(|c: char| c == '*' || c == '#' || c == '|')
        .trim()
        .to_string()
}

fn looks_like_title(s: &str) -> bool {
    let lower = s.to_lowercase();
    !lower.starts_with("http")
        && !lower.contains("www.")
        && s.len() >= 3
        && s.len() <= 120
        && !lower.starts_with("job description")
        && !lower.starts_with("description")
        && !lower.starts_with("requirements")
}

fn looks_like_company(s: &str) -> bool {
    let lower = s.to_lowercase();
    s.len() >= 2
        && s.len() <= 80
        && !lower.starts_with("http")
        && !lower.contains("www.")
        && !lower.starts_with("we are")
        && !lower.starts_with("the ")
        && !lower.starts_with("about")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_labeled_fields() {
        let text = "Job Title: Senior Software Engineer\nCompany: Acme Corp\n\nWe are looking for...";
        let parsed = parse_jd_text(text, "text");
        assert_eq!(parsed.job_title.as_deref(), Some("Senior Software Engineer"));
        assert_eq!(parsed.company.as_deref(), Some("Acme Corp"));
    }

    #[test]
    fn extracts_at_pattern() {
        let text = "Data Scientist at OpenAI\n\nResponsibilities...";
        let parsed = parse_jd_text(text, "text");
        assert_eq!(parsed.job_title.as_deref(), Some("Data Scientist"));
        assert_eq!(parsed.company.as_deref(), Some("OpenAI"));
    }
}
