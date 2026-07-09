import { invoke } from "@tauri-apps/api/core";
import type { ParsedResume } from "./types";
import { isTauri } from "./tauri";

export async function parseResumeText(text: string): Promise<ParsedResume> {
  if (isTauri()) {
    return invoke<ParsedResume>("parse_resume_from_text", { text });
  }
  return parseResumeTextLocal(text);
}

export async function parseResumeFile(file: File): Promise<ParsedResume> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "txt" || ext === "md") {
    const text = await file.text();
    return parseResumeText(text);
  }

  if (isTauri()) {
    return invoke<ParsedResume>("parse_resume_from_file", {
      filePath: (file as File & { path?: string }).path ?? file.name,
    });
  }

  throw new Error(
    "DOCX and PDF resumes require the desktop app. Paste text or upload a .txt file.",
  );
}

export async function pickAndParseResume(): Promise<ParsedResume | null> {
  if (!isTauri()) return null;
  return invoke<ParsedResume | null>("pick_and_parse_resume");
}

function parseResumeTextLocal(text: string): ParsedResume {
  const normalized = text.replace(/\r/g, "").trim();
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  const sections: { name: string; content: string }[] = [];
  const headers = [
    "summary",
    "experience",
    "education",
    "skills",
    "projects",
    "certifications",
  ];
  let current = "header";
  let buf: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase().replace(/[^a-z ]/g, "").trim();
    const match = headers.find((h) => lower === h || lower.startsWith(h + " "));
    if (match) {
      if (buf.length) sections.push({ name: current, content: buf.join("\n") });
      current = match;
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) sections.push({ name: current, content: buf.join("\n") });
  if (!sections.length) sections.push({ name: "content", content: normalized });

  return { fullText: normalized, sections };
}

export function resumeLabel(resume: ParsedResume): string {
  const first = resume.sections[0]?.content.split("\n")[0] ?? "Resume";
  return first.slice(0, 50) + (first.length > 50 ? "..." : "");
}
