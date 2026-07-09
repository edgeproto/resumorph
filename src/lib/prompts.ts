import type { ParsedResume, PromptPreset } from "./types";

export const PROMPT_VARIABLES = [
  { key: "resume_text", label: "Resume text", description: "Full parsed resume" },
  { key: "resume_json", label: "Resume JSON", description: "Structured sections" },
  { key: "job_description", label: "Job description", description: "Target job posting" },
  { key: "profile_name", label: "Profile name", description: "Profile display name" },
  { key: "placeholder_keys", label: "Placeholder keys", description: "Template placeholder list" },
  { key: "user_question", label: "User question", description: "Q&A chat question" },
  { key: "job_title", label: "Job title", description: "Target role title" },
  { key: "company", label: "Company", description: "Target company name" },
] as const;

export type PromptVariableKey = (typeof PROMPT_VARIABLES)[number]["key"];

export interface PromptContext {
  resumeText?: string;
  resumeJson?: string;
  jobDescription?: string;
  profileName?: string;
  placeholderKeys?: string;
  userQuestion?: string;
  jobTitle?: string;
  company?: string;
}

export function interpolatePrompt(template: string, context: PromptContext): string {
  return template
    .replace(/\{\{resume_text\}\}/g, context.resumeText ?? "")
    .replace(/\{\{resume_json\}\}/g, context.resumeJson ?? "")
    .replace(/\{\{job_description\}\}/g, context.jobDescription ?? "")
    .replace(/\{\{profile_name\}\}/g, context.profileName ?? "")
    .replace(/\{\{placeholder_keys\}\}/g, context.placeholderKeys ?? "")
    .replace(/\{\{user_question\}\}/g, context.userQuestion ?? "")
    .replace(/\{\{job_title\}\}/g, context.jobTitle ?? "")
    .replace(/\{\{company\}\}/g, context.company ?? "");
}

export function buildPromptContext(
  parsed: ParsedResume | null,
  profileName: string,
  extras: Partial<PromptContext> = {},
): PromptContext {
  return {
    resumeText: parsed?.fullText ?? "",
    resumeJson: parsed ? JSON.stringify(parsed.sections, null, 2) : "",
    profileName,
    ...extras,
  };
}

export function getDefaultPreset(
  presets: PromptPreset[],
  mode: "tailor" | "cover_letter" | "qa" | "session",
): PromptPreset | undefined {
  return (
    presets.find((p) => p.mode === mode && p.isDefault) ??
    presets.find((p) => p.mode === mode)
  );
}

export const DEFAULT_PLACEHOLDER_KEYS = [
  "name",
  "contact",
  "summary",
  "experience",
  "skills",
  "education",
];
