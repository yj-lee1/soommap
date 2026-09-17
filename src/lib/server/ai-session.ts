import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const AI_COOKIE = "soommap_ai_session";
function sign(text: string) {
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error("session_unconfigured");
  return createHmac("sha256", key).update(`soommap-session-v1:${text}`).digest("hex");
}
export function createSession(now = Date.now()) {
  const body = `${randomUUID()}.${Math.floor(now / 1000)}`;
  return `${body}.${sign(body)}`;
}
export function sessionHash(cookie: string | undefined, now = Date.now()): string | null {
  if (!cookie || !/^[a-f0-9-]{36}\.\d{10}\.[a-f0-9]{64}$/.test(cookie)) return null;
  const [id, issued, signature] = cookie.split(".");
  const age = now / 1000 - Number(issued);
  if (age < -60 || age > 7 * 24 * 3600) return null;
  const expected = sign(`${id}.${issued}`);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return sign(`identity:${id}`);
}
export function callIdentity(session: string, requestId: string, stage: string) {
  return sign(`${session}:${requestId}:${stage}`);
}

/** Only trust headers overwritten by the deployed proxy, never an arbitrary forwarded chain. */
export function requestIpHash(headers: Headers) {
  const trustedHeader = process.env.VERCEL === "1" ? "x-vercel-forwarded-for" : process.env.TRUSTED_CLIENT_IP_HEADER;
  const raw = trustedHeader ? headers.get(trustedHeader)?.trim() : undefined;
  // A missing/invalid trusted IP shares a conservative bucket instead of bypassing the limit.
  const canonical = raw && isIP(raw) ? (isIP(raw) === 6 ? new URL(`http://[${raw}]/`).hostname : raw) : "unknown";
  return sign(`ip:${canonical}`);
}

/** Private, bounded per-session request cache; shared ledger rejects replay on other workers. */
export function privateRequestCache<T>(now: () => number = Date.now) {
  const entries = new Map<string, { fingerprint: string; expiresAt: number; value: Promise<T> }>();
  return (key: string, fingerprint: string, generate: () => Promise<T>): Promise<T> => {
    for (const [id, item] of entries) if (item.expiresAt <= now()) entries.delete(id);
    const cached = entries.get(key);
    if (cached) {
      if (cached.fingerprint !== fingerprint) return Promise.reject(new Error("request_changed"));
      return cached.value;
    }
    if (entries.size >= 64) entries.delete(entries.keys().next().value!);
    const value = generate();
    // Retain a rejected promise until expiry too, so rapid retry cannot replay a paid call.
    entries.set(key, { fingerprint, expiresAt: now() + 5 * 60_000, value });
    return value;
  };
}
