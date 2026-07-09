import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";
import {
  webCreateMessage,
  webCreateOutput,
  webCreateProfile,
  webCreateSession,
  webDeleteProfile,
  webGetProfile,
  webGetSession,
  webInitAppData,
  webListMessages,
  webListProfiles,
  webListPromptPresets,
  webListSessions,
  webUpdateProfile,
  webUpdateSession,
} from "./webDb";
import {
  webDeleteApiKey,
  webGetApiKey,
  webGetSettingsMap,
  webListApiKeyStatus,
  webSetApiKey,
  webSetSetting,
} from "./webStore";
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
  UpdateSessionInput,
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
  resumeJson?: string;
  chatType?: string;
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
  initAppData: () =>
    isTauri() ? invoke<AppDataInfo>("init_app_data") : webInitAppData(),
  getAppDataInfo: () =>
    isTauri() ? invoke<AppDataInfo>("get_app_data_info") : webInitAppData(),

  listProfiles: () =>
    isTauri()
      ? invoke<Profile[]>("list_profiles")
      : Promise.resolve(webListProfiles()),
  getProfile: (id: string) =>
    isTauri()
      ? invoke<Profile>("get_profile", { id })
      : Promise.resolve(webGetProfile(id)),
  createProfile: (input: CreateProfileInput) =>
    isTauri()
      ? invoke<Profile>("create_profile", { input })
      : Promise.resolve(webCreateProfile(input)),
  updateProfile: (
    id: string,
    fields: {
      name?: string;
      sourceType?: string;
      templatePath?: string;
      parsedJson?: string;
    },
  ) =>
    isTauri()
      ? invoke<Profile>("update_profile", { id, ...fields })
      : Promise.resolve(webUpdateProfile(id, fields)),
  deleteProfile: (id: string) =>
    isTauri()
      ? invoke<void>("delete_profile", { id })
      : Promise.resolve(webDeleteProfile(id)),

  listSessions: (profileId?: string) =>
    isTauri()
      ? invoke<Session[]>("list_sessions", { profileId: profileId ?? null })
      : Promise.resolve(webListSessions(profileId)),
  getSession: (id: string) =>
    isTauri()
      ? invoke<Session>("get_session", { id })
      : Promise.resolve(webGetSession(id)),
  createSession: (input: CreateSessionInput) =>
    isTauri()
      ? invoke<Session>("create_session", { input })
      : Promise.resolve(webCreateSession(input)),
  updateSession: (input: UpdateSessionInput) =>
    isTauri()
      ? invoke<Session>("update_session", { input })
      : Promise.resolve(webUpdateSession(input)),
  deleteSession: (id: string) =>
    isTauri() ? invoke<void>("delete_session", { id }) : Promise.resolve(),

  listMessages: (sessionId: string) =>
    isTauri()
      ? invoke<Message[]>("list_messages", { sessionId })
      : Promise.resolve(webListMessages(sessionId)),
  createMessage: (input: CreateMessageInput) =>
    isTauri()
      ? invoke<Message>("create_message", { input })
      : Promise.resolve(webCreateMessage(input)),
  deleteMessage: (id: string) =>
    isTauri() ? invoke<void>("delete_message", { id }) : Promise.resolve(),

  listPromptPresets: () =>
    isTauri()
      ? invoke<PromptPreset[]>("list_prompt_presets")
      : Promise.resolve(webListPromptPresets()),
  getPromptPreset: (id: string) =>
    isTauri()
      ? invoke<PromptPreset>("get_prompt_preset", { id })
      : (() => {
          const preset = webListPromptPresets().find((p) => p.id === id);
          return preset
            ? Promise.resolve(preset)
            : Promise.reject(new Error("Preset not found"));
        })(),
  createPromptPreset: (input: CreatePromptPresetInput) =>
    isTauri()
      ? invoke<PromptPreset>("create_prompt_preset", { input })
      : Promise.reject(new Error("Not available in browser preview")),
  updatePromptPreset: (input: UpdatePromptPresetInput) =>
    isTauri()
      ? invoke<PromptPreset>("update_prompt_preset", { input })
      : Promise.reject(new Error("Not available in browser preview")),
  deletePromptPreset: (id: string) =>
    isTauri()
      ? invoke<void>("delete_prompt_preset", { id })
      : Promise.reject(new Error("Not available in browser preview")),

  setApiKey: (provider: string, apiKey: string) =>
    isTauri()
      ? invoke<void>("set_api_key", { provider, apiKey })
      : Promise.resolve(webSetApiKey(provider, apiKey)),
  getApiKey: (provider: string) =>
    isTauri()
      ? invoke<string>("get_api_key", { provider })
      : Promise.resolve(webGetApiKey(provider)),
  deleteApiKey: (provider: string) =>
    isTauri()
      ? invoke<void>("delete_api_key", { provider })
      : Promise.resolve(webDeleteApiKey(provider)),
  hasApiKey: (provider: string) =>
    isTauri()
      ? invoke<boolean>("has_api_key", { provider })
      : Promise.resolve(!!webGetApiKey(provider)),
  listApiKeyStatus: () =>
    isTauri()
      ? invoke<ApiKeyStatus[]>("list_api_key_status")
      : Promise.resolve(webListApiKeyStatus()),

  pickAndIngestResume: (profileId: string) =>
    isTauri()
      ? invoke<IngestResult | null>("pick_and_ingest_resume", { profileId })
      : Promise.reject(
          new Error("File upload requires the desktop app (npm run tauri dev)"),
        ),
  ingestResumeFile: (profileId: string, filePath: string) =>
    isTauri()
      ? invoke<IngestResult>("ingest_resume_file", { profileId, filePath })
      : Promise.reject(new Error("Not available in browser preview")),
  getProfileResumeText: (profileId: string) =>
    isTauri()
      ? invoke<ParsedResume>("get_profile_resume_text", { profileId })
      : Promise.reject(new Error("Not available in browser preview")),

  getSetting: (key: string) =>
    isTauri()
      ? invoke<string | null>("get_setting", { key })
      : Promise.resolve(webGetSettingsMap()[key] ?? null),
  setSetting: (key: string, value: string) =>
    isTauri()
      ? invoke<void>("set_setting", { key, value })
      : Promise.resolve(webSetSetting(key, value)),
  getSettingsMap: () =>
    isTauri()
      ? invoke<Record<string, string>>("get_settings_map")
      : Promise.resolve(webGetSettingsMap()),

  readFileBytes: (path: string) =>
    isTauri()
      ? invoke<number[]>("read_file_bytes", { path })
      : Promise.reject(new Error("Not available in browser preview")),
  saveExportFile: (data: number[], defaultName: string, fileType: string) =>
    isTauri()
      ? invoke<string | null>("save_export_file", { data, defaultName, fileType })
      : webSaveFile(data, defaultName, fileType),
  detectDocxPlaceholders: (path: string) =>
    isTauri()
      ? invoke<string[]>("detect_docx_placeholders", { path })
      : Promise.resolve([]),
  getBuiltinTemplatePath: (templateId: string) =>
    isTauri()
      ? invoke<string>("get_builtin_template_path", { templateId })
      : Promise.reject(new Error("Export requires the desktop app")),
  listBuiltinTemplates: () =>
    isTauri()
      ? invoke<string[]>("list_builtin_templates")
      : Promise.resolve(["modern", "classic", "ats-friendly"]),
  injectDocxPlaceholders: (profileId: string, placeholders: string[]) =>
    isTauri()
      ? invoke<string>("inject_docx_placeholders", { profileId, placeholders })
      : Promise.reject(new Error("Not available in browser preview")),
  convertDocxToPdf: (docxPath: string, converter?: string) =>
    isTauri()
      ? invoke<string>("convert_docx_to_pdf", {
          docxPath,
          converter: converter ?? null,
        })
      : Promise.reject(new Error("PDF export requires the desktop app")),

  createOutput: (input: CreateOutputInput) =>
    isTauri()
      ? invoke<Output>("create_output", { input })
      : Promise.resolve(webCreateOutput(input)),
  getOutput: (id: string) =>
    isTauri()
      ? invoke<Output>("get_output", { id })
      : Promise.reject(new Error("Not available in browser preview")),
  listOutputs: (sessionId: string) =>
    isTauri()
      ? invoke<Output[]>("list_outputs", { sessionId })
      : Promise.resolve([]),
};

function webSaveFile(
  data: number[],
  defaultName: string,
  fileType: string,
): Promise<string | null> {
  const mime =
    fileType === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const blob = new Blob([new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return Promise.resolve(defaultName);
}

export function parseProfileResume(profile: Profile): ParsedResume | null {
  if (!profile.parsedJson) return null;
  try {
    return JSON.parse(profile.parsedJson) as ParsedResume;
  } catch {
    return null;
  }
}
