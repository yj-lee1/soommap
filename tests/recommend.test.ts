import test from "node:test";
import assert from "node:assert/strict";
import { enabledPlaces } from "../src/lib/data/catalog.ts";
import { assessSnapshot, forecastUse } from "../src/lib/data/quality.ts";
import { parseSeoulTime } from "../src/lib/data/time.ts";
import { parseConditions } from "../src/lib/domain/conditions.ts";
import { manualConditions, type ManualDraft } from "../src/lib/domain/manual.ts";
import { recommend } from "../src/lib/domain/recommend.ts";
import type { Conditions, CongestionLevel, Snapshot } from "../src/lib/domain/types.ts";

const at = (time: string, date = "2026-09-17") => parseSeoulTime(`${date} ${time}`)!;
const now = Date.parse(at("15:00"));
const places = enabledPlaces.slice(0, 2);
function conditions(): Conditions {
  return { revision: 1, activity: "walk", originalPlan: { placeId: "yeouido", preferredArrivalAt: at("16:00"), durationMinutes: null },
    hard: { requiredSettings: ["park", "riverside"], allowedPlaceIds: places.map(p => p.id), excludedPlaceIds: [],
      pinnedPlaceId: null, pinnedArrivalAt: null,
      arrivalWindow: { timeZone: "Asia/Seoul", localDate: "2026-09-17", notBefore: at("16:00"), notAfter: at("17:00") } },
    soft: { maximumPreferredCongestion: "보통", ranking: "minimum-change" }, dataPolicy: { allowDelayedForecasts: false } };
}
function snapshot(id: string, levels: CongestionLevel[]): Snapshot {
  return { id: `${id}:fixture`, placeId: id, sourceUpdatedAt: at("14:50"), fetchedAt: at("15:00"), observation: { congestion: "붐빔" },
    isReplacement: false, forecastAvailable: true, issues: [],
    forecasts: levels.map((congestion, i) => ({ at: at(`${16 + i}:00`), congestion })) };
}
const samples = () => [snapshot("yeouido", ["붐빔", "보통", "여유"]), snapshot("banpo", ["보통", "여유", "여유"])];
const run = (c = conditions(), data = samples()) => recommend(c, places, data, now);

test("31 and 34 minutes reflect different checked times, not fetch age", () => {
  const s = { ...samples()[0], sourceUpdatedAt: at("14:55"), fetchedAt: at("15:26") };
  assert.equal(assessSnapshot(s, Date.parse(at("15:26"))).sourceAgeMinutes, 31);
  assert.equal(assessSnapshot(s, Date.parse(at("15:29"))).sourceAgeMinutes, 34);
  assert.equal(assessSnapshot(s, Date.parse(at("15:29"))).cacheAgeMinutes, 3);
});

test("minimum change prefers staying at the original park over moving at the same time", () => {
  const r = run();
  assert.equal(r.recommendedCandidateId, `yeouido@${at("17:00")}`);
  assert.equal(r.status, "ready"); assert.equal(r.options.length, 3);
  assert.equal(r.options.at(-1)?.role, "original");
  assert.deepEqual(r.options[0].candidate?.change, { placeChanged: false, arrivalDeltaMinutes: 60 });
});

test("less crowded mode changes ranking but never expands permissions", () => {
  const c = conditions(); c.soft.ranking = "less-crowded";
  assert.equal(run(c).recommendedCandidateId, `banpo@${at("17:00")}`);
  c.hard.pinnedPlaceId = "yeouido";
  assert.equal(run(c).recommendedCandidateId, `yeouido@${at("17:00")}`);
});

test("a suitable original plan is preserved and not duplicated as another card", () => {
  const data = samples(); data[0].forecasts[0].congestion = "보통";
  const r = run(conditions(), data);
  assert.equal(r.recommendedCandidateId, `yeouido@${at("16:00")}`);
  assert.equal(r.options.filter(o => o.role === "original").length, 0);
  assert.equal(new Set(r.candidates.map(c => c.id)).size, r.candidates.length);
  assert.ok(r.options.length <= 3);
});

test("both pins are honored even when congestion preference cannot be met", () => {
  const c = conditions(); c.hard.pinnedPlaceId = "yeouido"; c.hard.pinnedArrivalAt = at("16:00");
  const r = run(c);
  assert.equal(r.status, "preference-unmet");
  assert.equal(r.recommendedCandidateId, `yeouido@${at("16:00")}`);
  assert.equal(r.options[0].candidate?.meetsPreference, false);
});

test("a 16:30 pin stays at 16:30 and compares its bracketing samples", () => {
  const c = conditions(); c.originalPlan.preferredArrivalAt = at("16:30"); c.hard.pinnedArrivalAt = at("16:30");
  c.hard.arrivalWindow.notBefore = at("16:30"); c.hard.arrivalWindow.notAfter = at("16:30");
  const r = run(c);
  assert.equal(r.status, "ready"); assert.equal(r.recommendedCandidateId, `banpo@${at("16:30")}`);
  assert.ok(r.availableForecastTimes.includes(at("17:00")));
  assert.equal(r.options[0].candidate?.arrival.kind, "between");
  assert.deepEqual(r.options[0].candidate?.arrival.evidence.map(p => p.at), [at("16:00"), at("17:00")]);
});

