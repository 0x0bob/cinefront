// Prompt validation + a BASIC content filter: no real people, no brands/trademarks (our prompt rules). It is a blocklist, not moderation: it catches the obvious.
export const MAX_PROMPT = 400;
const BRANDS = ["nike", "adidas", "coca[- ]?cola", "pepsi", "disney", "pixar", "marvel", "dc comics", "pokemon", "pokémon", "nintendo", "mario", "star wars", "harry potter", "lego", "mcdonald", "starbucks", "tesla", "ferrari", "lamborghini", "iphone", "google", "microsoft", "amazon", "netflix", "youtube", "facebook", "instagram", "tiktok", "gucci", "louis vuitton", "rolex", "barbie", "minecraft", "fortnite"];
const PEOPLE = ["trump", "biden", "obama", "putin", "zelensky", "macron", "elon musk", "jeff bezos", "mark zuckerberg", "bill gates", "taylor swift", "beyonce", "kanye", "kardashian", "messi", "ronaldo", "lebron", "michael jackson", "elvis", "marilyn monroe", "einstein", "hitler", "jesus", "pope francis", "queen elizabeth", "king charles", "celebrity", "politician", "president of", "real person", "photo of a famous", "lookalike", "deepfake"];
const RE = new RegExp("\\b(" + [...BRANDS, ...PEOPLE].join("|") + ")\\b", "i");

export type PromptCheck = { ok: true; prompt: string } | { ok: false; error: string };

export function checkPrompt(raw: unknown): PromptCheck {
  if (typeof raw !== "string") return { ok: false, error: "prompt must be text" };
  // collapse whitespace, drop control characters
  const prompt = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (prompt.length < 8) return { ok: false, error: "describe the scene in at least a few words" };
  if (prompt.length > MAX_PROMPT) return { ok: false, error: `the prompt is limited to ${MAX_PROMPT} characters (yours has ${prompt.length})` };
  if (/https?:\/\//i.test(prompt)) return { ok: false, error: "no links in the prompt" };
  const m = prompt.match(RE);
  if (m) return { ok: false, error: "no real people and no brands or trademarks, please rephrase" };
  return { ok: true, prompt };
}
