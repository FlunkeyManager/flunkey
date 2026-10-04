import { openUrl } from "@tauri-apps/plugin-opener";

const REPORT_ADDRESS = "flunkeymanager@gmail.com";
const MAX_RESPONSE_CHARS = 1800;

export async function reportAiResponse(content: string, model: string): Promise<void> {
  const response = content.trim();
  if (!response) return;

  const excerpt = response.slice(0, MAX_RESPONSE_CHARS);
  const truncated = response.length > MAX_RESPONSE_CHARS;
  const body = [
    "I would like to report an AI response from Flunkey.",
    "",
    `Model: ${model}`,
    `Response excerpt${truncated ? " (truncated)" : ""}:`,
    excerpt,
    "",
    "Please describe what should be reviewed:",
    "",
    "This draft is not sent automatically. Review or remove its contents before sending.",
  ].join("\n");
  const mailto = `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent("Flunkey AI response report")}&body=${encodeURIComponent(body)}`;

  try {
    await openUrl(mailto);
  } catch {
    window.open(mailto, "_blank", "noopener");
  }
}