test("no preferred candidate falls back within hard limits with an explicit unmet status", () => {
  const c = conditions(); c.soft.maximumPreferredCongestion = "여유"; c.hard.pinnedArrivalAt = at("16:00");
  const r = run(c);
  assert.equal(r.status, "preference-unmet"); assert.equal(r.recommendedCandidateId, `banpo@${at("16:00")}`);
  assert.equal(r.options[0].candidate?.visit.worstSampledCongestion, "보통");
});

test("empty permissions, unknown permissions and missing predictions are distinct", () => {
  const c = conditions(); c.hard.allowedPlaceIds = [];
  assert.equal(run(c).status, "no-candidates");
  c.hard.allowedPlaceIds = null; assert.equal(run(c).status, "needs-clarification");
  c.hard.allowedPlaceIds = places.map(p => p.id); assert.equal(run(c, []).status, "data-unavailable");
  c.hard.arrivalWindow.notBefore = at("20:00"); c.hard.arrivalWindow.notAfter = at("21:00");
  assert.equal(run(c).status, "forecast-unavailable");
});

test("an original plan outside the allowed set is reference-only, never recommended", () => {
  const c = conditions(); c.hard.allowedPlaceIds = ["banpo"];
  const r = run(c), original = r.options.find(o => o.role === "original")!;
  assert.equal(original.eligible, false); assert.ok(original.reasons.length);
  assert.ok(r.recommendedCandidateId?.startsWith("banpo@"));
  assert.ok(r.alternativeCandidateIds.every(id => id.startsWith("banpo@")));
});

test("activity, required setting, permission and exclusion filters all apply", () => {
  const c = conditions(); c.hard.excludedPlaceIds = ["banpo"];
  assert.ok(run(c).recommendedCandidateId?.startsWith("yeouido@"));
  const incompatible = places.map(p => ({ ...p, settings: [] }));
  assert.equal(recommend(c, incompatible, samples(), now).status, "no-candidates");
  const noActivity = places.map(p => ({ ...p, activities: [] }));
  assert.equal(recommend(c, noActivity, samples(), now).status, "no-candidates");
});

test("delayed observations remain delayed; future comparison requires opt-in", () => {
  const data = samples().map(s => ({ ...s, sourceUpdatedAt: at("14:25") }));
  const c = conditions(); assert.equal(run(c, data).status, "data-unavailable");
  c.dataPolicy.allowDelayedForecasts = true;
  const r = run(c, data);
  assert.equal(r.status, "ready"); assert.equal(r.options[0].candidate?.dataConfidence, "delayed");
  assert.ok(r.limitations[0].includes("참고 비교"));
  assert.equal(assessSnapshot(data[0], now).usableForRecommendation, false);
});

test("opting in cannot admit over-60-minute, replacement or overdue data", () => {
  const c = conditions(); c.dataPolicy.allowDelayedForecasts = true;
  for (const patch of [{ sourceUpdatedAt: at("13:59") }, { isReplacement: true }, { isReplacement: null }, { fetchedAt: at("14:49") }, { forecastAvailable: false }]) {
    const data = samples().map(s => ({ ...s, ...patch }));
    assert.equal(run(c, data).status, "data-unavailable");
    assert.equal(forecastUse(data[0], now), "blocked");
  }
});

test("one unavailable park does not block valid recommendations from another", () => {
  const r = run(conditions(), [samples()[1]]);
  assert.ok(r.recommendedCandidateId?.startsWith("banpo@"));
  assert.ok(r.excludedPlaces.find(p => p.placeId === "yeouido"));
});

test("null original place and time stay null rather than manufacturing a baseline", () => {
  const c = conditions(); c.originalPlan.placeId = null; c.originalPlan.preferredArrivalAt = null;
  const r = run(c);
  assert.equal(r.options.some(o => o.role === "original"), false);
  assert.equal(r.options[0].candidate?.change.placeChanged, null);
  assert.equal(r.options[0].candidate?.change.arrivalDeltaMinutes, null);
});

test("tie breaking is deterministic across provider/catalog iteration order", () => {
  const c = conditions(); c.originalPlan.placeId = null; c.originalPlan.preferredArrivalAt = null;
  const data = places.map(p => snapshot(p.id, ["보통", "보통"]));
  assert.equal(recommend(c, places, data, now).recommendedCandidateId,
    recommend(c, [...places].reverse(), [...data].reverse(), now).recommendedCandidateId);
  assert.deepEqual(run(c, data), run(c, data));
});

test("engine never mutates the original conditions or snapshots", () => {
  const c = conditions(), data = samples(), before = structuredClone({ c, data });
  run(c, data);
  assert.deepEqual({ c, data }, before);
});

