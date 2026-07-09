export interface Profile {
  id: string;
  name: string;
  sourceType: string;
  templatePath: string | null;
  parsedJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  profileId: string;
  jobDescription: string | null;
  jobTitle: string | null;
  company: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface PromptPreset {
  id: string;
  name: string;
  systemPrompt: string;
  userPrompt: string;
  mode: string;
  isDefault: boolean;
}

export interface ResumeSection {
  name: string;
  content: string;
}

export interface ParsedResume {
  fullText: string;
  sections: ResumeSection[];
}

export interface AppDataInfo {
  dataDir: string;
  dbPath: string;
  profilesDir: string;
}

export interface IngestResult {
  profile: Profile;
  parsed: ParsedResume;
  storedPath: string;
}

export interface ApiKeyStatus {
  provider: string;
  hasKey: boolean;
}

export type LlmProviderId = "anthropic" | "openai" | "custom";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompleteOptions {
  model: string;
  jsonMode?: boolean;
  temperature?: number;
  baseUrl?: string;
}

export interface Output {
  id: string;
  sessionId: string;
  contentJson: string | null;
  coverLetter: string | null;
  createdAt: string;
}

export interface AppSettings {
  defaultProvider: LlmProviderId;
  defaultModelAnthropic: string;
  defaultModelOpenai: string;
  defaultModelCustom: string;
  customBaseUrl: string;
  temperature: number;
  exportIncludePdf: boolean;
  pdfConverter: "auto" | "word" | "libreoffice";
}

export interface ParsedJobDescription {
  text: string;
  jobTitle: string | null;
  company: string | null;
  sourceType: string;
}

export interface CreateOutputInput {
  sessionId: string;
  contentJson?: string | null;
  coverLetter?: string | null;
}

export interface LLMProvider {
  id: LlmProviderId;
  complete(
    messages: LlmMessage[],
    options: LlmCompleteOptions,
    apiKey: string,
  ): Promise<string>;
}
