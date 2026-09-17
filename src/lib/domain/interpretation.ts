import type { Conditions, Place } from "./types.ts";
import { ConditionsError, parseConditions } from "./conditions.ts";
import { parseSeoulTime, seoulInputTime } from "../data/time.ts";

export interface Interpretation {
  activity: "walk" | "unsupported" | null;
  placeId: string | null;
  localDate: string | null;
  timeKind: "exact" | "range" | "after" | "before" | "soon" | "evening" | "unspecified";
  startTime: string | null;
  endTime: string | null;
  latestDelayMinutes: number | null;
  durationMinutes: number | null;
  placeChangeAllowed: boolean | null;
  allowedPlaceIds: string[] | null;
  excludedPlaceIds: string[];
  maximumPreferredCongestion: Conditions["soft"]["maximumPreferredCongestion"] | null;
  ranking: Conditions["soft"]["ranking"] | null;
  unsupportedRequests: string[];
  clarification: string | null;
}

export function interpretationSchema(places: Place[]) {
  const nullableString = { type: ["string", "null"] };
  const nullableInteger = { type: ["integer", "null"] };
  const ids = places.map(p => p.id);
  const properties = {
    activity: { type: ["string", "null"], enum: ["walk", "unsupported", null] },
    placeId: { type: ["string", "null"], enum: [...ids, null] },
    localDate: nullableString,
    timeKind: { type: "string", enum: ["exact", "range", "after", "before", "soon", "evening", "unspecified"] },
    startTime: nullableString, endTime: nullableString, latestDelayMinutes: nullableInteger, durationMinutes: nullableInteger,
    placeChangeAllowed: { type: ["boolean", "null"] },
    allowedPlaceIds: { anyOf: [{ type: "array", items: { type: "string", enum: ids } }, { type: "null" }] },
    excludedPlaceIds: { type: "array", items: { type: "string", enum: ids } },
    maximumPreferredCongestion: { type: ["string", "null"], enum: ["여유", "보통", "약간 붐빔", "붐빔", null] },
    ranking: { type: ["string", "null"], enum: ["minimum-change", "less-crowded", null] },
    unsupportedRequests: { type: "array", items: { type: "string" } },
    clarification: nullableString,
  };
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

export function parseInterpretation(value: unknown, places: Place[]): Interpretation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConditionsError("AI 해석 형식을 확인하지 못했어요.");
  const v = value as Record<string, unknown>, schema = interpretationSchema(places), keys = Object.keys(v);
  if (keys.length !== schema.required.length || schema.required.some(k => !(k in v))) throw new ConditionsError("AI 해석 항목이 올바르지 않아요.");
  const oneOf = (x: unknown, list: unknown[]) => list.includes(x);
  const ids = places.map(p => p.id);
  const idList = (x: unknown) => Array.isArray(x) && x.length <= ids.length && new Set(x).size === x.length && x.every(id => ids.includes(id));
  const time = (x: unknown) => x === null || typeof x === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
  const integer = (x: unknown, maximum: number) => x === null || Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= maximum;
  if (!oneOf(v.activity, ["walk", "unsupported", null]) || !oneOf(v.placeId, [...ids, null]) ||
    !(v.localDate === null || typeof v.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.localDate)) ||
    !oneOf(v.timeKind, schema.properties.timeKind.enum) || !time(v.startTime) || !time(v.endTime) ||
    !integer(v.latestDelayMinutes, 1440) || !integer(v.durationMinutes, 1440) || !oneOf(v.placeChangeAllowed, [true, false, null]) ||
    !(v.allowedPlaceIds === null || idList(v.allowedPlaceIds)) || !idList(v.excludedPlaceIds) ||
    !oneOf(v.maximumPreferredCongestion, ["여유", "보통", "약간 붐빔", "붐빔", null]) ||
    !oneOf(v.ranking, ["minimum-change", "less-crowded", null]) || !Array.isArray(v.unsupportedRequests) ||
    v.unsupportedRequests.length > 5 || v.unsupportedRequests.some(x => typeof x !== "string" || x.length > 120) ||
    !(v.clarification === null || typeof v.clarification === "string" && v.clarification.length > 0 && v.clarification.length <= 180)) {
    throw new ConditionsError("AI가 해석한 조건을 검증하지 못했어요. 아래 조건을 직접 정해주세요.");
  }
  return structuredClone(v) as unknown as Interpretation;
}

