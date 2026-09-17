import test from "node:test";
import assert from "node:assert/strict";
import { enabledPlaces as places } from "../src/lib/data/catalog.ts";
import { parseSeoulTime } from "../src/lib/data/time.ts";
import { adjustPlan, adjustmentConflicts, correctionAction, effectiveConditions, startReplanning } from "../src/lib/domain/replanning.ts";
import { checkChoice, recommend } from "../src/lib/domain/recommend.ts";
import { locationLink, parseChoice, planSummary, selectionUsable, updateSelection } from "../src/lib/domain/selection.ts";
import type { Conditions, Snapshot } from "../src/lib/domain/types.ts";
const at = (time: string, date = "2026-09-17") => parseSeoulTime(`${date} ${time}`)!;
const now = Date.parse(at("16:00"));
const base = (): Conditions => ({ revision: 1, activity: "walk", originalPlan: { placeId: "yeouido", preferredArrivalAt: at("17:00"), durationMinutes: 60 },
  hard: { requiredSettings: ["park", "riverside"], allowedPlaceIds: ["yeouido", "banpo", "mangwon"], excludedPlaceIds: [], pinnedPlaceId: null, pinnedArrivalAt: null,
    arrivalWindow: { timeZone: "Asia/Seoul", localDate: "2026-09-17", notBefore: at("16:30"), notAfter: at("19:00") } },
  soft: { maximumPreferredCongestion: "보통", ranking: "minimum-change" }, dataPolicy: { allowDelayedForecasts: false } });
const data = (): Snapshot[] => places.map(p => ({ id: p.id + ":v1", placeId: p.id, sourceUpdatedAt: at("15:50"), fetchedAt: at("16:00"),
  observation: { congestion: "보통" }, isReplacement: false, forecastAvailable: true, issues: [],
  forecasts: [16, 17, 18, 19, 20].map(hour => ({ at: at(`${hour}:00`), congestion: p.id === "yeouido" ? "붐빔" : "보통", populationRange: { min: 100, max: 200 } })) }));

