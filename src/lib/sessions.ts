import type { Session } from "./types";
import { jdLabel } from "./jd";

export function sessionTitle(session: Session): string {
  if (session.jobTitle && session.company) {
    return `${session.jobTitle} @ ${session.company}`;
  }
  if (session.jobTitle) return session.jobTitle;
  if (session.company) return session.company;
  if (session.jobDescription) {
    return jdLabel({
      text: session.jobDescription,
      jobTitle: session.jobTitle,
      company: session.company,
      sourceType: "text",
    }).slice(0, 42);
  }
  return "Untitled session";
}

export function sessionDate(session: Session): string {
  return new Date(session.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function sessionLabel(session: Session): string {
  const title = sessionTitle(session);
  if (title !== "Untitled session") return title;
  return new Date(session.createdAt).toLocaleDateString();
}
