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

export function isExportableAction(action: SessionAction): boolean {
  return action === "tailor" || action === "cover_letter";
}

/** @deprecated Use SessionAction */
export type ChatType = SessionAction;

/** @deprecated Use SESSION_ACTIONS */
export const CHAT_TYPES = SESSION_ACTIONS.map((a) => ({
  id: a.id,
  label: a.label,
  description: a.label,
}));

export function chatTypeLabel(type: SessionAction): string {
  return SESSION_ACTIONS.find((t) => t.id === type)?.label ?? type;
}

export function isExportableChatType(type: SessionAction): boolean {
  return isExportableAction(type);
}
