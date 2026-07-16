// Delivery — posts planned messages to Discord webhooks / Telegram.
//
// Discord content is capped at 2000 chars, Telegram at 4096; long messages are
// split into ordered chunks on newlines. Destinations are attempted in parallel;
// one failure doesn't stop the others.

import type { Destination, PlanItem } from "./messages.js";

const DISCORD_LIMIT = 2000;
const TELEGRAM_LIMIT = 4096;
const HTTP_TIMEOUT_MS = 15_000;

/** Split text into <=max chunks, preferring newline boundaries. */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > max) {
      if (current !== "") {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
      continue;
    }
    const candidate = current === "" ? line : `${current}\n${line}`;
    if (candidate.length > max) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`request timed out after ${HTTP_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DeliveryStatus {
  destination: string;
  ok: boolean;
  detail: string;
}

async function sendToDestination(dest: Destination, message: string): Promise<DeliveryStatus> {
  try {
    if (dest.kind === "discord") {
      for (const chunk of chunkText(message, DISCORD_LIMIT)) {
        const res = await postJson(dest.url, { content: chunk });
        if (!(res.ok || res.status === 204)) {
          const body = await res.text().catch(() => "");
          return { destination: dest.label, ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        }
      }
      return { destination: dest.label, ok: true, detail: "posted" };
    }

    // telegram
    const url = `https://api.telegram.org/bot${dest.botToken}/sendMessage`;
    for (const chunk of chunkText(message, TELEGRAM_LIMIT)) {
      const res = await postJson(url, { chat_id: dest.chatId, text: chunk });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { destination: dest.label, ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }
    }
    return { destination: dest.label, ok: true, detail: "posted" };
  } catch (err) {
    return { destination: dest.label, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface FanOutResult {
  statuses: DeliveryStatus[];
  allOk: boolean;
}

/** Execute a plan (list of destination+message). */
export async function deliver(plan: PlanItem[]): Promise<FanOutResult> {
  const statuses = await Promise.all(plan.map((item) => sendToDestination(item.destination, item.message)));
  return { statuses, allOk: statuses.every((s) => s.ok) && plan.length > 0 };
}
