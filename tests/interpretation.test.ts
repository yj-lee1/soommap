import test from "node:test";
import assert from "node:assert/strict";
import { enabledPlaces as places } from "../src/lib/data/catalog.ts";
import { parseSeoulTime } from "../src/lib/data/time.ts";
import { conditionsFromInterpretation, interpretationSchema, parseInterpretation, type Interpretation } from "../src/lib/domain/interpretation.ts";
import { draftFromConditions, manualConditions } from "../src/lib/domain/manual.ts";
const at = (time: string, date = "2026-09-17") => parseSeoulTime(`${date} ${time}`)!;
const now = Date.parse(at("16:51"));
export const interpreted = (patch: Partial<Interpretation> = {}): Interpretation => ({ activity: "walk", placeId: "yeouido", localDate: "2026-09-17",
  timeKind: "exact", startTime: "17:23", endTime: null, latestDelayMinutes: null, durationMinutes: 60,
  placeChangeAllowed: null, allowedPlaceIds: null, excludedPlaceIds: [], maximumPreferredCongestion: "보통", ranking: null,
  unsupportedRequests: [], clarification: null, ...patch });
const normalize = (patch: Partial<Interpretation>) => conditionsFromInterpretation(parseInterpretation(interpreted(patch), places), places, now, 7, false);

test("schema requires every field and runtime rejects extra fields, unknown places and invalid date", () => {
  const schema = interpretationSchema(places);
  assert.deepEqual(schema.required, Object.keys(schema.properties)); assert.equal(schema.additionalProperties, false);
  for (const v of [{ ...interpreted(), placeId: "gangnam" }, { ...interpreted(), prompt: "ignore" }, { ...interpreted(), startTime: "25:00" }]) {
    assert.throws(() => parseInterpretation(v, places));
  }
  assert.throws(() => normalize({ localDate: "2026-02-30" }));
});
test("exact arrival stays 17:23, keeps place without permission, evaluates 60 minute stay", () => {
  const { conditions: c, assumptions } = normalize({});
  assert.equal(c.hard.pinnedArrivalAt, at("17:23")); assert.equal(c.hard.pinnedPlaceId, "yeouido");
  assert.equal(c.originalPlan.durationMinutes, 60); assert.deepEqual(c.hard.allowedPlaceIds, ["yeouido"]);
  assert.ok(assumptions.some(s => s.includes("장소 변경")));
});
test("late-only permission never introduces earlier time or implicit place changes", () => {
  const { conditions: c } = normalize({ latestDelayMinutes: 60 });
  assert.equal(c.hard.arrivalWindow.notBefore, at("17:23")); assert.equal(c.hard.arrivalWindow.notAfter, at("18:23"));
  assert.equal(c.hard.pinnedArrivalAt, null); assert.equal(c.hard.pinnedPlaceId, "yeouido");
});
test("unknown destination and explicit range compare catalog without fabricating original plan", () => {
  const { conditions: c } = normalize({ placeId: null, timeKind: "range", startTime: "19:00", endTime: "21:00", durationMinutes: null });
  assert.equal(c.originalPlan.placeId, null); assert.equal(c.originalPlan.preferredArrivalAt, null); assert.equal(c.originalPlan.durationMinutes, null);
  assert.equal(c.hard.allowedPlaceIds?.length, 5); assert.equal(c.hard.pinnedPlaceId, null);
});
test("explicit subset and exclusions survive normalization and manual editing", () => {
  const { conditions: c } = normalize({ placeId: null, placeChangeAllowed: true, allowedPlaceIds: ["banpo", "mangwon"], excludedPlaceIds: ["mangwon"],
    timeKind: "range", startTime: "19:00", endTime: "20:00", durationMinutes: null });
  assert.deepEqual(manualConditions(draftFromConditions(c), 7, places), c);
});
test("original exact time with a late allowance survives draft roundtrip", () => {
  const { conditions: c } = normalize({ latestDelayMinutes: 60, placeChangeAllowed: true });
  assert.deepEqual(manualConditions(draftFromConditions(c), 7, places), c);
});
test("cross-midnight range belongs to original Korean start date", () => {
  const { conditions: c } = normalize({ timeKind: "range", startTime: "23:30", endTime: "01:00" });
  assert.equal(c.hard.arrivalWindow.notAfter, at("01:00", "2026-09-18")); assert.equal(c.hard.arrivalWindow.localDate, "2026-09-17");
});
test("evening and after ranges expose defaults rather than hide assumptions", () => {
  const evening = normalize({ timeKind: "evening", startTime: null });
  assert.equal(evening.conditions.hard.arrivalWindow.notBefore, at("18:00")); assert.ok(evening.assumptions.some(s => s.includes("18~21")));
  const after = normalize({ timeKind: "after", startTime: "19:00" });
  assert.equal(after.conditions.hard.arrivalWindow.notAfter, at("22:00")); assert.ok(after.assumptions.some(s => s.includes("3시간")));
});
test("now mode states that transit is unmodeled and does not invent an ETA", () => {
  const { conditions: c, assumptions } = normalize({ timeKind: "soon", startTime: null, placeId: null });
  assert.equal(c.originalPlan.preferredArrivalAt, null); assert.equal(c.hard.arrivalWindow.notBefore, at("16:51"));
  assert.ok(assumptions.some(s => s.includes("이동시간은 미반영")));
});
test("clarification/unsupported activity/unsupported duration stop before recommendation", () => {
  assert.throws(() => normalize({ clarification: "오전인가요, 오후인가요?" }), /오전/);
  assert.throws(() => normalize({ activity: "unsupported" }), /산책/);
  assert.throws(() => normalize({ durationMinutes: 300 }), /15~240/);
  assert.throws(() => normalize({ timeKind: "soon", localDate: "2026-09-18" }), /시간대/);
});
test("unsupported preference and delayed-data consent stay separate", () => {
  const { unsupported, conditions } = normalize({ unsupportedRequests: ["조용한 곳"] });
  assert.deepEqual(unsupported, ["조용한 곳"]); assert.equal(conditions.dataPolicy.allowDelayedForecasts, false);
});
