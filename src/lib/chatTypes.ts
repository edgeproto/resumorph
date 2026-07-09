import type { Message } from "./types";
import { parseTailoredJson } from "./docx";

export type SessionAction = "tailor" | "cover_letter" | "qa";

export const SESSION_ACTIONS: {
  id: SessionAction;
  label: string;
  buttonLabel?: string;
}[] = [
  { id: "tailor", label: "Tailor resume", buttonLabel: "Tailor Resume" },
  {
    id: "cover_letter",
    label: "Cover letter",
    buttonLabel: "Create Cover Letter",
  },
  { id: "qa", label: "Q&A" },
];

const QUESTION_PREFIX =
  /^(what|how|why|when|where|who|which|can you explain|tell me|is |are |do |does |should i)/i;

export function actionUserMessage(
  action: SessionAction,
  additionalInstructions?: string,
): string {
  const base =
    action === "tailor"
      ? "[Tailor resume]"
      : action === "cover_letter"
        ? "[Create cover letter]"
        : "";
  const extra = additionalInstructions?.trim();
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}

export function displayUserMessage(content: string): string {
  const trimmed = content.trim();
  if (trimmed === "[Tailor resume]") return "Tailor resume";
  if (trimmed.startsWith("[Tailor resume]")) {
    const extra = trimmed.slice("[Tailor resume]".length).trim();
    return extra ? `Tailor resume\n\n${extra}` : "Tailor resume";
  }
  if (trimmed === "[Create cover letter]") return "Create cover letter";
  if (trimmed.startsWith("[Create cover letter]")) {
    const extra = trimmed.slice("[Create cover letter]".length).trim();
    return extra ? `Create cover letter\n\n${extra}` : "Create cover letter";
  }
  return content;
}

export function isExportableAction(action: SessionAction): boolean {
  return action === "tailor" || action === "cover_letter";
}

function isLikelyApplicationQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  return QUESTION_PREFIX.test(t);
}

function lastExportableAction(messages: Message[]): SessionAction | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;

    try {
      const parsed = parseTailoredJson(m.content);
      if (parsed.experience?.length || parsed.summary || parsed.skills?.length) {
        return "tailor";
      }
      if (parsed.cover_letter) {
        return "cover_letter";
      }
    } catch {
      const text = m.content.trim();
      if (text.length > 80 && !text.startsWith("{")) {
        return "cover_letter";
      }
    }
  }
  return null;
}

/** Pick preset for freeform chat based on thread context. */
export function inferActionFromContext(
  messages: Message[],
  userText: string,
): SessionAction {
  const text = userText.trim();
  if (!text || isLikelyApplicationQuestion(text)) return "qa";
  return lastExportableAction(messages) ?? "qa";
}
