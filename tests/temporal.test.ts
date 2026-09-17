import test from "node:test";
import assert from "node:assert/strict";
import { parseSeoulTime } from "../src/lib/data/time.ts";
import { enabledPlaces } from "../src/lib/data/catalog.ts";
import { alignArrival, assessVisit } from "../src/lib/domain/temporal.ts";
import { recommend } from "../src/lib/domain/recommend.ts";
import type { Conditions, CongestionLevel, Snapshot } from "../src/lib/domain/types.ts";

const at = (time: string, date = "2026-09-17") => parseSeoulTime(`${date} ${time}`)!;
function snapshot(levels: CongestionLevel[] = ["보통", "약간 붐빔", "붐빔"], id = "yeouido"): Snapshot {
  return { id: `${id}:fixture`, placeId: id, sourceUpdatedAt: at("16:40"), fetchedAt: at("16:50"),
    observation: { congestion: "여유", populationRange: { min: 1, max: 2 } }, isReplacement: false,
    forecastAvailable: true, issues: [], forecasts: levels.map((congestion, i) => ({ at: at(`${17 + i}:00`), congestion,
      populationRange: i === 0 ? { min: 14_000, max: 16_000 } : { min: 18_000 + (i - 1) * 4_000, max: 21_000 + (i - 1) * 5_000 } })) };
}
function conditions(arrival = "17:23", duration: number | null = 60): Conditions {
  return { revision: 2, activity: "walk", originalPlan: { placeId: "yeouido", preferredArrivalAt: at(arrival), durationMinutes: duration },
    hard: { requiredSettings: ["park"], allowedPlaceIds: ["yeouido", "banpo"], excludedPlaceIds: [], pinnedPlaceId: null,
      pinnedArrivalAt: at(arrival), arrivalWindow: { timeZone: "Asia/Seoul", localDate: "2026-09-17", notBefore: at(arrival), notAfter: at(arrival) } },
    soft: { maximumPreferredCongestion: "보통", ranking: "minimum-change" }, dataPolicy: { allowDelayedForecasts: false } };
}
const run = (c: Conditions, data: Snapshot[]) => recommend(c, enabledPlaces, data, Date.parse(at("16:50")));

