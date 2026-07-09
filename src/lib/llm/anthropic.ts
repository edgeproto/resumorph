import type { LLMProvider } from "../types";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export const anthropicProvider: LLMProvider = {
  id: "anthropic",

  async complete(messages, options, apiKey) {
    const system = messages.find((m) => m.role === "system")?.content;
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const body: Record<string, unknown> = {
      model: options.model || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: chatMessages,
    };

    if (system) {
      body.system = system;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const response = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = data.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("");

    if (options.jsonMode) {
      return extractJson(text);
    }

    return text;
  },
};

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}
