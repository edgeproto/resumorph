import { invoke } from "@tauri-apps/api/core";
import type { ParsedJobDescription } from "./types";
import { isTauri } from "./tauri";

export async function parseJdText(text: string): Promise<ParsedJobDescription> {
  if (isTauri()) {
    return invoke<ParsedJobDescription>("parse_jd_from_text", { text });
  }
  return parseJdTextLocal(text);
}

export async function parseJdFile(file: File): Promise<ParsedJobDescription> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "txt" || ext === "md") {
    const text = await file.text();
    return parseJdText(text);
  }

  if (isTauri()) {
    return invoke<ParsedJobDescription>("parse_jd_from_file", {
      filePath: (file as File & { path?: string }).path ?? file.name,
    });
  }

  throw new Error(
    "DOCX and PDF job descriptions require the desktop app. Paste the text or upload a .txt file.",
  );
}

export async function pickAndParseJd(): Promise<ParsedJobDescription | null> {
  if (!isTauri()) return null;
  return invoke<ParsedJobDescription | null>("pick_and_parse_jd");
}

/** Browser-side fallback when Tauri backend is unavailable. */
function parseJdTextLocal(text: string): ParsedJobDescription {
  const normalized = text.replace(/\r/g, "").trim();
  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);

  let jobTitle: string | null = null;
  let company: string | null = null;

  for (const line of lines) {
    const titleMatch = line.match(
      /^(?:job\s*title|position|role|title)\s*[:\-]\s*(.+)$/i,
    );
    if (titleMatch && !jobTitle) jobTitle = clean(titleMatch[1]);

    const companyMatch = line.match(
      /^(?:company|employer|organization)\s*[:\-]\s*(.+)$/i,
    );
    if (companyMatch && !company) company = clean(companyMatch[1]);
  }

  const atMatch = lines[0]?.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch) {
    if (!jobTitle) jobTitle = clean(atMatch[1]);
    if (!company) company = clean(atMatch[2]);
  }

  const dashMatch = lines[0]?.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    if (!jobTitle) jobTitle = clean(dashMatch[1]);
    if (!company) company = clean(dashMatch[2]);
  }

  if (!jobTitle && lines[0] && lines[0].length < 100) {
    jobTitle = clean(lines[0]);
  }
  if (!company && lines[1] && lines[1].length < 80) {
    company = clean(lines[1]);
  }

  return {
    text: normalized,
    jobTitle,
    company,
    sourceType: "text",
  };
}

function clean(s: string): string {
  return s.trim().replace(/^[*#|]+|[*#|]+$/g, "").trim();
}

export function jdLabel(jd: ParsedJobDescription): string {
  if (jd.jobTitle && jd.company) return `${jd.jobTitle} @ ${jd.company}`;
  if (jd.jobTitle) return jd.jobTitle;
  if (jd.company) return jd.company;
  return "Job description";
}
