import { parseSeoulTime, seoulInputTime } from "../data/time.ts";
import { ConditionsError, parseConditions } from "./conditions.ts";
import type { Conditions, Place } from "./types.ts";

export interface ManualDraft {
  placeId: string;
  arrival: string;
  duration: string;
  allowPlaceChange: boolean;
  allowedPlaceIds: string[];
  timeMode: "fixed" | "later-60" | "later-120" | "custom";
  windowStart: string;
  windowEnd: string;
  maximumCongestion: Conditions["soft"]["maximumPreferredCongestion"];
  ranking: Conditions["soft"]["ranking"];
  allowDelayedForecasts: boolean;
}

export function manualConditions(draft: ManualDraft, revision: number, places: Place[]): Conditions {
  const parseInput = (value: string) => {
    const at = parseSeoulTime(value.replace("T", " "));
    if (!at) throw new ConditionsError("날짜와 도착 시각을 모두 입력해주세요.");
    return at;
  };
  const arrival = parseInput(draft.arrival);
  const start = draft.timeMode === "custom" ? parseInput(draft.windowStart) : arrival;
  const end = draft.timeMode === "custom" ? parseInput(draft.windowEnd) :
    new Date(Date.parse(arrival) + (draft.timeMode === "later-60" ? 60 : draft.timeMode === "later-120" ? 120 : 0) * 60_000).toISOString();
  return parseConditions({
    revision, activity: "walk",
    originalPlan: { placeId: draft.placeId, preferredArrivalAt: arrival, durationMinutes: Number(draft.duration) },
    hard: { requiredSettings: ["park", "riverside"], allowedPlaceIds: draft.allowPlaceChange ? draft.allowedPlaceIds : [draft.placeId],
      excludedPlaceIds: [], pinnedPlaceId: draft.allowPlaceChange ? null : draft.placeId,
      pinnedArrivalAt: draft.timeMode === "fixed" ? arrival : null,
      arrivalWindow: { timeZone: "Asia/Seoul", localDate: seoulInputTime(start).slice(0, 10), notBefore: start, notAfter: end } },
    soft: { maximumPreferredCongestion: draft.maximumCongestion, ranking: draft.ranking },
    dataPolicy: { allowDelayedForecasts: draft.allowDelayedForecasts },
  }, places);
}
