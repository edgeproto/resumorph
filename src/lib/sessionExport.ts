import type { Message } from "./types";
import type { TailoredResume } from "./docx";
import { parseTailoredJson } from "./docx";
import type { ChatType } from "./chatTypes";

export interface ExportableContent {
  tailored: TailoredResume | null;
  coverLetter: string | null;
}

export function findLatestExportable(
  messages: Message[],
  chatType: ChatType,
): ExportableContent {
  let tailored: TailoredResume | null = null;
  let coverLetter: string | null = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;

    if (chatType === "tailor" && !tailored) {
      try {
        const parsed = parseTailoredJson(m.content);
        if (parsed.experience || parsed.summary || parsed.skills) {
          tailored = parsed;
        }
      } catch {
        /* not JSON */
      }
    }

    if (chatType === "cover_letter" && !coverLetter) {
      try {
        const parsed = parseTailoredJson(m.content);
        if (parsed.cover_letter) {
          coverLetter = parsed.cover_letter;
        }
      } catch {
        const text = m.content.trim();
        if (text.length > 80) {
          coverLetter = text;
        }
      }
    }

    if (
      (chatType === "tailor" && tailored) ||
      (chatType === "cover_letter" && coverLetter)
    ) {
      break;
    }
  }

  return { tailored, coverLetter };
}

export const COVER_LETTER_SYSTEM_PROMPT = `You are an expert cover letter writer for job applications.
Never fabricate experience or skills. Use only facts from the candidate's resume.
Write in a professional, concise tone tailored to the job description.
When producing or revising a cover letter, respond with JSON only: { "cover_letter": "full letter text" }.
Incorporate user feedback on follow-up messages while keeping the same JSON format.`;

export const COVER_LETTER_USER_PROMPT = `Write a cover letter for this application.

Profile: {{profile_name}}
Role: {{job_title}} at {{company}}

Resume:
{{resume_text}}

Job description:
{{job_description}}

{{user_question}}`;
