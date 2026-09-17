import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fixture from "./fixtures/seoul-population.json" with { type: "json" };
import { enabledPlaces } from "../src/lib/data/catalog.ts";
import { normalizeSeoulPopulation } from "../src/lib/data/normalize.ts";
import { parseSeoulTime } from "../src/lib/data/time.ts";
import { assessSnapshot, commonForecastTimes } from "../src/lib/data/quality.ts";
import { createRequestGate } from "../src/lib/data/request-gate.ts";
import { requestSeoulPopulation } from "../src/lib/server/integrations/seoul-population.ts";

const place = enabledPlaces[0];
const fetchedAt = "2026-09-17T06:00:00.000Z";
const payload = () => structuredClone(fixture);
const normalize = (data = payload()) => normalizeSeoulPopulation(data, place, fetchedAt);

test("five catalog codes match the official spatial data", () => {
  const geo = JSON.parse(readFileSync("public/data/hangang-boundaries.geojson", "utf8"));
  assert.equal(enabledPlaces.length, 5);
  assert.deepEqual(enabledPlaces.map(p => p.source.areaCode).sort(), ["POI090", "POI093", "POI094", "POI095", "POI105"]);
  for (const p of enabledPlaces) {
    const feature = geo.features.find((f: { id: string }) => f.id === p.source.areaCode);
    assert.equal(feature.properties.name, p.name);
    assert.ok(p.boundaryRef.endsWith(p.source.areaCode));
    assert.ok(p.displayPoint.latitude > 37 && p.displayPoint.latitude < 38);
    assert.ok(p.displayPoint.longitude > 126 && p.displayPoint.longitude < 128);
  }
});

test("Seoul midnight is parsed without depending on server timezone", () => {
  assert.equal(parseSeoulTime("2026-09-18 00:00"), "2026-09-17T15:00:00.000Z");
  for (const invalid of ["2026-02-30 17:00", "2026-09-17 24:00", "2026-13-17 17:00", "", null]) {
    assert.equal(parseSeoulTime(invalid), null);
  }
});

test("recorded public response retains only supplied forecasts", () => {
  const result = normalize();
  assert.equal(result.observation?.congestion, "여유");
  assert.equal(result.forecasts.length, 12);
  assert.equal(result.sourceUpdatedAt, "2026-09-17T05:40:00.000Z");
  assert.equal(result.forecasts[0].at, "2026-09-17T07:00:00.000Z");
  assert.deepEqual(result.issues, []);
});

test("wrong place and provider errors cannot enter the cache", () => {
  const wrong = payload(); wrong["SeoulRtd.citydata_ppltn"][0].AREA_CD = "POI095";
  assert.throws(() => normalize(wrong), /place_mismatch/);
  assert.throws(() => normalizeSeoulPopulation({ RESULT: { "RESULT.CODE": "INFO-100" } }, place, fetchedAt), /provider_error/);
});

test("invalid source timestamps and future source data are rejected", () => {
  for (const time of ["2026-02-30 14:40", "2026-09-17 18:00"]) {
    const data = payload(); data["SeoulRtd.citydata_ppltn"][0].PPLTN_TIME = time;
    assert.throws(() => normalize(data), /invalid_timestamp/);
  }
});

test("unknown current level is missing, never quiet or zero people", () => {
  const data = payload(); const row = data["SeoulRtd.citydata_ppltn"][0];
  row.AREA_CONGEST_LVL = ""; row.AREA_PPLTN_MIN = ""; row.AREA_PPLTN_MAX = "";
  const result = normalize(data);
  assert.equal(result.observation, null);
  assert.ok(result.issues.includes("observation_missing"));
  assert.equal(result.forecasts.length, 12);
});

test("forecast flag N does not borrow current congestion for the future", () => {
  const data = payload(); data["SeoulRtd.citydata_ppltn"][0].FCST_YN = "N";
  const result = normalize(data);
  assert.equal(result.forecastAvailable, false);
  assert.deepEqual(result.forecasts, []);
  assert.equal(assessSnapshot(result, Date.parse(fetchedAt)).usableForRecommendation, false);
});

test("invalid and conflicting samples are excluded without interpolation", () => {
  const data = payload(); const row = data["SeoulRtd.citydata_ppltn"][0];
  row.FCST_PPLTN[1].FCST_CONGEST_LVL = "알 수 없음";
  row.FCST_PPLTN.push({ ...row.FCST_PPLTN[0], FCST_CONGEST_LVL: "붐빔" });
  const result = normalize(data);
  assert.equal(result.forecasts.length, 10);
  assert.ok(result.issues.includes("forecast_conflict"));
  assert.ok(result.issues.includes("forecast_partial"));
  assert.ok(!result.forecasts.some(p => p.at === "2026-09-17T07:00:00.000Z"));
});

test("identical samples are deduplicated and negative ranges are not accepted", () => {
  const data = payload(); const row = data["SeoulRtd.citydata_ppltn"][0];
  row.FCST_PPLTN.push({ ...row.FCST_PPLTN[0] });
  row.AREA_PPLTN_MIN = "-1";
  const result = normalize(data);
  assert.equal(result.forecasts.length, 12);
  assert.equal(result.observation?.populationRange, undefined);
});