test("exact timestamp returns official values without interpolation", () => {
  const r = alignArrival(snapshot(), at("17:00"));
  assert.equal(r.kind, "exact");
  assert.deepEqual(r.population, { kind: "official", min: 14_000, max: 16_000, weight: null });
  assert.equal(r.evidence.length, 1);
});
test("17:23 interpolates numeric bounds using 23/60 without rounding the weight", () => {
  const r = alignArrival(snapshot(), at("17:23"));
  assert.equal(r.kind, "between"); assert.equal(r.population?.kind, "linear-estimate");
  assert.equal(r.population?.weight, 23 / 60);
  assert.ok(Math.abs(r.population!.min - 15_533.333333333334) < 0.000001);
  assert.ok(Math.abs(r.population!.max - 17_916.666666666668) < 0.000001);
  assert.deepEqual(r.evidence.map(p => p.congestion), ["보통", "약간 붐빔"]);
  assert.equal(r.trend, "rising"); assert.equal("congestion" in r, false);
});
test("interpolated bounds remain inside endpoint bounds across minute positions", () => {
  const s = snapshot();
  for (let minute = 1; minute < 60; minute++) {
    const r = alignArrival(s, at(`17:${String(minute).padStart(2, "0")}`)).population!;
    assert.ok(r.min >= 14_000 && r.min <= 18_000);
    assert.ok(r.max >= 16_000 && r.max <= 21_000);
    assert.ok(r.min <= r.max);
  }
});
test("a missing or malformed population bound never prevents categorical evidence", () => {
  for (const value of [undefined, { min: 10, max: 1 }, { min: NaN, max: 10 }]) {
    const s = snapshot(); s.forecasts[1].populationRange = value;
    const r = alignArrival(s, at("17:23"));
    assert.equal(r.population, null); assert.equal(r.kind, "between"); assert.equal(r.evidence.length, 2);
  }
});
test("observed population is not substituted for a missing forecast endpoint", () => {
  const s = snapshot(); s.forecasts = s.forecasts.slice(1);
  const r = alignArrival(s, at("17:23"));
  assert.equal(r.kind, "unavailable"); assert.equal(r.gap, "before-range"); assert.equal(r.population, null);
});
test("one-sided, absent and out-of-range forecasts are not extrapolated", () => {
  const s = snapshot();
  assert.equal(alignArrival(s, at("16:59")).gap, "before-range");
  assert.equal(alignArrival(s, at("19:01")).gap, "after-range");
  s.forecasts = s.forecasts.slice(0, 1);
  assert.equal(alignArrival(s, at("17:01")).kind, "unavailable");
  assert.equal(alignArrival(s, at("17:00")).kind, "exact");
  s.forecasts = []; assert.equal(alignArrival(s, at("17:23")).gap, "no-forecast");
});
test("60-minute intervals work but a missing hourly sample is not bridged", () => {
  const s = snapshot(); s.forecasts.splice(1, 1);
  assert.equal(alignArrival(s, at("17:23")).gap, "wide-gap");
  assert.equal(assessVisit(s, at("17:00"), 120, "보통").coverage, "partial");
  const shorter = snapshot(); shorter.forecasts[1].at = at("17:30");
  assert.equal(alignArrival(shorter, at("17:15")).population?.weight, 0.5);
});
test("threshold crossing is uncertain, not a fractional congestion category", () => {
  assert.equal(assessVisit(snapshot(), at("17:23"), null, "보통").preference, "uncertain");
  assert.equal(assessVisit(snapshot(["약간 붐빔", "보통"]), at("17:23"), null, "보통").preference, "uncertain");
  assert.equal(assessVisit(snapshot(["보통", "보통"]), at("17:23"), null, "보통").preference, "supported");
  assert.equal(assessVisit(snapshot(["여유", "보통"]), at("17:23"), null, "보통").preference, "supported");
  assert.equal(assessVisit(snapshot(["약간 붐빔", "붐빔"]), at("17:23"), null, "보통").preference, "exceeds");
});
test("stay assessment includes the end bracket and all interior points", () => {
  const r = assessVisit(snapshot(), at("17:23"), 60, "보통");
  assert.equal(r.endAt, at("18:23")); assert.equal(r.coverage, "complete");
  assert.deepEqual(r.evidence.map(p => p.at), [at("17:00"), at("18:00"), at("19:00")]);
  assert.equal(r.worstSampledCongestion, "붐빔"); assert.equal(r.preference, "exceeds");
});
test("same endpoints never hide a crowd peak during the visit", () => {
  const r = assessVisit(snapshot(["보통", "붐빔", "보통"]), at("17:00"), 120, "보통");
  assert.equal(r.trend, "mixed"); assert.equal(r.preference, "exceeds"); assert.equal(r.evidence.length, 3);
});
test("an exact end boundary does not pull in the following sample", () => {
  const r = assessVisit(snapshot(["보통", "보통", "붐빔"]), at("17:23"), 37, "보통");
  assert.deepEqual(r.evidence.map(p => p.at), [at("17:00"), at("18:00")]);
  assert.equal(r.preference, "supported"); assert.equal(r.trend, "same");
});
test("a quiet start cannot turn incomplete stay coverage into a supported preference", () => {
  const r = assessVisit(snapshot(["보통", "보통"]), at("17:23"), 60, "보통");
  assert.equal(r.coverage, "partial"); assert.equal(r.preference, "unknown"); assert.equal(r.trend, "unknown");
  assert.equal(r.gaps[0].reason, "after-range");
});
test("arrival-only mode does not infer a duration", () => {
  const r = assessVisit(snapshot(), at("17:00"), null, "보통");
  assert.equal(r.scope, "arrival"); assert.equal(r.endAt, r.startAt); assert.equal(r.evidence.length, 1);
});
test("Seoul midnight and fractional-hour stays keep their correct dates", () => {
  const s = snapshot(["보통", "보통", "보통"]);
  s.forecasts.forEach((p, i) => p.at = i === 0 ? at("23:00") : at(`0${i - 1}:00`, "2026-09-18"));
  const r = assessVisit(s, at("23:23"), 60, "보통");
  assert.equal(r.endAt, at("00:23", "2026-09-18")); assert.equal(r.coverage, "complete");
});
test("temporal evaluation is deterministic and preserves the input and provenance", () => {
  const s = snapshot(), before = structuredClone(s);
  const r = assessVisit(s, at("17:23"), 60, "보통");
  assert.deepEqual(r, assessVisit({ ...s, forecasts: [...s.forecasts].reverse() }, at("17:23"), 60, "보통"));
  assert.deepEqual(s, before);
  for (const p of r.evidence) assert.equal(p.id, `${s.id}#forecast:${p.at}`);
});
test("stable supported stay beats the original plan crossing the threshold", () => {
  const data = [snapshot(), snapshot(["보통", "보통", "보통"], "banpo")];
  const r = run(conditions(), data);
  assert.equal(r.status, "ready"); assert.equal(r.recommendedCandidateId, `banpo@${at("17:23")}`);
  assert.equal(r.options.find(o => o.role === "original")?.candidate?.visit.preference, "exceeds");
  assert.ok(r.options.every(o => o.candidate?.arrivalAt === at("17:23")));
});
test("an uncertain original is explicit when no supported candidate is allowed", () => {
  const c = conditions("17:23", null); c.hard.pinnedPlaceId = "yeouido";
  const r = run(c, [snapshot(), snapshot(["보통", "보통", "보통"], "banpo")]);
  assert.equal(r.status, "preference-uncertain"); assert.equal(r.options[0].candidate?.meetsPreference, false);
  assert.equal(r.recommendedCandidateId, `yeouido@${at("17:23")}`);
});
test("a partial original remains reviewable but is never a recommendation", () => {
  const r = run(conditions(), [snapshot(["보통", "보통"])]);
  assert.equal(r.status, "forecast-unavailable"); assert.equal(r.recommendedCandidateId, null);
  assert.equal(r.options[0].eligible, false); assert.equal(r.options[0].candidate?.visit.coverage, "partial");
});
test("population magnitudes do not compare park sizes or alter ranking", () => {
  const c = conditions(), data = [snapshot(["보통", "보통", "보통"]), snapshot(["보통", "보통", "보통"], "banpo")];
  const expected = run(c, data).recommendedCandidateId;
  data[0].forecasts.forEach(p => p.populationRange = { min: 1_000_000, max: 2_000_000 });
  data[1].forecasts.forEach(p => p.populationRange = { min: 1, max: 2 });
  assert.equal(run(c, data).recommendedCandidateId, expected);
});
test("later-only options keep the original minute and include the allowed end boundary", () => {
  const c = conditions(); c.hard.pinnedArrivalAt = null; c.hard.arrivalWindow.notAfter = at("18:23");
  const data = [snapshot(["보통", "보통", "보통", "보통"])];
  const r = run(c, data);
  assert.equal(r.recommendedCandidateId, `yeouido@${at("17:23")}`);
  assert.ok(r.candidates.every(p => p.arrivalAt >= at("17:23") && p.arrivalAt <= at("18:23")));
  assert.ok(r.candidates.some(p => p.arrivalAt === at("18:23")));
});
