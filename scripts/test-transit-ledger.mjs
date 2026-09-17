// Real Redis, isolated keys only. No TMAP or OpenAI calls, no real budget changes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.loadEnvFile(".env.local");
const { redisCommand: command } = await import("../src/lib/server/ai-budget.ts");
const { TRANSIT_RESERVE_SCRIPT } = await import("../src/lib/server/transit.ts");
const prefix = `soommap:{transit-test-${randomUUID()}}:`, keys = new Set();
const key = name => { const value = prefix + name; keys.add(value); return value; };
async function init(name, amount) { const k = key(name); await command(["SET", k, amount, "EX", 300]); return k; }
const reserve = (total, day, session, ip, count = 5, cap = 10) => command(["EVAL", TRANSIT_RESERVE_SCRIPT, 4, key(day), key(`user:${session}`), key(`ip:${ip}`), total, count, cap]);
try {
  const total = await init("total", 4995);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => reserve(total, "budget-day", `u${i}`, `i${i}`, 5, 1000)));
  assert.equal(results.filter(r => r === "ok").length, 1); assert.equal(Number(await command(["GET", total])), 5000);
  const free = await init("free-total", 0);
  const freeResults = await Promise.all(Array.from({ length: 8 }, (_, i) => reserve(free, "free-day", `f${i}`, `f${i}`)));
  assert.equal(freeResults.filter(r => r === "ok").length, 2); assert.equal(Number(await command(["GET", free])), 10);
  const rate = await init("rate-total", 0);
  const rates = await Promise.all(Array.from({ length: 5 }, (_, i) => reserve(rate, "rate-day", "one", `rate${i}`, 1, 1000)));
  assert.equal(rates.filter(r => r === "ok").length, 3); assert.equal(Number(await command(["GET", rate])), 3);
  const ip = await init("ip-total", 0);
  const ips = await Promise.all(Array.from({ length: 8 }, (_, i) => reserve(ip, "ip-day", `ip${i}`, "one", 1, 1000)));
  assert.equal(ips.filter(r => r === "ok").length, 6);
  assert.equal(await reserve(key("missing"), "missing-day", "x", "x"), "uninitialized");
  assert.ok(Number(await command(["TTL", key("user:one")])) > 0);
  console.log("PASS: atomic KRW 5,000 cap, Free daily 10-call cap, per-user/IP rate limits, TTL and fail-closed missing ledger. No provider calls.");
} catch { console.error("FAIL: isolated transit budget validation; no secrets logged."); process.exitCode = 1; }
finally { if (keys.size) await command(["DEL", ...keys]).catch(() => console.error("Test-key cleanup unavailable.")); }