test("replacement and unknown provenance are not recommendation-ready", () => {
  for (const flag of ["Y", ""]) {
    const data = payload(); data["SeoulRtd.citydata_ppltn"][0].REPLACE_YN = flag;
    assert.equal(assessSnapshot(normalize(data), Date.parse(fetchedAt)).usableForRecommendation, false);
  }
});

test("freshness, source delay and cache age are independent", () => {
  const snapshot = normalize(); const sourceMs = Date.parse(snapshot.sourceUpdatedAt);
  assert.equal(assessSnapshot(snapshot, sourceMs + 30 * 60_000).freshness, "fresh");
  assert.equal(assessSnapshot(snapshot, sourceMs + 30 * 60_000 + 1).freshness, "delayed");
  assert.equal(assessSnapshot(snapshot, sourceMs + 61 * 60_000).freshness, "stale");
  const oldFetch = { ...snapshot, fetchedAt: new Date(sourceMs - 60_000).toISOString() };
  const q = assessSnapshot(oldFetch, sourceMs + 20 * 60_000);
  assert.equal(q.freshness, "fresh"); assert.equal(q.refreshOverdue, true);
  assert.equal(q.usableForRecommendation, false);
});

test("common comparison times are actual future intersections only", () => {
  const first = normalize(); const second = { ...first, forecasts: first.forecasts.slice(1) };
  assert.equal(commonForecastTimes([first, second], Date.parse(fetchedAt)).length, 11);
  assert.equal(commonForecastTimes([first], Date.parse("2026-09-19T00:00:00Z")).length, 0);
  assert.deepEqual(commonForecastTimes([], Date.parse(fetchedAt)), []);
});

test("parallel callers for one place share a single provider operation", async () => {
  const run = createRequestGate<number>(); let calls = 0;
  const load = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return 7; };
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => run("same-place", load))), Array(20).fill(7));
  assert.equal(calls, 1);
});

test("provider failure is sanitized and retries pause without blocking other places", async () => {
  let now = 0, calls = 0; const run = createRequestGate<number>(30_000, () => now);
  const fail = async () => { calls++; throw new Error("https://secret-key-in-url/"); };
  await assert.rejects(run("bad", fail), /provider_unavailable/);
  await assert.rejects(run("bad", fail), /provider_cooldown/);
  assert.equal(calls, 1); assert.equal(await run("good", async () => 4), 4);
  now = 30_001; await assert.rejects(run("bad", fail), /provider_unavailable/);
  assert.equal(calls, 2);
});

test("adjacent requests reuse a completed result until the shared-cache write settles", async () => {
  let now = 0, calls = 0; const run = createRequestGate<number>(30_000, () => now, 5_000);
  const load = async () => ++calls;
  assert.equal(await run("same", load), 1);
  assert.equal(await run("same", load), 1);
  now = 5_001;
  assert.equal(await run("same", load), 2);
});

test("a stale-cache reader can await existing revalidation without a second provider call", async () => {
  let calls = 0;
  const run = createRequestGate<number>();
  assert.equal(run.existing("park"), undefined);
  const pending = run("park", async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return 42; });
  assert.equal(run.existing("park"), pending);
  assert.equal(await run.existing("park"), 42);
  assert.equal(await run.existing("park"), 42);
  assert.equal(calls, 1);
});

test("transport uses official area code and never retries a failed request", async () => {
  let calls = 0;
  const mock: typeof fetch = async (input, init) => {
    calls++; const url = new URL(String(input));
    assert.equal(url.hostname, "openapi.seoul.go.kr"); assert.ok(url.pathname.endsWith("/POI105"));
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    return Response.json(fixture);
  };
  const result = await requestSeoulPopulation(place, { apiKey: "test-only", baseUrl: "http://openapi.seoul.go.kr:8088" }, mock, () => new Date(fetchedAt));
  assert.equal(result.forecasts.length, 12); assert.equal(calls, 1);
  const failing: typeof fetch = async () => { throw new Error("secret-request-url"); };
  await assert.rejects(requestSeoulPopulation(place, { apiKey: "test-only", baseUrl: "http://openapi.seoul.go.kr:8088" }, failing), error => {
    assert.equal((error as Error).message, "seoul_data_unavailable"); assert.equal((error as Error).cause, undefined); return true;
  });
});

test("transport refuses credential-bearing requests to a third-party origin", async () => {
  let calls = 0;
  await assert.rejects(requestSeoulPopulation(place, { apiKey: "test-only", baseUrl: "https://example.com" }, async () => { calls++; return Response.json({}); }));
  assert.equal(calls, 0);
});

test("a hanging provider is aborted within the bounded timeout", async () => {
  const started = Date.now();
  const hanging: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => reject(new Error("test_timeout")), 10_000);
    init?.signal?.addEventListener("abort", () => { clearTimeout(keepAlive); reject(new Error("mock_timeout")); }, { once: true });
  });
  await assert.rejects(requestSeoulPopulation(place, { apiKey: "test-only", baseUrl: "http://openapi.seoul.go.kr:8088" }, hanging), /seoul_data_unavailable/);
  assert.ok(Date.now() - started < 9_500);
});
