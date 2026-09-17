import test from "node:test";
import assert from "node:assert/strict";
import { structuredAI } from "../src/lib/server/structured-ai.ts";
import { BudgetError, estimatedMicros, type BudgetLedger } from "../src/lib/server/ai-budget.ts";
import { createSession, sessionHash, callIdentity, privateRequestCache, requestIpHash } from "../src/lib/server/ai-session.ts";
import { sharedFlowCache } from "../src/lib/server/ai-flow-cache.ts";
import { explanationFacts, renderExplanation } from "../src/lib/domain/explanation.ts";
import { planFromText } from "../src/lib/server/ai-planner.ts";
import { enabledPlaces as places } from "../src/lib/data/catalog.ts";
import type { Interpretation } from "../src/lib/domain/interpretation.ts";
import type { Snapshot } from "../src/lib/domain/types.ts";
process.env.AI_PROVIDER = "openai"; process.env.AI_MODEL = "gpt-5.6-terra";
process.env.AI_BUDGET_USD = "20"; process.env.AI_API_KEY = "fixture-not-a-real-key";
const request = { name: "test", schema: { type: "object" }, instructions: "fixture", context: "fixture", outputTokens: 100, callId: "call", sessionHash: "session" };
const complete = (value: unknown, extra = {}) => Response.json({ status: "completed", usage: { input_tokens: 100, output_tokens: 20 },
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }], ...extra });
function ledger() {
  const calls: string[] = [], costs: number[] = [];
  return { calls, costs, reserve: async (id: string) => { calls.push(id); }, settle: async (_id: string, input: number, output: number) => { costs.push(estimatedMicros(input, output)); } };
}
test("structured provider sends exact model/strict format/store false and settles token costs", async () => {
  const budget = ledger(); let count = 0;
  const data = await structuredAI(request, budget, async (url, init) => {
    count++; assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-5.6-terra"); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.equal(body.max_output_tokens, 100); assert.equal(init?.cache, "no-store");
    return complete({ valid: true });
  });
  assert.deepEqual(data, { valid: true }); assert.equal(count, 1); assert.deepEqual(budget.costs, [490]);
});
test("budget failure and oversized context stop before a provider request", async () => {
  let calls = 0; const send = async () => { calls++; return complete({}); };
  const denied: BudgetLedger = { reserve: async () => { throw new BudgetError("exhausted"); }, settle: async () => {} };
  await assert.rejects(structuredAI(request, denied, send), BudgetError);
  await assert.rejects(structuredAI({ ...request, context: "x".repeat(40_000) }, ledger(), send));
  assert.equal(calls, 0);
});
test("provider failure/incomplete/refusal never retries or refunds unknown usage", async () => {
  for (const send of [async () => { throw new Error("sensitive-provider-details"); },
    async () => complete({}, { status: "incomplete" }),
    async () => complete({}, { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }),
    async () => new Response("provider secret", { status: 500 })]) {
    const budget = ledger(); let calls = 0;
    await assert.rejects(structuredAI(request, budget, async () => { calls++; return send(); }), /generation_failed/);
    assert.equal(calls, 1); assert.equal(budget.calls.length, 1);
  }
});
test("settlement failure does not repeat successful generation", async () => {
  const budget: BudgetLedger = { reserve: async () => {}, settle: async () => { throw new Error("redis down"); } };
  assert.deepEqual(await structuredAI(request, budget, async () => complete({ ok: true })), { ok: true });
});
test("signed sessions expire, reject tampering and isolate call identities", () => {
  const now = Date.now(), cookie = createSession(now), hash = sessionHash(cookie, now)!;
  assert.ok(hash); assert.equal(sessionHash(cookie + "a", now), null);
  assert.equal(sessionHash(cookie, now + 8 * 24 * 3600_000), null);
  assert.notEqual(callIdentity(hash, "request", "interpret"), callIdentity(hash, "request", "explain"));
  assert.notEqual(hash, sessionHash(createSession(now), now));
});
test("private cache coalesces concurrent same flow but never crosses users or input changes", async () => {
  let count = 0; const cache = privateRequestCache<number>(); const generate = async () => ++count;
  assert.deepEqual(await Promise.all([cache("a", "input", generate), cache("a", "input", generate)]), [1, 1]);
  assert.equal(await cache("b", "input", generate), 2);
  await assert.rejects(cache("a", "changed", generate), /request_changed/); assert.equal(count, 2);
});
test("IP limit ignores untrusted spoofed headers and canonicalizes trusted IPv6", () => {
  delete process.env.VERCEL; delete process.env.TRUSTED_CLIENT_IP_HEADER;
  const a = new Headers({ "x-forwarded-for": "1.2.3.4" }), b = new Headers({ "x-forwarded-for": "5.6.7.8" });
  assert.equal(requestIpHash(a), requestIpHash(b));
  process.env.TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";
  assert.notEqual(requestIpHash(a), requestIpHash(b));
  assert.equal(requestIpHash(new Headers({ "x-forwarded-for": "2001:db8::1" })), requestIpHash(new Headers({ "x-forwarded-for": "2001:0db8:0:0:0:0:0:1" })));
  delete process.env.TRUSTED_CLIENT_IP_HEADER;
});
test("shared cache encrypts results, expires them and blocks concurrent duplicate flows", async () => {
  const items = new Map<string, string>(), commands: Array<Array<string | number>> = [];
  const command = async (cmd: Array<string | number>): Promise<unknown> => {
    commands.push(cmd);
    if (cmd[0] === "GET") return items.get(String(cmd[1])) ?? null;
    if (cmd[0] === "SET") {
      if (cmd.includes("NX") && items.has(String(cmd[1]))) return null;
      items.set(String(cmd[1]), String(cmd[2])); return "OK";
    }
    throw new Error("unexpected_command");
  };
  let calls = 0; const generate = async () => { calls++; return { explanation: "private user conditions" }; };
  const value = await sharedFlowCache("user-a", "input-a", generate, command);
  assert.deepEqual(await sharedFlowCache("user-a", "input-a", generate, command), value); assert.equal(calls, 1);
  await assert.rejects(sharedFlowCache("user-a", "different-input", generate, command), BudgetError);
  assert.ok(commands.some(c => c.includes("EX") && c.includes(300)));
  assert.ok([...items.values()].every(v => !v.includes("private user conditions")));
  await sharedFlowCache("user-b", "input-a", generate, command); assert.equal(calls, 2);
  const outcomes = await Promise.allSettled([sharedFlowCache("user-c", "input-a", generate, command), sharedFlowCache("user-c", "input-a", generate, command)]);
  assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
});
const interpretation: Interpretation = { activity: "walk", placeId: null, localDate: "2026-09-17", timeKind: "exact", startTime: "17:23", endTime: null,
  latestDelayMinutes: null, durationMinutes: 60, placeChangeAllowed: true, allowedPlaceIds: null, excludedPlaceIds: [],
  maximumPreferredCongestion: "보통", ranking: null, unsupportedRequests: [], clarification: null };
