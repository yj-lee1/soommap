import test from "node:test";
import assert from "node:assert/strict";
import { enabledPlaces as places } from "../src/lib/data/catalog.ts";
import { parseOrigin, navigationLinks, type TransitContext } from "../src/lib/domain/mobility.ts";
import { calculateTransit, parseTransitResponse, requestTransit, transitToken, readTransitToken } from "../src/lib/server/transit.ts";
import { checkChoice, recommend } from "../src/lib/domain/recommend.ts";
import { selectionUsable } from "../src/lib/domain/selection.ts";
import { planFromText } from "../src/lib/server/ai-planner.ts";
import type { Conditions, Snapshot } from "../src/lib/domain/types.ts";
import type { Interpretation } from "../src/lib/domain/interpretation.ts";
process.env.AI_API_KEY = "mobility-fixture-not-a-real-key";
const origin = { name: "서울역 · 1호선", latitude: 37.556228, longitude: 126.972135, source: "station" as const };
const now = Date.parse("2026-09-17T07:51:13.000Z");
const itinerary = { totalTime: 1907, totalWalkTime: 300, transferCount: 1, pathType: 3 };
const payload = (items: unknown[] = [itinerary]) => ({ metaData: { plan: { itineraries: items } } });
const context = (): TransitContext => ({ origin, departureAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString(),
  routes: places.map(p => parseTransitResponse(payload(), p, now, now)), unavailable: [] });
const conditions = (): Conditions => ({ revision: 1, activity: "walk", originalPlan: { placeId: null, preferredArrivalAt: null, durationMinutes: 60 },
  hard: { requiredSettings: ["park"], allowedPlaceIds: places.map(p => p.id), excludedPlaceIds: [], pinnedPlaceId: null, pinnedArrivalAt: null,
    arrivalWindow: { timeZone: "Asia/Seoul", localDate: "2026-09-17", notBefore: "2026-09-17T07:52:00.000Z", notAfter: "2026-09-17T10:00:00.000Z" } },
  soft: { maximumPreferredCongestion: "보통", ranking: "minimum-change" }, dataPolicy: { allowDelayedForecasts: false } });
const snapshots = (): Snapshot[] => places.map(p => ({ id: `${p.id}:fixture`, placeId: p.id, sourceUpdatedAt: new Date(now - 60_000).toISOString(), fetchedAt: new Date(now).toISOString(),
  observation: null, isReplacement: false, forecastAvailable: true, issues: [], forecasts: [8, 9, 10, 11].map(h => ({ at: `2026-09-17T${String(h).padStart(2, "0")}:00:00.000Z`, congestion: "보통" })) }));

