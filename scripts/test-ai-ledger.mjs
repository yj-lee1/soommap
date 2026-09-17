// Integration test: real Redis Lua only, no OpenAI calls. Keys are isolated and deleted after validation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.loadEnvFile(".env.local");
const { redisCommand: command, RESERVE_SCRIPT, SETTLE_SCRIPT } = await import("../src/lib/server/ai-budget.ts");
const prefix = `soommap:{ledger-test-${randomUUID()}}:`, keys = new Set();
const key = name => { const value = prefix + name; keys.add(value); return value; };
async function init(name, limit = 20_000_000) {
  const ledger = key(name);
  await command(["HSET", ledger, "limit", limit, "committed", 0]); await command(["EXPIRE", ledger, 300]); return ledger;
}
const reserve = (ledger, call, session, ip, flow = call, optional = false) => command(["EVAL", RESERVE_SCRIPT, 6, ledger,
  key(`${ledger}:sm:${session}`), key(`${ledger}:sh:${session}`), key(`${ledger}:im:${ip}`), key(`${ledger}:ih:${ip}`), key(`${ledger}:gm`),
  call, 150000, session, 1, 1, optional ? "optional" : "required", flow]);
try {
  const capped = await init("cap", 300000);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => reserve(capped, `cap${i}`, `user${i}`, `ip${i}`)));
  assert.equal(results.filter(r => r[0] === "reserved").length, 2);
  assert.equal(Number(await command(["HGET", capped, "committed"])), 300000);
  const duplicate = await init("duplicate");
  const dup = await Promise.all(Array.from({ length: 8 }, () => reserve(duplicate, "one-call", "same-user", "same-ip")));
  assert.equal(dup.filter(r => r[0] === "reserved").length, 1);
  const settled = ["EVAL", SETTLE_SCRIPT, 1, duplicate, "one-call", 490, 100, 20];
  assert.equal((await command(settled))[0], "settled"); assert.equal((await command(settled))[0], "unchanged");
  assert.equal(Number(await command(["HGET", duplicate, "committed"])), 490);
  assert.equal((await reserve(duplicate, "explain", "same-user", "same-ip", "one-call", true))[0], "reserved");
  assert.equal((await reserve(duplicate, "third", "same-user", "same-ip", "one-call", true))[0], "duplicate");
  const rate = await init("rate");
  const rateResults = await Promise.all(Array.from({ length: 8 }, (_, i) => reserve(rate, `r${i}`, "user", `ip${i}`)));
  assert.equal(rateResults.filter(r => r[0] === "reserved").length, 6);
  const ip = await init("ip");
  const ipResults = await Promise.all(Array.from({ length: 22 }, (_, i) => reserve(ip, `i${i}`, `user${i}`, "one-ip")));
  assert.equal(ipResults.filter(r => r[0] === "reserved").length, 20);
  assert.ok(Number(await command(["TTL", key(`${ip}:im:one-ip`)])) > 0);
  const warning = await init("warning"); await command(["HSET", warning, "committed", 17900000, "f:flow", 1]);
  assert.equal((await reserve(warning, "warning", "user", "ip", "flow", true))[0], "warning");
  assert.equal((await reserve(key("missing"), "missing", "user", "ip"))[0], "uninitialized");
  console.log("PASS: atomic cap, dedup, idempotent settlement, two-call flow limit, session/IP rate limits, TTL, warning and fail-closed initialization. No OpenAI calls.");
} catch { console.error("FAIL: isolated Redis integration validation. No secrets logged."); process.exitCode = 1; }
finally { if (keys.size) { try { await command(["DEL", ...keys]); } catch { console.error("Test-key cleanup unavailable; TTL keys will expire."); } } }