export function conditionsFromInterpretation(v: Interpretation, places: Place[], nowMs: number, revision: number,
  allowDelayedForecasts: boolean): { conditions: Conditions; assumptions: string[]; unsupported: string[] } {
  if (v.clarification) throw new ConditionsError(v.clarification);
  if (v.activity === "unsupported") throw new ConditionsError("현재는 한강공원 산책을 비교할 수 있어요. 지원하는 활동으로 조건을 정해주세요.");
  const assumptions: string[] = [], today = seoulInputTime(new Date(nowMs).toISOString()).slice(0, 10);
  const date = v.localDate ?? today;
  if (!parseSeoulTime(`${date} 00:00`)) throw new ConditionsError("방문 날짜를 확인해주세요.");
  const local = (time: string | null) => time ? parseSeoulTime(`${date} ${time}`) : null;
  const add = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60_000).toISOString();
  const soon = new Date(Math.ceil(nowMs / 60_000) * 60_000).toISOString();
  let start: string | null = null, end: string | null = null, original: string | null = null;
  if (v.timeKind === "exact") {
    original = start = local(v.startTime);
    if (start) end = add(start, v.latestDelayMinutes ?? 0);
  } else if (v.timeKind === "range") {
    start = local(v.startTime); end = local(v.endTime);
    if (start && end && end < start) end = add(end, 1440);
  } else if (v.timeKind === "after") {
    start = local(v.startTime); if (start) end = add(start, 180);
    assumptions.push("종료 시각이 없어 시작부터 3시간 범위를 제안했어요. 허용 범위에서 바꿀 수 있어요.");
  } else if (v.timeKind === "before") {
    end = local(v.endTime); start = date === today ? soon : local("00:00");
  } else if (v.timeKind === "evening") {
    start = local("18:00"); end = local("21:00");
    assumptions.push("‘저녁’은 18~21시 방문 범위로 제안했어요. 허용 범위에서 바꿀 수 있어요.");
  } else {
    if (date !== today) throw new ConditionsError("다른 날짜에 방문한다면 원하는 시간대도 알려주세요.");
    start = soon; end = add(start, v.latestDelayMinutes ?? 120);
    assumptions.push(`정확한 도착시각 없이 지금부터 ${v.latestDelayMinutes ?? 120}분의 방문 전망을 비교해요. 실제 이동시간은 미반영입니다.`);
  }
  if (!start || !end) throw new ConditionsError("원하는 방문 시각이나 시간대를 확인해주세요.");
  if (v.durationMinutes !== null && (v.durationMinutes < 15 || v.durationMinutes > 240)) throw new ConditionsError("머무는 시간은 15~240분 범위에서 비교할 수 있어요.");
  if (v.activity === null) assumptions.push("현재 지원하는 산책 활동으로 비교해요.");
  if (v.maximumPreferredCongestion === null) assumptions.push("혼잡 선호는 ‘보통까지’로 제안했어요.");
  const allowed = v.allowedPlaceIds ?? (v.placeId && v.placeChangeAllowed !== true ? [v.placeId] : places.map(p => p.id));
  if (v.placeId === null && v.allowedPlaceIds === null) assumptions.push("목적지가 미정이라 현재 지원하는 한강공원 5곳을 비교해요.");
  if (v.placeId && v.placeChangeAllowed === null) assumptions.push("장소 변경 허용이 없어 정한 공원 안에서만 비교해요.");
  const conditions = parseConditions({ revision, activity: "walk",
    originalPlan: { placeId: v.placeId, preferredArrivalAt: original, durationMinutes: v.durationMinutes },
    hard: { requiredSettings: ["park", "riverside"], allowedPlaceIds: allowed, excludedPlaceIds: v.excludedPlaceIds,
      pinnedPlaceId: v.placeId && v.placeChangeAllowed !== true ? v.placeId : null,
      pinnedArrivalAt: start === end ? start : null,
      arrivalWindow: { timeZone: "Asia/Seoul", localDate: seoulInputTime(start).slice(0, 10), notBefore: start, notAfter: end } },
    soft: { maximumPreferredCongestion: v.maximumPreferredCongestion ?? "보통", ranking: v.ranking ?? "minimum-change" },
    dataPolicy: { allowDelayedForecasts },
  }, places);
  return { conditions, assumptions, unsupported: v.unsupportedRequests };
}
