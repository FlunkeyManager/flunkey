import type { AppId } from "./appProfiles";

export type DictationFormat = "prose" | "code" | "email" | "list";

const CODE_APPS = new Set<AppId>([
  "vscode",
  "cursor",
  "antigravity",
  "opencode",
  "terminal",
]);

const CODE_REQUEST =
  /\b(?:write|create|generate|implement|show|give me|add)\b.{0,50}\b(?:code|function|class|script|snippet|query|regex|component|method)\b|\b(?:code|function|class|script|snippet|sql query)\b/i;
const CODE_SYNTAX =
  /(?:\b(?:const|let|var|function|class|return|import|export|SELECT|INSERT|UPDATE|DELETE)\b|=>|[{};])/;
const EMAIL_CUE =
  /\b(?:dear\s+\w+|hi\s+\w+|hello\s+\w+|regards|best regards|sincerely)\b/i;
const EMAIL_REQUEST =
  /\b(?:write|compose|draft|format)\b.{0,40}\b(?:an?\s+)?(?:email|e-mail)\b|\bsubject\s*:/i;
const LIST_CUE =
  /\b(?:bullet points?|bulleted list|numbered list|make a list|list these)\b|\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|next item)\s*[:,]/i;

export function detectDictationFormat(
  transcript: string,
  appId: AppId,
): DictationFormat {
  const text = transcript.trim();
  if (!text) return "prose";

  if (CODE_REQUEST.test(text)) return "code";
  if (CODE_APPS.has(appId) && CODE_SYNTAX.test(text)) return "code";

  if (
    LIST_CUE.test(text) ||
    /^\s*(?:[-*•]|\d+[.)])\s+/m.test(text)
  ) {
    return "list";
  }

  const mailApp = appId === "outlook";
  const emailLike =
    EMAIL_REQUEST.test(text) ||
    (EMAIL_CUE.test(text) &&
      (/\b(?:regards|sincerely)\b/i.test(text) ||
        /^\s*(?:dear|hi|hello)\s+\w+/i.test(text)));
  if (emailLike || (mailApp && EMAIL_CUE.test(text))) {
    return "email";
  }

  return "prose";
}
