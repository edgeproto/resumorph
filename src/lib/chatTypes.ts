export type ChatType = "tailor" | "cover_letter" | "qa";

export const CHAT_TYPES: { id: ChatType; label: string; description: string }[] =
  [
    {
      id: "tailor",
      label: "Tailor resume",
      description: "Rewrite your resume for this job — export when ready",
    },
    {
      id: "cover_letter",
      label: "Cover letter",
      description: "Draft and refine a cover letter — export when ready",
    },
    {
      id: "qa",
      label: "Q&A",
      description: "Answer application and interview questions",
    },
  ];

export function chatTypeLabel(type: ChatType): string {
  return CHAT_TYPES.find((t) => t.id === type)?.label ?? type;
}

export function isExportableChatType(type: ChatType): boolean {
  return type === "tailor" || type === "cover_letter";
}