test("origin validation bounds coordinates and link formats use the same verified access point", () => {
  assert.deepEqual(parseOrigin(origin), origin);
  for (const patch of [{ latitude: NaN }, { longitude: 0 }, { name: "" }, { source: "untrusted" }]) assert.throws(() => parseOrigin({ ...origin, ...patch }));
  for (const place of places) {
    assert.notDeepEqual(place.accessPoint.coordinate, place.displayCoordinate);
    const links = navigationLinks({ ...origin, name: "홍대 / 서울 & #역" }, place, "https://example.com");
    const n = new URL(links.naver), k = new URL(links.kakao);
    assert.equal(n.searchParams.get("slat"), String(origin.latitude));
    assert.equal(n.searchParams.get("dlng"), String(place.accessPoint.coordinate.longitude));
    assert.equal(n.searchParams.get("sname"), "홍대 / 서울 & #역");
    assert.equal(n.searchParams.get("appname"), "https://example.com");
    assert.equal(k.searchParams.get("ep"), `${place.accessPoint.coordinate.latitude},${place.accessPoint.coordinate.longitude}`);
    assert.equal(k.searchParams.get("by"), "publictransit"); assert.ok(links.kakaoWeb.includes("/link/by/traffic/"));
    assert.ok(links.naverAndroid.includes("package=com.nhn.android.nmap"));
  }
});
test("TMAP parser rejects missing/zero/malformed routes and rounds ETA up to the minute", () => {
  const route = parseTransitResponse(payload([{ ...itinerary, totalTime: 2400 }, itinerary]), places[0], now, now);
  assert.equal(route.totalSeconds, 1907); assert.equal(route.arrivalAt, "2026-09-17T08:23:00.000Z");
  for (const value of [null, { result: { status: 14 } }, payload([]), payload([{ ...itinerary, totalTime: 0 }]), payload([{ ...itinerary, totalWalkTime: 99999 }]), payload([{ ...itinerary, pathType: 6 }])]) {
    assert.throws(() => parseTransitResponse(value, places[0], now, now));
  }
});
test("TMAP receives server key and access point, with a timeout and no retries or leaked provider errors", async () => {
  let calls = 0;
  await requestTransit(origin, places[0], now, "fixture-secret", async (url, init) => {
    calls++; assert.equal(url, "https://apis.openapi.sk.com/transit/routes/sub");
    assert.equal(new Headers(init?.headers).get("appkey"), "fixture-secret"); assert.ok(init?.signal); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    const b = JSON.parse(String(init?.body)); assert.equal(Number(b.endX), places[0].accessPoint.coordinate.longitude);
    assert.equal(Number(b.startY), origin.latitude); assert.equal(b.count, 10); assert.equal(b.searchDttm, undefined);
    return Response.json(payload());
  });
  await assert.rejects(requestTransit(origin, places[0], now, "fixture-secret", async () => { calls++; throw new Error("fixture-secret"); }), e => e instanceof Error && !e.message.includes("fixture-secret"));
  assert.equal(calls, 2);
});
test("encrypted ETA tokens are session bound, tamper proof and expire without accepting client ETA", () => {
  const c = context(), token = transitToken(c, "user-a");
  assert.ok(!token.includes(origin.name)); assert.deepEqual(readTransitToken(token, "user-a", now), c);
  assert.throws(() => readTransitToken(token, "user-b", now)); assert.throws(() => readTransitToken("x" + token.slice(1), "user-a", now));
  assert.throws(() => readTransitToken(token, "user-a", now + 300_000)); assert.equal(readTransitToken(undefined, null), undefined);
});
test("automatic arrival evaluates interpolated stay and never relaxes a conflicting time pin", () => {
  const c = conditions(), t = context(), result = recommend(c, places, snapshots(), now, t);
  assert.equal(result.eligibleCount, 5); assert.equal(result.candidates[0].arrival.kind, "between");
  assert.ok(result.candidates.every(r => r.arrivalAt === "2026-09-17T08:23:00.000Z" && r.travel));
  c.hard.pinnedArrivalAt = "2026-09-17T08:00:00.000Z";
  assert.equal(recommend(c, places, snapshots(), now, t).eligibleCount, 0);
  assert.equal(checkChoice(c, { placeId: places[0].id, arrivalAt: c.hard.pinnedArrivalAt }, places, snapshots(), now, t).eligible, false);
});
test("unknown routes cannot rank as zero minutes; shorter routes break otherwise equal alternatives", () => {
  const t = context(); t.routes = t.routes.slice(1); t.unavailable.push({ placeId: places[0].id, reason: "이동시간 미확인" });
  t.routes[1] = parseTransitResponse(payload([{ ...itinerary, totalTime: 1800 }]), places[2], now, now);
  const r = recommend(conditions(), places, snapshots(), now, t);
  assert.equal(r.recommendedCandidateId?.split("@")[0], places[2].id);
  assert.ok(!r.candidates.some(c => c.placeId === places[0].id)); assert.ok(r.excludedPlaces[0].reasons.includes("이동시간 미확인"));
});
test("expired mobility evidence cannot be recommended or confirmed, and missing brackets are not extrapolated", () => {
  const t = context(); t.expiresAt = new Date(now).toISOString();
  assert.equal(recommend(conditions(), places, snapshots(), now, t).eligibleCount, 0);
  const c = context(), choice = { placeId: places[0].id, arrivalAt: c.routes[0].arrivalAt };
  const checked = checkChoice(conditions(), choice, places, snapshots(), now, c);
  assert.equal(selectionUsable(checked, 1, now + 300_000), false);
  assert.equal(recommend(conditions(), places, snapshots().map(s => ({ ...s, forecasts: s.forecasts.slice(1) })), now, c).eligibleCount, 0);
});
test("private cache reserves once, isolates users, caches failures, and quota failures make zero external calls", async () => {
  const values = new Map<string, string>(); let reservations = 0, calls = 0, decision = "ok";
  const command = async (args: Array<string | number>): Promise<unknown> => {
    if (args[0] === "GET") return values.get(String(args[1])) ?? null;
    if (args[0] === "SET") { if (args.includes("NX") && values.has(String(args[1]))) return null; values.set(String(args[1]), String(args[2])); return "OK"; }
    if (args[0] === "DEL") return values.delete(String(args[1]));
    if (args[0] === "EVAL") { reservations++; assert.equal(args[2], 4); assert.equal(args.at(-1), 10); return decision; }
    throw new Error("unexpected");
  };
  const fetcher: typeof fetch = async () => { calls++; return calls === 1 ? Response.json({ result: { status: 14 } }) : Response.json(payload()); };
  const deps = { now, command, fetcher, apiKey: "fixture", billingMode: "free" as const };
  const a = await calculateTransit(origin, places, "a", "ip", deps);
  const b = await calculateTransit(origin, places, "a", "ip", deps);
  assert.deepEqual(b.context, a.context); assert.equal(a.context.unavailable.length, 1); assert.equal(calls, 5); assert.equal(reservations, 1);
  assert.ok([...values.values()].every(v => !v.includes(origin.name) && !v.includes(String(origin.latitude))));
  decision = "budget"; await assert.rejects(calculateTransit(origin, places, "b", "ip", deps), /5,000/);
  assert.equal(calls, 5);
});
test("AI reuses computed travel evidence in at most two calls without sending origin coordinates", async () => {
  const v: Interpretation = { activity: "walk", placeId: null, localDate: "2026-09-17", timeKind: "soon", startTime: null, endTime: null, latestDelayMinutes: null,
    durationMinutes: 60, placeChangeAllowed: null, allowedPlaceIds: null, excludedPlaceIds: [], maximumPreferredCongestion: "보통", ranking: null, unsupportedRequests: [], clarification: null };
  let calls = 0;
  const result = await planFromText({ text: "지금 출발해서 한 시간 산책하고 싶어", revision: 1, requestId: "fixture", allowDelayedForecasts: false }, places, now, "a", s => s,
    { reserve: async () => {}, settle: async () => {} }, async () => ({ snapshots: snapshots(), checkedAt: new Date(now).toISOString() }),
    async request => { calls++; assert.ok(!request.context.includes(String(origin.latitude))); assert.ok(!request.context.includes(origin.name));
      return request.name === "outing_conditions" ? v : { factIds: ["travel", "stay"] }; }, context());
  assert.equal(calls, 2); assert.ok(result.result.candidates[0].travel); assert.ok(result.explanation.facts[0].text.includes("32분"));
  assert.ok(!result.assumptions.some(s => s.includes("미반영")));
});

test("all failed ETA calculations clearly offer manual arrival without invented recommendations", () => {
  const t = context(); t.routes = []; t.unavailable = places.map(p => ({ placeId: p.id, reason: "경로 미확인" }));
  const result = recommend(conditions(), places, snapshots(), now, t);
  assert.equal(result.eligibleCount, 0); assert.equal(result.status, "data-unavailable"); assert.match(result.message, /이동시간/);
});
