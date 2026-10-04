export type GroqModelKind = "chat" | "vision" | "stt" | "other";

export interface GroqChatModel {
  id: string;
  label: string;
  supportsImages: boolean;
  kind: GroqModelKind;
}

function classify(id: string, modelType: unknown): GroqModelKind {
  const type = typeof modelType === "string" ? modelType : "";
  if (/whisper|transcrib/i.test(id) || /audio|transcrib/i.test(type)) return "stt";
  if (/tts|speech|embed|moderation|rerank/i.test(id) || /tts|speech|embed|rerank/i.test(type)) return "other";
  return "chat";
}

function supportsImages(model: Record<string, unknown>, id: string): boolean {
  const architecture = model.architecture;
  const architectureInput =
    architecture && typeof architecture === "object"
      ? (architecture as Record<string, unknown>).input_modalities
      : undefined;
  const input = model.input_modalities;
  const modalities = model.modalities;
  const capabilities = model.capabilities;

  if (Array.isArray(architectureInput) && architectureInput.includes("image")) {
    return true;
  }
  if (Array.isArray(input) && input.includes("image")) return true;
  if (Array.isArray(modalities) && modalities.includes("image")) return true;
  if (model.vision === true) return true;
  if (
    capabilities &&
    typeof capabilities === "object" &&
    (capabilities as Record<string, unknown>).vision === true
  ) {
    return true;
  }
  if (
    Array.isArray(capabilities) &&
    capabilities.some(
      (capability) =>
        typeof capability === "string" &&
        capability.toLowerCase().includes("vision")
    )
  ) {
    return true;
  }

  // Groq's model-list response does not currently expose modality metadata.
  // Keep the documented vision model usable while still discovering every
  // selectable model from the live endpoint.
  return id === "qwen/qwen3.8-27b";
}

export function normalizeGroqModels(data: unknown): GroqChatModel[] {
  if (!data || typeof data !== "object") {
    throw new Error("Groq returned an invalid models response");
  }
  const list = (data as { data?: unknown }).data;
  if (!Array.isArray(list)) {
    throw new Error("Groq returned no models");
  }

  const models = list.flatMap((entry): GroqChatModel[] => {
    if (!entry || typeof entry !== "object") return [];
    const model = entry as Record<string, unknown>;
    if (typeof model.id !== "string" || !model.id.trim()) return [];
    if (model.active === false) return [];
    const id = model.id.trim();
    const modelType = model.type ?? model.model_type;
    if (
      (typeof modelType === "string" &&
        /embedding|speech-to-speech|moderation|rerank/i.test(modelType)) ||
      /embed|tts|text-to-speech|moderation|rerank/i.test(id)
    ) {
      return [];
    }
    const kind = classify(id, modelType);
    return [
      {
        id,
        label: id,
        supportsImages: supportsImages(model, id),
        kind: kind === "chat" && supportsImages(model, id) ? "vision" : kind,
      },
    ];
  });
  models.sort((a, b) => a.id.localeCompare(b.id));
  if (models.length === 0) throw new Error("Groq returned no usable models");
  return models;
}

export async function fetchGroqModels(apiKey: string): Promise<GroqChatModel[]> {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Invalid key"
        : `Groq models request failed (${res.status})`
    );
  }
  return normalizeGroqModels(await res.json());
}

export function isGroqVisionModel(
  models: GroqChatModel[],
  modelId: string
): boolean {
  return models.some((model) => model.id === modelId && model.supportsImages);
}