test("passed arrival samples never become new recommendations", () => {
  const advancedNow = Date.parse(at("16:01"));
  const data = samples().map(s => ({ ...s, sourceUpdatedAt: at("15:55"), fetchedAt: at("16:01") }));
  const r = recommend(conditions(), places, data, advancedNow);
  assert.ok(r.options.filter(o => o.eligible).every(o => Date.parse(o.candidate!.arrivalAt) >= advancedNow));
  assert.equal(r.options.find(o => o.role === "original")?.eligible, false);
});

test("candidate evidence always identifies the exact supplied forecast sample", () => {
  const data = samples(), r = run(conditions(), data);
  for (const candidate of r.candidates) {
    const source = data.find(s => s.id === candidate.snapshotId)!;
    assert.equal(source.forecasts.find(p => p.at === candidate.arrivalAt)?.congestion, candidate.arrival.evidence[0].congestion);
    assert.equal(candidate.evidenceIds[0], `${source.id}#forecast:${candidate.arrivalAt}`);
  }
});

const draft = (): ManualDraft => ({ placeId: "yeouido", arrival: "2026-09-17T16:00", duration: "60", allowPlaceChange: true,
  allowedPlaceIds: places.map(p => p.id), timeMode: "later-60", windowStart: "2026-09-17T16:00", windowEnd: "2026-09-17T17:00",
  maximumCongestion: "보통", ranking: "minimum-change", allowDelayedForecasts: false });

test("one hour later is [original, original + 60 minutes], never plus-or-minus", () => {
  const c = manualConditions(draft(), 2, places);
  assert.equal(c.hard.arrivalWindow.notBefore, at("16:00"));
  assert.equal(c.hard.arrivalWindow.notAfter, at("17:00"));
  assert.equal(c.originalPlan.preferredArrivalAt, at("16:00"));
});

test("late-only windows cross Seoul midnight without shifting the original plan", () => {
  const d = draft(); d.arrival = "2026-09-17T23:00"; d.timeMode = "later-120";
  const c = manualConditions(d, 3, places);
  assert.equal(c.hard.arrivalWindow.notAfter, at("01:00", "2026-09-18"));
  assert.equal(c.originalPlan.preferredArrivalAt, at("23:00"));
});

test("manual controls default to strict pins and do not infer relocation permission", () => {
  const d = draft(); d.allowPlaceChange = false; d.timeMode = "fixed";
  const c = manualConditions(d, 1, places);
  assert.deepEqual(c.hard.allowedPlaceIds, ["yeouido"]);
  assert.equal(c.hard.pinnedPlaceId, "yeouido"); assert.equal(c.hard.pinnedArrivalAt, at("16:00"));
});

test("server validation rejects invented places, malformed time, reversed windows and missing policy", () => {
  assert.deepEqual(parseConditions(conditions(), places), conditions());
  for (const alter of [
    (c: Conditions) => { c.hard.allowedPlaceIds = ["invented"]; },
    (c: Conditions) => { c.originalPlan.preferredArrivalAt = "2026-02-30T00:00:00.000Z"; },
    (c: Conditions) => { c.hard.arrivalWindow.notAfter = at("15:00"); },
    (c: Conditions) => { c.originalPlan.durationMinutes = -1; },
    (c: Conditions) => { c.hard.allowedPlaceIds = ["yeouido", "yeouido"]; },
  ]) { const c = conditions(); alter(c); assert.throws(() => parseConditions(c, places)); }
  assert.throws(() => parseConditions({ ...conditions(), dataPolicy: undefined }, places));
  assert.throws(() => manualConditions({ ...draft(), arrival: "" }, 1, places));
});

test("enumerated permissions, pins, preferences and modes never violate hard conditions", () => {
  for (const allowed of [[], ["yeouido"], ["banpo"], ["yeouido", "banpo"]]) {
    for (const pin of [null, "yeouido", "banpo"]) for (const pinTime of [null, at("16:00"), at("16:30"), at("17:00")]) {
      for (const level of ["여유", "보통", "약간 붐빔"] as const) for (const ranking of ["minimum-change", "less-crowded"] as const) {
        const c = conditions(); c.hard.allowedPlaceIds = allowed; c.hard.pinnedPlaceId = pin; c.hard.pinnedArrivalAt = pinTime;
        c.soft = { maximumPreferredCongestion: level, ranking };
        const r = run(c);
        for (const option of r.options.filter(o => o.eligible)) {
          const v = option.candidate!;
          assert.ok(allowed.includes(v.placeId));
          if (pin) assert.equal(v.placeId, pin);
          if (pinTime) assert.equal(v.arrivalAt, pinTime);
          assert.ok(v.arrivalAt >= c.hard.arrivalWindow.notBefore! && v.arrivalAt <= c.hard.arrivalWindow.notAfter!);
        }
        assert.ok(r.options.length <= 3);
        assert.equal(new Set(r.candidates.map(v => v.id)).size, r.candidates.length);
      }
    }
  }
});
