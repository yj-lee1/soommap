import type { Conditions, Place } from "./types.ts";

export class ConditionsError extends Error {}
function invalid(message: string): never { throw new ConditionsError(message); }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : invalid("조건 형식을 확인해주세요.");
function instant(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid("날짜와 시각을 확인해주세요.");
  return value as string;
}

/** Parse untrusted manual/AI conditions; never accept client-supplied forecasts. */
export function parseConditions(value: unknown, places: Place[]): Conditions {
  const root = object(value), original = object(root.originalPlan), hard = object(root.hard),
    window = object(hard.arrivalWindow), soft = object(root.soft), policy = object(root.dataPolicy);
  const ids = new Set(places.filter(p => p.enabled).map(p => p.id));
  const placeId = (v: unknown): string | null => v === null ? null : typeof v === "string" && ids.has(v) ? v : invalid("지원하는 장소를 선택해주세요.");
  const placesList = (v: unknown): string[] => {
    if (!Array.isArray(v) || v.length > ids.size || v.some(id => placeId(id) === null) || new Set(v).size !== v.length) invalid("허용 장소 목록을 확인해주세요.");
    return [...v] as string[];
  };
  if (!Number.isInteger(root.revision) || (root.revision as number) < 0 || (root.revision as number) > 1_000_000) invalid("조건 버전을 확인해주세요.");
  if (root.activity !== "walk") invalid("현재는 산책 조건을 비교할 수 있어요.");
  if (!Array.isArray(hard.requiredSettings) || hard.requiredSettings.length > 2 ||
    hard.requiredSettings.some(s => !["riverside", "park"].includes(s))) invalid("장소 환경 조건을 확인해주세요.");
  if (window.timeZone !== "Asia/Seoul" || typeof window.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(window.localDate)) invalid("한국 기준 날짜를 확인해주세요.");
  const start = instant(window.notBefore), end = instant(window.notAfter);
  if (start && end && (start > end || Date.parse(end) - Date.parse(start) > 24 * 60 * 60_000)) invalid("도착 범위는 순서대로, 24시간 이내로 정해주세요.");
  if (start && new Date(Date.parse(start) + 9 * 60 * 60_000).toISOString().slice(0, 10) !== window.localDate) invalid("도착 범위의 시작 날짜를 확인해주세요.");
  const duration = original.durationMinutes;
  if (duration !== null && (!Number.isInteger(duration) || (duration as number) < 15 || (duration as number) > 240)) invalid("머무는 시간은 15~240분으로 정해주세요.");
  if (!["여유", "보통", "약간 붐빔", "붐빔"].includes(soft.maximumPreferredCongestion as string) ||
    !["minimum-change", "less-crowded"].includes(soft.ranking as string)) invalid("혼잡 선호와 비교 기준을 선택해주세요.");
  if (typeof policy.allowDelayedForecasts !== "boolean") invalid("지연 예측의 참고 비교 여부를 선택해주세요.");
  return {
    revision: root.revision as number, activity: "walk",
    originalPlan: { placeId: placeId(original.placeId), preferredArrivalAt: instant(original.preferredArrivalAt), durationMinutes: duration as number | null },
    hard: { requiredSettings: [...hard.requiredSettings] as Conditions["hard"]["requiredSettings"],
      allowedPlaceIds: hard.allowedPlaceIds === null ? null : placesList(hard.allowedPlaceIds), excludedPlaceIds: placesList(hard.excludedPlaceIds),
      pinnedPlaceId: placeId(hard.pinnedPlaceId), pinnedArrivalAt: instant(hard.pinnedArrivalAt),
      arrivalWindow: { timeZone: "Asia/Seoul", localDate: window.localDate as string, notBefore: start, notAfter: end } },
    soft: { maximumPreferredCongestion: soft.maximumPreferredCongestion as Conditions["soft"]["maximumPreferredCongestion"], ranking: soft.ranking as Conditions["soft"]["ranking"] },
    dataPolicy: { allowDelayedForecasts: policy.allowDelayedForecasts as boolean },
  };
}
