import type { LlmCompleteOptions, LlmMessage, LLMProvider } from "../types";

const OPENAI_API = "https://api.openai.com/v1/chat/completions";

export const openaiProvider: LLMProvider = {
  id: "openai",

  async complete(messages, options, apiKey) {
    const baseUrl = options.baseUrl || OPENAI_API;

    const body: Record<string, unknown> = {
      model: options.model || "gpt-4o",
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    let response: Response;
    try {
      response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(
        `Network error calling LLM: ${(e as Error).message}. Restart the dev server if you just updated the app.`,
      );
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content ?? "";
  },
};

export function createCustomOpenAiProvider(baseUrl: string): LLMProvider {
  return {
    id: "custom",
    complete(messages: LlmMessage[], options: LlmCompleteOptions, apiKey: string) {
      return openaiProvider.complete(messages, { ...options, baseUrl }, apiKey);
    },
  };
}