const snapshots = places.map((place): Snapshot => ({ id: place.id, placeId: place.id, sourceUpdatedAt: "2026-09-17T07:45:00.000Z", fetchedAt: "2026-09-17T07:51:00.000Z",
  observation: { congestion: "보통" }, isReplacement: false, forecastAvailable: true, issues: [],
  forecasts: [8, 9, 10].map(hour => ({ at: `2026-09-17T${hour.toString().padStart(2, "0")}:00:00.000Z`, congestion: "보통", populationRange: { min: 100, max: 200 } })) }));
const input = { text: "오늘 17시 23분에 한 시간 산책", revision: 2, requestId: "fixture", allowDelayedForecasts: false };
const data = async () => ({ snapshots, checkedAt: "2026-09-17T07:51:00.000Z" });
test("interpret → deterministic recommendation → evidence selection uses at most two AI calls", async () => {
  const names: string[] = [];
  const result = await planFromText(input, places, Date.parse("2026-09-17T07:51:00.000Z"), "session", stage => stage, ledger(), data,
    async req => { names.push(req.name); return req.name === "outing_conditions" ? interpretation : { factIds: ["reason", "stay"] }; });
  assert.deepEqual(names, ["outing_conditions", "recommendation_evidence"]);
  assert.equal(result.result.status, "ready"); assert.equal(result.explanation.mode, "ai-selected-evidence");
  assert.equal(result.conditions.hard.pinnedArrivalAt, "2026-09-17T08:23:00.000Z");
  assert.ok(result.explanation.facts.every(f => f.evidenceIds.length));
});
test("hallucinated explanation IDs fall back to deterministic facts without changing recommendation", async () => {
  const result = await planFromText(input, places, Date.parse("2026-09-17T07:51:00.000Z"), "session", s => s, ledger(), data,
    async req => req.name === "outing_conditions" ? interpretation : { factIds: ["made-up-place"] });
  assert.equal(result.explanation.mode, "rules"); assert.ok(result.result.recommendedCandidateId); assert.ok(result.notice);
  assert.throws(() => renderExplanation({ factIds: ["made-up-place"] }, explanationFacts(result.result, result.conditions, places)));
});
test("clarification stops before data fetch and explanation; unavailable data never invents recommendation", async () => {
  let calls = 0;
  await assert.rejects(planFromText(input, places, Date.now(), "session", s => s, ledger(), async () => { throw new Error("must_not_fetch"); },
    async () => { calls++; return { ...interpretation, clarification: "오전인가요?" }; }), /오전/);
  assert.equal(calls, 1);
  const result = await planFromText(input, places, Date.parse("2026-09-17T07:51:00.000Z"), "session", s => s, ledger(),
    async () => ({ snapshots: [], checkedAt: "2026-09-17T07:51:00.000Z" }), async () => { calls++; return interpretation; });
  assert.equal(calls, 2); assert.equal(result.result.recommendedCandidateId, null); assert.equal(result.explanation.facts.length, 0);
});
test("warning budget preserves accurate result and reports skipped optional explanation", async () => {
  const result = await planFromText(input, places, Date.parse("2026-09-17T07:51:00.000Z"), "session", s => s, ledger(), data,
    async req => { if (req.optional) throw new BudgetError("warning"); return interpretation; });
  assert.equal(result.result.status, "ready"); assert.equal(result.explanation.mode, "rules"); assert.match(result.notice!, /예산/);
});
