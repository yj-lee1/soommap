import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { BudgetError, redisCommand } from "./ai-budget.ts";

function encryptionKey() {
  if (!process.env.AI_API_KEY) throw new BudgetError("unconfigured");
  return createHash("sha256").update(`soommap-private-cache-v1:${process.env.AI_API_KEY}`).digest();
}
function seal(value: unknown) {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
}
function unseal(value: string): unknown {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}
/** Only a signed session can calculate this key. No raw prompt/IP is written to Redis. */
export async function sharedFlowCache<T>(identity: string, fingerprint: string, generate: () => Promise<T>, command = redisCommand): Promise<T> {
  const prefix = "soommap:{ai-dev-review-v1}:", key = `${prefix}result:${identity}`, lock = `${prefix}lock:${identity}`;
  const cached = await command(["GET", key]);
  if (typeof cached === "string") {
    try {
      const payload = unseal(cached) as { fingerprint: string; value: T };
      if (payload.fingerprint !== fingerprint) throw new Error("different_input");
      return payload.value;
    } catch { throw new BudgetError("duplicate"); }
  }
  if (await command(["SET", lock, "pending", "NX", "EX", 75]) !== "OK") throw new BudgetError("duplicate");
  const value = await generate();
  try {
    // Brief private result reuse across workers. Persistent ledger still rejects replay after expiry.
    await command(["SET", key, seal({ fingerprint, value }), "EX", 300]);
  } catch { /* Return the completed response; a later retry is blocked by the ledger. */ }
  return value;
}
