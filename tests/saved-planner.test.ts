import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enabledPlaces } from "../src/lib/data/catalog.ts";
import { manualConditions } from "../src/lib/domain/manual.ts";
import { adjustPlan, effectiveConditions, startReplanning } from "../src/lib/domain/replanning.ts";
import { parseSavedPlanner, PLANNER_STORAGE_KEY, readSavedPlanner, SAVED_MAX_AGE_MS } from "../src/lib/domain/saved-planner.ts";
import { forecastChart } from "../src/lib/domain/forecast-chart.ts";
import { areaProjection, type AreaFeature } from "../src/lib/domain/area-map.ts";

const now = Date.parse("2026-09-17T09:00:00.000Z");
const draft = { placeId: "banpo", arrival: "2026-09-17T19:00", duration: "60", allowPlaceChange: true,
  allowedPlaceIds: enabledPlaces.map(p => p.id), timeMode: "later-120" as const, windowStart: "2026-09-17T19:00", windowEnd: "2026-09-17T21:00",
  maximumCongestion: "보통" as const, ranking: "minimum-change" as const, allowDelayedForecasts: false };
const conditions = manualConditions(draft, 3, enabledPlaces);
const origin = { name: "서울역 · 1호선", latitude: 37.556228, longitude: 126.972135, source: "station" };
const input = () => ({ version: 1, savedAt: new Date(now).toISOString(), draft, text: "한 시간 산책", origin, automatic: true,
  replanning: startReplanning(conditions), selection: { choice: { placeId: "banpo", arrivalAt: "2026-09-17T10:00:00.000Z" }, conditions, confirmedAt: new Date(now).toISOString() } });

test("saved state round trip preserves original conditions, adjustments, origin and confirmed intent", () => {
  const v = input();
  v.replanning = adjustPlan(adjustPlan(v.replanning, { type: "pin-place", placeId: "banpo" }, enabledPlaces), { type: "exclude", placeId: "nanji" }, enabledPlaces);
  const restored = parseSavedPlanner(JSON.parse(JSON.stringify(v)), enabledPlaces, now + 60_000);
  assert.deepEqual(restored.origin, origin);
  assert.equal(restored.selection?.confirmedAt, v.selection.confirmedAt);
  assert.deepEqual(effectiveConditions(restored.replanning!, 4, enabledPlaces).hard.excludedPlaceIds, ["nanji"]);
  assert.equal(restored.replanning?.placePin, "banpo");
});
test("only user intent is saved: response data, keys, tokens and unknown fields are stripped", () => {
  const v = { ...input(), transitToken: "secret", response: { congestion: "여유" }, aiPlan: {}, origin: { ...origin, apiKey: "secret" },
    selection: { ...input().selection, candidate: { totalSeconds: 300 }, check: {}, token: "secret" } };
  const output = JSON.stringify(parseSavedPlanner(v, enabledPlaces, now));
  for (const key of ["transitToken", "secret", "totalSeconds", "candidate", "response", "aiPlan", "check"]) assert.ok(!output.includes(key));
});
test("incomplete draft survives without starting a provider request", () => {
  const v = input(); v.draft = { ...draft, arrival: "", duration: "", windowEnd: "" };
  assert.equal(parseSavedPlanner(v, enabledPlaces, now).draft.arrival, "");
});
test("expired, future, unknown-schema and invalid-location storage are rejected", () => {
  assert.throws(() => parseSavedPlanner(input(), enabledPlaces, now + SAVED_MAX_AGE_MS + 1));
  assert.throws(() => parseSavedPlanner(input(), enabledPlaces, now - 120_000));
  assert.throws(() => parseSavedPlanner({ ...input(), version: 9 }, enabledPlaces, now));
  assert.throws(() => parseSavedPlanner({ ...input(), origin: { ...origin, latitude: 999 } }, enabledPlaces, now));
  assert.throws(() => parseSavedPlanner({ ...input(), selection: { ...input().selection, choice: { placeId: "unknown", arrivalAt: "invalid" } } }, enabledPlaces, now));
});
test("corrupt/oversize data is removed, unavailable storage never breaks planner", () => {
  for (const raw of ["{bad", "x".repeat(40_001), JSON.stringify({ version: 0 })]) {
    let removed = "";
    const result = readSavedPlanner({ getItem: () => raw, removeItem: key => { removed = key; } }, enabledPlaces, now);
    assert.equal(result.status, "discarded"); assert.equal(removed, PLANNER_STORAGE_KEY);
  }
  assert.equal(readSavedPlanner({ getItem: () => { throw new Error("blocked"); }, removeItem: () => {} }, enabledPlaces, now).status, "unavailable");
});
test("old plan time remains old: restoration never silently moves a plan to today", () => {
  const restored = parseSavedPlanner(input(), enabledPlaces, now + 24 * 3_600_000);
  assert.equal(restored.selection?.choice.arrivalAt, input().selection.choice.arrivalAt);
  assert.equal(restored.draft.arrival, draft.arrival);
});
test("chart preserves missing times, ordinal values and exact 12-hour boundary", () => {
  const points = [0, 1, 3, 12, 13].map(h => ({ at: new Date(now + h * 3_600_000).toISOString(), congestion: "보통" as const }));
  const chart = forecastChart(points, new Date(now).toISOString());
  assert.equal(chart.samples.length, 4); assert.equal(chart.gaps.length, 2);
  assert.equal(chart.position(points[2].at), 0.25); assert.equal(chart.position(points[3].at), 1);
  assert.equal(chart.samples.some(p => p.at === new Date(now + 2 * 3_600_000).toISOString()), false);
});
test("empty and single-sample charts do not synthesize a trend", () => {
  assert.equal(forecastChart([], new Date(now).toISOString()).samples.length, 0);
  assert.equal(forecastChart([{ at: new Date(now).toISOString(), congestion: "여유" }], new Date(now).toISOString()).gaps.length, 0);
});
test("official area projection is finite, keeps north up and all five boundaries in view", () => {
  const features = JSON.parse(readFileSync(new URL("../public/data/hangang-boundaries.geojson", import.meta.url), "utf8")).features as AreaFeature[];
  const project = areaProjection(features);
  assert.equal(features.length, 5);
  for (const f of features) for (const ring of f.geometry.coordinates) for (const [lon, lat] of ring) {
    const [x, y] = project(lon, lat); assert.ok(x >= 39 && x <= 681 && y >= 39 && y <= 221);
  }
  assert.ok(project(127, 38)[1] < project(127, 37)[1]);
  assert.throws(() => areaProjection([]));
});
