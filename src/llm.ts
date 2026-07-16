// LLM integration (Groq cloud API).
//
// Sends the operator's raw pasted text to Groq's free, OpenAI-compatible
// chat-completions API and returns a parsed `Announcement`. Per CLAUDE.md:
// ALWAYS go through the LLM (no regex fast-path), force valid JSON with the
// `response_format: { type: "json_object" }` option, and ask for the exact
// schema with no markdown fences or prose.
//
// This module is responsible ONLY for "raw text -> parsed JSON object". It does
// NOT decide whether the result is trustworthy — that is validate.ts's job.

import { GROQ_URL, GROQ_MODEL, GROQ_API_KEY, KNOWN_GUILDS } from "./config.js";
import type { Announcement } from "./types.js";

// How long we are willing to wait on the API before giving up. Boss alerts are
// time-critical, so a hung request should surface as an error the operator can
// retry, not an infinite spinner. Groq is fast; 20s is generous.
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The system prompt. We describe the exact target schema, give the known guild
 * tags so the model can correct obvious typos (e.g. RISEvGGl -> RISEvGGI), and
 * insist on JSON only. `response_format: json_object` guarantees syntactic
 * validity; this prompt is what steers the *shape* and *semantics*.
 *
 * NOTE: the OpenAI/Groq JSON mode requires the word "JSON" to appear in the
 * prompt — it does, several times below.
 */
function buildSystemPrompt(): string {
  const knownGuildList = KNOWN_GUILDS.join(", ");

  return [
    "You convert a raw, freeform game boss announcement into a strict JSON object.",
    "",
    "Output ONLY a JSON object with EXACTLY these keys:",
    '  "type":    one of "boss", "other"',
    '  "header":  string — the shared boss name / group line; "" if none',
    '  "time":    string — the in-game time text exactly as written; "" if none',
    '  "targets": array of objects, each { "guild": string, "content": string }',
    "",
    "Rules:",
    '- "boss" is any parseable boss announcement (with or without a time).',
    '- If the text is not a boss announcement at all, use "other" and an empty targets array.',
    '- "time" is just forwarded text (e.g. a spawn time). Copy it as-is if present;',
    '  do not invent or reformat it. Use "" when the message has no time.',
    `- The known guild tags are: ${knownGuildList}.`,
    "  Correct obvious typos in guild tags to the closest known tag",
    "  (for example a lowercase L or O mistaken for I).",
    '- "content" is what goes to that guild, e.g. "Lv. 50 Forest of Exiles".',
    "  Normalize spacing so it reads cleanly (e.g. \"Lv.50\" -> \"Lv. 50\").",
    "- Do NOT invent guilds, times, or content that are not in the input.",
    "- Return raw JSON only. No markdown code fences, no commentary.",
  ].join("\n");
}

/** Shape of the OpenAI-compatible chat-completions response we care about. */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; type?: string };
}

/**
 * Call the Groq chat-completions API and return the raw model output string
 * (which, thanks to JSON mode, should be a JSON document). Throws on transport
 * errors, non-2xx responses, or timeout.
 */
async function callGroq(rawText: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        // Low temperature: we want faithful extraction, not creativity.
        temperature: 0,
        // Force syntactically valid JSON output.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: rawText },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Try to surface the API's own error message (e.g. bad key, rate limit).
      const data = (await res.json().catch(() => null)) as ChatCompletionResponse | null;
      const apiMsg = data?.error?.message;
      throw new Error(
        `Groq API returned HTTP ${res.status} ${res.statusText}.` +
          (apiMsg ? ` ${apiMsg}` : ""),
      );
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Groq response did not include message content.");
    }
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Groq API did not respond within ${REQUEST_TIMEOUT_MS / 1000}s. Check connectivity / GROQ_API_KEY.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Defensive JSON extraction. JSON mode should give us clean JSON, but models
 * occasionally still wrap output in ```json fences. We strip those, then fall
 * back to grabbing the outermost {...} block before parsing.
 */
function parseJsonLoosely(raw: string): unknown {
  const trimmed = raw.trim();

  // Strip a leading/trailing markdown code fence if present.
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(fenceStripped);
  } catch {
    // Fall back: extract the first {...last} span and try that.
    const start = fenceStripped.indexOf("{");
    const end = fenceStripped.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const span = fenceStripped.slice(start, end + 1);
      return JSON.parse(span); // may throw — caller handles
    }
    throw new Error("Could not locate a JSON object in the model output.");
  }
}

/**
 * Coerce whatever the model returned into an `Announcement`-shaped object.
 *
 * This is NOT the validation gate — it only normalizes the raw parsed JSON into
 * the right *shape* with the right *types* (strings are strings, targets is an
 * array of {guild, content}). Semantic correctness (known guild, non-empty
 * content) is enforced later in validate.ts.
 */
function coerceToAnnouncement(parsed: unknown): Announcement {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model output was not a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;

  // type: fall back to "other" if the model gave something unexpected. The
  // validation gate will flag it; we just keep the shape sane here.
  const rawType = typeof obj.type === "string" ? obj.type : "other";
  const type = rawType === "boss" ? "boss" : "other";

  const header = typeof obj.header === "string" ? obj.header : "";
  const time = typeof obj.time === "string" ? obj.time : "";

  const targets: Announcement["targets"] = [];
  if (Array.isArray(obj.targets)) {
    for (const item of obj.targets) {
      if (typeof item !== "object" || item === null) continue;
      const t = item as Record<string, unknown>;
      const guild = typeof t.guild === "string" ? t.guild.trim() : "";
      const content = typeof t.content === "string" ? t.content.trim() : "";
      // Keep the target even if a field is empty — validate.ts needs to see and
      // report the problem rather than us silently dropping a time-critical line.
      targets.push({ guild, content });
    }
  }

  return { type, header: header.trim(), time: time.trim(), targets };
}

/**
 * Public entry point: raw pasted text -> parsed (but not yet validated)
 * Announcement. Throws if the API is unreachable or produced unparseable output.
 */
export async function parseAnnouncement(rawText: string): Promise<Announcement> {
  const modelOutput = await callGroq(rawText);
  const parsed = parseJsonLoosely(modelOutput);
  return coerceToAnnouncement(parsed);
}
