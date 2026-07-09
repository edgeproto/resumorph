import { invoke } from "@tauri-apps/api/core";
import type {
  ApiKeyStatus,
  AppDataInfo,
  CreateOutputInput,
  IngestResult,
  Message,
  Output,
  ParsedResume,
  Profile,
  PromptPreset,
  Session,
} from "./types";

// Re-export input types used by API
export interface CreateProfileInput {
  name: string;
}

export interface CreateSessionInput {
  profileId: string;
  jobDescription?: string;
  jobTitle?: string;
  company?: string;
}

export interface CreatePromptPresetInput {
  name: string;
  systemPrompt: string;
  userPrompt: string;
  mode: string;
  isDefault?: boolean;
}

export interface UpdatePromptPresetInput {
  id: string;
  name?: string;
  systemPrompt?: string;
  userPrompt?: string;
  mode?: string;
  isDefault?: boolean;
}

type CreateMessageInput = {
  sessionId: string;
  role: string;
  content: string;
};

export const api = {
  initAppData: () => invoke<AppDataInfo>("init_app_data"),
  getAppDataInfo: () => invoke<AppDataInfo>("get_app_data_info"),

  listProfiles: () => invoke<Profile[]>("list_profiles"),
  getProfile: (id: string) => invoke<Profile>("get_profile", { id }),
  createProfile: (input: CreateProfileInput) =>
    invoke<Profile>("create_profile", { input }),
  updateProfile: (
    id: string,
    fields: {
      name?: string;
      sourceType?: string;
      templatePath?: string;
      parsedJson?: string;
    },
  ) => invoke<Profile>("update_profile", { id, ...fields }),
  deleteProfile: (id: string) => invoke<void>("delete_profile", { id }),

  listSessions: (profileId?: string) =>
    invoke<Session[]>("list_sessions", { profileId: profileId ?? null }),
  getSession: (id: string) => invoke<Session>("get_session", { id }),
  createSession: (input: CreateSessionInput) =>
    invoke<Session>("create_session", { input }),
  updateSession: (
    id: string,
    fields: {
      jobDescription?: string;
      jobTitle?: string;
      company?: string;
    },
  ) => invoke<Session>("update_session", { id, ...fields }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),

  listMessages: (sessionId: string) =>
    invoke<Message[]>("list_messages", { sessionId }),
  createMessage: (input: CreateMessageInput) =>
    invoke<Message>("create_message", { input }),
  deleteMessage: (id: string) => invoke<void>("delete_message", { id }),

  listPromptPresets: () => invoke<PromptPreset[]>("list_prompt_presets"),
  getPromptPreset: (id: string) =>
    invoke<PromptPreset>("get_prompt_preset", { id }),
  createPromptPreset: (input: CreatePromptPresetInput) =>
    invoke<PromptPreset>("create_prompt_preset", { input }),
  updatePromptPreset: (input: UpdatePromptPresetInput) =>
    invoke<PromptPreset>("update_prompt_preset", { input }),
  deletePromptPreset: (id: string) =>
    invoke<void>("delete_prompt_preset", { id }),

  setApiKey: (provider: string, apiKey: string) =>
    invoke<void>("set_api_key", { provider, apiKey }),
  getApiKey: (provider: string) => invoke<string>("get_api_key", { provider }),
  deleteApiKey: (provider: string) =>
    invoke<void>("delete_api_key", { provider }),
  hasApiKey: (provider: string) =>
    invoke<boolean>("has_api_key", { provider }),
  listApiKeyStatus: () => invoke<ApiKeyStatus[]>("list_api_key_status"),

  pickAndIngestResume: (profileId: string) =>
    invoke<IngestResult | null>("pick_and_ingest_resume", { profileId }),
  ingestResumeFile: (profileId: string, filePath: string) =>
    invoke<IngestResult>("ingest_resume_file", { profileId, filePath }),
  getProfileResumeText: (profileId: string) =>
    invoke<ParsedResume>("get_profile_resume_text", { profileId }),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  getSettingsMap: () =>
    invoke<Record<string, string>>("get_settings_map"),

  readFileBytes: (path: string) =>
    invoke<number[]>("read_file_bytes", { path }),
  saveExportFile: (data: number[], defaultName: string, fileType: string) =>
    invoke<string | null>("save_export_file", { data, defaultName, fileType }),
  detectDocxPlaceholders: (path: string) =>
    invoke<string[]>("detect_docx_placeholders", { path }),
  getBuiltinTemplatePath: (templateId: string) =>
    invoke<string>("get_builtin_template_path", { templateId }),
  listBuiltinTemplates: () => invoke<string[]>("list_builtin_templates"),
  injectDocxPlaceholders: (profileId: string, placeholders: string[]) =>
    invoke<string>("inject_docx_placeholders", { profileId, placeholders }),
  convertDocxToPdf: (docxPath: string, converter?: string) =>
    invoke<string>("convert_docx_to_pdf", { docxPath, converter: converter ?? null }),

  createOutput: (input: CreateOutputInput) =>
    invoke<Output>("create_output", { input }),
  getOutput: (id: string) => invoke<Output>("get_output", { id }),
  listOutputs: (sessionId: string) =>
    invoke<Output[]>("list_outputs", { sessionId }),
};

export function parseProfileResume(profile: Profile): ParsedResume | null {
  if (!profile.parsedJson) return null;
  try {
    return JSON.parse(profile.parsedJson) as ParsedResume;
  } catch {
    return null;
  }
}