test("pin both fields then unpin restores exactly the original window/permissions and baseline", () => {
  const original = base(), before = structuredClone(original);
  let s = startReplanning(original);
  s = adjustPlan(s, { type: "pin-place", placeId: "banpo" }, places);
  s = adjustPlan(s, { type: "pin-time", at: at("17:23") }, places);
  const pinned = effectiveConditions(s, 2, places);
  assert.equal(pinned.hard.pinnedPlaceId, "banpo"); assert.equal(pinned.hard.pinnedArrivalAt, at("17:23"));
  assert.deepEqual(pinned.originalPlan, original.originalPlan);
  s = adjustPlan(adjustPlan(s, { type: "unpin-time" }, places), { type: "unpin-place" }, places);
  assert.deepEqual(effectiveConditions(s, 1, places), before); assert.deepEqual(original, before);
});
test("extra unpin cannot silently loosen a place or time fixed in initial conditions", () => {
  const c = base(); c.hard.pinnedPlaceId = "yeouido"; c.hard.pinnedArrivalAt = at("17:00");
  let s = startReplanning(c);
  assert.throws(() => adjustPlan(s, { type: "pin-place", placeId: "banpo" }, places));
  assert.throws(() => adjustPlan(s, { type: "pin-time", at: at("18:00") }, places));
  s = adjustPlan(adjustPlan(s, { type: "unpin-place" }, places), { type: "unpin-time" }, places);
  assert.deepEqual(effectiveConditions(s, 1, places), c);
});
test("pins outside allowed set/window, invalid instants and unknown places are rejected", () => {
  const s = startReplanning(base());
  assert.throws(() => adjustPlan(s, { type: "pin-place", placeId: "nanji" }, places));
  for (const time of [at("20:00"), "bad", "2026-02-30T08:00:00.000Z"]) assert.throws(() => adjustPlan(s, { type: "pin-time", at: time }, places));
  assert.throws(() => adjustPlan(s, { type: "exclude", placeId: "unknown" }, places));
});
test("excluding a pinned place shows conflict without clearing the pin; restore recovers", () => {
  let s = adjustPlan(startReplanning(base()), { type: "pin-place", placeId: "banpo" }, places);
  s = adjustPlan(s, { type: "exclude", placeId: "banpo" }, places);
  assert.match(adjustmentConflicts(s, places)[0], /고정한 공원/);
  assert.equal(effectiveConditions(s, 2, places).hard.pinnedPlaceId, "banpo");
  assert.equal(recommend(effectiveConditions(s, 2, places), places, data(), now).status, "no-candidates");
  s = adjustPlan(s, { type: "restore", placeId: "banpo" }, places);
  assert.equal(recommend(effectiveConditions(s, 3, places), places, data(), now).status, "ready");
});
test("all exclusions, explicit restore and reset preserve allowed-place permissions", () => {
  const c = base(); c.hard.excludedPlaceIds = ["mangwon"];
  let s = startReplanning(c);
  for (const placeId of c.hard.allowedPlaceIds!) s = adjustPlan(s, { type: "exclude", placeId }, places);
  assert.match(adjustmentConflicts(s, places).join(" "), /모두 제외/);
  s = adjustPlan(s, { type: "restore", placeId: "mangwon" }, places);
  const effective = effectiveConditions(s, 2, places);
  assert.deepEqual(effective.hard.allowedPlaceIds, c.hard.allowedPlaceIds);
  assert.ok(!effective.hard.excludedPlaceIds.includes("mangwon"));
  assert.deepEqual(effectiveConditions(adjustPlan(s, { type: "reset" }, places), 1, places), c);
});
test("late-only correction uses existing later range and original place, never expands time", () => {
  const s = adjustPlan(startReplanning(base()), { type: "later-only" }, places), c = effectiveConditions(s, 2, places);
  assert.equal(c.hard.arrivalWindow.notBefore, at("17:00")); assert.equal(c.hard.arrivalWindow.notAfter, at("19:00"));
  assert.equal(c.hard.pinnedPlaceId, "yeouido"); assert.deepEqual(c.originalPlan, base().originalPlan);
  const fixed = base(); fixed.hard.pinnedArrivalAt = at("17:00");
  assert.throws(() => adjustPlan(startReplanning(fixed), { type: "later-only" }, places), /범위/);
  const undecided = base(); undecided.originalPlan.placeId = null;
  assert.throws(() => adjustPlan(startReplanning(undecided), { type: "later-only" }, places), /기준/);
});
test("bounded Korean corrections share button actions and do not guess negated/compound requests", () => {
  const s = startReplanning(base());
  assert.deepEqual(correctionAction("망원은 빼줘", s, places), { type: "exclude", placeId: "mangwon" });
  assert.deepEqual(correctionAction("망원을 다시 포함해줘", s, places), { type: "restore", placeId: "mangwon" });
  assert.deepEqual(correctionAction("반포로 고정", s, places), { type: "pin-place", placeId: "banpo" });
  assert.deepEqual(correctionAction("그럼 시간만 늦추자", s, places), { type: "later-only" });
  assert.deepEqual(correctionAction("19시 고정", s, places), { type: "pin-time", at: at("19:00") });
  assert.deepEqual(correctionAction("오후 5시 23분 고정", s, places), { type: "pin-time", at: at("17:23") });
  assert.deepEqual(correctionAction("시간 고정 해제", s, places), { type: "unpin-time" });
  for (const text of ["망원은 빼지 마", "망원은 빼줘 그리고 19시로", "서울숲은 빼줘", "5시 고정"]) assert.throws(() => correctionAction(text, s, places));
});
test("a midnight command resolves only to the date inside the allowed window", () => {
  const c = base(); c.hard.arrivalWindow.notBefore = at("23:00"); c.hard.arrivalWindow.notAfter = at("02:00", "2026-09-18");
  assert.deepEqual(correctionAction("오전 1시 고정", startReplanning(c), places), { type: "pin-time", at: at("01:00", "2026-09-18") });
});
test("checking a selected plan keeps its exact identity even if another plan ranks better", () => {
  const c = base(), snapshots = data(), choice = { placeId: "yeouido", arrivalAt: at("17:23") };
  const r = recommend(c, places, snapshots, now); assert.ok(r.recommendedCandidateId?.startsWith("banpo"));
  const checked = checkChoice(c, choice, places, snapshots, now);
  assert.deepEqual(checked.choice, choice); assert.equal(checked.candidate?.id, `yeouido@${at("17:23")}`);
  assert.equal(checked.eligible, true); assert.equal(checked.candidate?.meetsPreference, false);
});
test("selection endpoint contract rejects forged/expired/forbidden choices and insufficient stay data", () => {
  assert.throws(() => parseChoice({ placeId: "elsewhere", arrivalAt: at("17:00") }, places));
  assert.throws(() => parseChoice({ placeId: "yeouido", arrivalAt: "2026-09-17T08:00:30Z" }, places));
  for (const choice of [{ placeId: "nanji", arrivalAt: at("17:00") }, { placeId: "banpo", arrivalAt: at("15:00") }, { placeId: "banpo", arrivalAt: at("22:00") }]) {
    assert.equal(checkChoice(base(), choice, places, data(), now).eligible, false);
  }
  const truncated = data(); truncated.forEach(s => s.forecasts = s.forecasts.slice(0, 3));
  assert.equal(checkChoice(base(), { placeId: "banpo", arrivalAt: at("17:23") }, places, truncated, now).eligible, false);
});
test("unchanged evidence preserves confirmation, changed evidence or unavailable data requires reconfirmation", () => {
  const c = base(), choice = { placeId: "banpo", arrivalAt: at("17:23") };
  const first = checkChoice(c, choice, places, data(), now);
  const confirmed = { ...updateSelection(null, first), confirmedAt: at("16:01") };
  const refreshed = data(); refreshed.forEach(s => { s.id += ":new"; s.sourceUpdatedAt = at("15:55"); s.fetchedAt = at("16:02"); });
  assert.equal(updateSelection(confirmed, checkChoice(c, choice, places, refreshed, now + 2 * 60_000)).confirmedAt, confirmed.confirmedAt);
  refreshed.find(s => s.placeId === "banpo")!.forecasts[2].congestion = "약간 붐빔";
  const changed = updateSelection(confirmed, checkChoice(c, choice, places, refreshed, now + 2 * 60_000));
  assert.equal(changed.confirmedAt, null); assert.deepEqual(changed.check.choice, choice); assert.match(changed.notice!, /달라졌/);
  const missing = updateSelection(confirmed, checkChoice(c, choice, places, [], now));
  assert.equal(missing.confirmedAt, null); assert.deepEqual(missing.check.choice, choice);
});
test("confirmation expires by revision, arrival, freshness or five-minute check age", () => {
  const check = checkChoice(base(), { placeId: "banpo", arrivalAt: at("17:00") }, places, data(), now);
  assert.equal(selectionUsable(check, 1, now), true); assert.equal(selectionUsable(check, 2, now), false);
  assert.equal(selectionUsable(check, 1, now + 5 * 60_000 + 1), false);
  assert.equal(selectionUsable(check, 1, Date.parse(at("17:00"))), false);
  const edge = structuredClone(check); edge.candidate!.sourceUpdatedAt = at("15:30");
  assert.equal(selectionUsable(edge, 1, now + 1), false);
});
test("copy summary includes selected place/time/stay evidence and encoded representative location only after confirmation", () => {
  const c = base(), plan = updateSelection(null, checkChoice(c, { placeId: "banpo", arrivalAt: at("17:23") }, places, data(), now));
  assert.throws(() => planSummary(plan, c, places));
  plan.confirmedAt = at("16:01");
  const text = planSummary(plan, c, places);
  assert.match(text, /반포한강공원/); assert.match(text, /17:23/); assert.match(text, /18:23/); assert.match(text, /이동시간 미반영/);
  const link = locationLink(places.find(p => p.id === "banpo")!);
  assert.equal(new URL(link).origin, "https://map.kakao.com"); assert.ok(link.includes(encodeURIComponent("반포한강공원")));
});
