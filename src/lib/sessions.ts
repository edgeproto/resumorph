import type { Session } from "./types";
import { jdLabel } from "./jd";

export function sessionLabel(session: Session): string {
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
  return new Date(session.createdAt).toLocaleDateString();
}
