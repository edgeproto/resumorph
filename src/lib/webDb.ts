import type {
  CreateOutputInput,
  Message,
  Output,
  Profile,
  PromptPreset,
  Session,
  UpdateSessionInput,
} from "./types";

interface CreateProfileInput {
  name: string;
}

interface CreateSessionInput {
  profileId: string;
  jobDescription?: string;
  jobTitle?: string;
  company?: string;
  resumeJson?: string;
  chatType?: string;
}

const DB_KEY = "resumorph_web_db";

interface WebDb {
  profiles: Profile[];
  sessions: Session[];
  messages: Message[];
  outputs: Output[];
}

const DEFAULT_PRESETS: PromptPreset[] = [
  {
    id: "web-session",
    name: "Default Session",
    systemPrompt:
      "You are an expert career assistant for job applications. Help tailor resumes, write cover letters, and answer application questions. Never fabricate experience. Reference earlier messages when relevant.",
    userPrompt: "{{user_question}}",
    mode: "session",
    isDefault: true,
  },
  {
    id: "web-qa",
    name: "Default Q&A",
    systemPrompt:
      "You help with job application questions. Be concise and truthful.",
    userPrompt:
      "Profile: {{profile_name}}\nResume:\n{{resume_text}}\nJob:\n{{job_description}}\nQuestion: {{user_question}}",
    mode: "qa",
    isDefault: true,
  },
];

function loadDb(): WebDb {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return { profiles: [], sessions: [], messages: [], outputs: [] };
    const db = JSON.parse(raw) as WebDb;
    for (const session of db.sessions) {
      if (!session.chatType) session.chatType = "qa";
    }
    return db;
  } catch {
    return { profiles: [], sessions: [], messages: [], outputs: [] };
  }
}

function saveDb(db: WebDb) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

export function webInitAppData() {
  return Promise.resolve({
    dataDir: "browser-localStorage",
    dbPath: "browser-localStorage",
    profilesDir: "browser-localStorage",
  });
}

export function webListProfiles(): Profile[] {
  return loadDb().profiles.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function webGetProfile(profileId: string): Profile {
  const profile = loadDb().profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  return profile;
}

export function webCreateProfile(input: CreateProfileInput): Profile {
  const db = loadDb();
  const ts = now();
  const profile: Profile = {
    id: id(),
    name: input.name,
    sourceType: "pending",
    templatePath: null,
    parsedJson: null,
    createdAt: ts,
    updatedAt: ts,
  };
  db.profiles.push(profile);
  saveDb(db);
  return profile;
}

export function webUpdateProfile(
  profileId: string,
  fields: {
    name?: string;
    sourceType?: string;
    templatePath?: string;
    parsedJson?: string;
  },
): Profile {
  const db = loadDb();
  const idx = db.profiles.findIndex((p) => p.id === profileId);
  if (idx === -1) throw new Error(`Profile not found: ${profileId}`);
  const existing = db.profiles[idx];
  db.profiles[idx] = {
    ...existing,
    name: fields.name ?? existing.name,
    sourceType: fields.sourceType ?? existing.sourceType,
    templatePath: fields.templatePath ?? existing.templatePath,
    parsedJson: fields.parsedJson ?? existing.parsedJson,
    updatedAt: now(),
  };
  saveDb(db);
  return db.profiles[idx];
}

export function webDeleteProfile(profileId: string) {
  const db = loadDb();
  db.profiles = db.profiles.filter((p) => p.id !== profileId);
  const sessionIds = db.sessions
    .filter((s) => s.profileId === profileId)
    .map((s) => s.id);
  db.sessions = db.sessions.filter((s) => s.profileId !== profileId);
  db.messages = db.messages.filter((m) => !sessionIds.includes(m.sessionId));
  db.outputs = db.outputs.filter((o) => !sessionIds.includes(o.sessionId));
  saveDb(db);
}

export function webListSessions(profileId?: string): Session[] {
  const sessions = loadDb().sessions;
  const filtered = profileId
    ? sessions.filter((s) => s.profileId === profileId)
    : sessions;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function webGetSession(sessionId: string): Session {
  const session = loadDb().sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

export function webCreateSession(input: CreateSessionInput): Session {
  const db = loadDb();
  const session: Session = {
    id: id(),
    profileId: input.profileId,
    jobDescription: input.jobDescription ?? null,
    jobTitle: input.jobTitle ?? null,
    company: input.company ?? null,
    resumeJson: input.resumeJson ?? null,
    chatType: input.chatType ?? "qa",
    createdAt: now(),
  };
  db.sessions.push(session);
  saveDb(db);
  return session;
}

export function webUpdateSession(input: UpdateSessionInput): Session {
  const db = loadDb();
  const idx = db.sessions.findIndex((s) => s.id === input.id);
  if (idx === -1) throw new Error(`Session not found: ${input.id}`);
  const existing = db.sessions[idx];
  db.sessions[idx] = {
    ...existing,
    jobDescription:
      input.jobDescription !== undefined
        ? input.jobDescription
        : existing.jobDescription,
    jobTitle:
      input.jobTitle !== undefined ? input.jobTitle : existing.jobTitle,
    company: input.company !== undefined ? input.company : existing.company,
    resumeJson: input.clearResume
      ? null
      : input.resumeJson !== undefined
        ? input.resumeJson
        : existing.resumeJson,
    chatType:
      input.chatType !== undefined ? input.chatType : existing.chatType,
  };
  saveDb(db);
  return db.sessions[idx];
}

export function webListMessages(sessionId: string): Message[] {
  return loadDb()
    .messages.filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function webCreateMessage(input: {
  sessionId: string;
  role: string;
  content: string;
}): Message {
  const db = loadDb();
  const message: Message = {
    id: id(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    createdAt: now(),
  };
  db.messages.push(message);
  saveDb(db);
  return message;
}

export function webCreateOutput(input: CreateOutputInput): Output {
  const db = loadDb();
  const output: Output = {
    id: id(),
    sessionId: input.sessionId,
    contentJson: input.contentJson ?? null,
    coverLetter: input.coverLetter ?? null,
    createdAt: now(),
  };
  db.outputs.push(output);
  saveDb(db);
  return output;
}

export function webListPromptPresets(): PromptPreset[] {
  return DEFAULT_PRESETS;
}
