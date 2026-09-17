import { ConditionsError, parseConditions } from "./conditions.ts";
import { parseSeoulTime, seoulInputTime } from "../data/time.ts";
import type { Conditions, Place } from "./types.ts";

export interface Replanning {
  base: Conditions;
  placePin: string | null;
  timePin: string | null;
  excludedPlaceIds: string[];
  laterOnly: boolean;
}
export type Adjustment = { type: "pin-place" | "exclude" | "restore"; placeId: string }
  | { type: "pin-time"; at: string }
  | { type: "unpin-place" | "unpin-time" | "later-only" | "clear-later-only" | "reset" };
export function startReplanning(base: Conditions): Replanning {
  return { base: structuredClone(base), placePin: null, timePin: null, excludedPlaceIds: [...base.hard.excludedPlaceIds], laterOnly: false };
}
export function effectiveConditions(state: Replanning, revision: number, places: Place[]): Conditions {
  const c = structuredClone(state.base);
  c.revision = revision;
  c.hard.pinnedPlaceId = state.placePin ?? c.hard.pinnedPlaceId;
  c.hard.pinnedArrivalAt = state.timePin ?? c.hard.pinnedArrivalAt;
  c.hard.excludedPlaceIds = [...state.excludedPlaceIds];
  if (state.laterOnly && c.originalPlan.preferredArrivalAt && (!c.hard.arrivalWindow.notBefore || c.hard.arrivalWindow.notBefore < c.originalPlan.preferredArrivalAt)) {
    c.hard.arrivalWindow.notBefore = c.originalPlan.preferredArrivalAt;
    c.hard.arrivalWindow.localDate = seoulInputTime(c.originalPlan.preferredArrivalAt).slice(0, 10);
  }
  return parseConditions(c, places);
}
export function adjustPlan(state: Replanning, action: Adjustment, places: Place[]): Replanning {
  const next = structuredClone(state), base = state.base;
  if ("placeId" in action && !places.some(p => p.id === action.placeId)) throw new ConditionsError("지원하는 공원을 선택해주세요.");
  switch (action.type) {
    case "pin-place":
      if (!base.hard.allowedPlaceIds?.includes(action.placeId) || base.hard.pinnedPlaceId && base.hard.pinnedPlaceId !== action.placeId) {
        throw new ConditionsError("처음 허용한 장소 범위 밖이에요. 아래 입력에서 허용 범위를 먼저 바꿔주세요.");
      }
      next.placePin = action.placeId; break;
    case "pin-time": {
      const at = action.at;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at ||
        base.hard.arrivalWindow.notBefore && at < base.hard.arrivalWindow.notBefore || base.hard.arrivalWindow.notAfter && at > base.hard.arrivalWindow.notAfter ||
        base.hard.pinnedArrivalAt && base.hard.pinnedArrivalAt !== at) {
        throw new ConditionsError("처음 허용한 시간 범위 밖이에요. 아래 입력에서 도착 범위를 먼저 바꿔주세요.");
      }
      next.timePin = at; break;
    }
    case "unpin-place": next.placePin = null; break;
    case "unpin-time": next.timePin = null; break;
    case "exclude": next.excludedPlaceIds = [...new Set([...next.excludedPlaceIds, action.placeId])]; break;
    case "restore": next.excludedPlaceIds = next.excludedPlaceIds.filter(id => id !== action.placeId); break;
    case "later-only": {
      const original = base.originalPlan;
      if (!original.placeId || !original.preferredArrivalAt) throw new ConditionsError("시간만 늦추려면 기준 장소와 도착시각이 필요해요. 아래 입력에서 정해주세요.");
      if (!base.hard.allowedPlaceIds?.includes(original.placeId) || base.hard.pinnedPlaceId && base.hard.pinnedPlaceId !== original.placeId ||
        base.hard.pinnedArrivalAt || !base.hard.arrivalWindow.notAfter || base.hard.arrivalWindow.notAfter <= original.preferredArrivalAt) {
        throw new ConditionsError("늦출 수 있는 범위가 없어요. ‘최대 1시간 늦어도 괜찮아요’ 등 허용 범위를 먼저 정해주세요.");
      }
      next.placePin = original.placeId; next.timePin = null; next.laterOnly = true; break;
    }
    case "clear-later-only": next.laterOnly = false; break;
    case "reset": return startReplanning(base);
  }
  effectiveConditions(next, base.revision, places);
  return next;
}

export function adjustmentConflicts(state: Replanning, places: Place[]): string[] {
  const c = effectiveConditions(state, state.base.revision, places), reasons: string[] = [];
  const pin = c.hard.pinnedPlaceId;
  if (pin && c.hard.excludedPlaceIds.includes(pin)) reasons.push("고정한 공원을 제외해서 후보가 없어요. 제외를 복원하거나 추가 고정을 해제해주세요.");
  if (!c.hard.allowedPlaceIds?.length) reasons.push("비교를 허용한 공원이 없어요. 위 입력에서 갈 수 있는 공원을 하나 이상 선택해주세요.");
  else if (!c.hard.allowedPlaceIds.some(id => !c.hard.excludedPlaceIds.includes(id))) reasons.push("허용한 공원이 모두 제외됐어요. 제외한 공원을 복원하거나 허용 목록을 바꿔주세요.");
  if (pin && !c.hard.allowedPlaceIds?.includes(pin)) reasons.push("고정한 공원이 허용 목록에 없어요. 위 입력에서 장소 고정 또는 허용 범위를 수정해주세요.");
  if (c.hard.pinnedArrivalAt && ((c.hard.arrivalWindow.notBefore && c.hard.pinnedArrivalAt < c.hard.arrivalWindow.notBefore) ||
    (c.hard.arrivalWindow.notAfter && c.hard.pinnedArrivalAt > c.hard.arrivalWindow.notAfter))) reasons.push("고정 시각이 허용 범위 밖이에요. 추가 시간 고정·늦추기 제한을 해제하거나 위 도착 범위를 수정해주세요.");
  return reasons;
}

/** Deliberately bounded commands; unknown/negated/compound input never becomes a guessed edit. */
export function correctionAction(text: string, state: Replanning, places: Place[]): Adjustment {
  const value = text.trim().replace(/[.!。]$/u, "").replace(/^그럼\s*/u, "").replace(/\s+/gu, "");
  if (!value || text.length > 120) throw new ConditionsError("짧은 정정 명령을 입력해주세요.");
  if (/^시간(?:고정)?(?:을)?해제(?:해줘)?$/u.test(value)) return { type: "unpin-time" };
  if (/^장소(?:고정)?(?:를)?해제(?:해줘)?$/u.test(value)) return { type: "unpin-place" };
  if (/^시간만늦추(?:자|기|어줘|줘)$/u.test(value)) return { type: "later-only" };
  if (/^(?:추가조정|처음조건으로)(?:초기화|돌아가|복원)(?:해줘)?$/u.test(value)) return { type: "reset" };
  for (const place of places) {
    for (const alias of [place.name, place.name.replace("한강공원", "")]) {
      const prefix = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^(?:이번에는?)?${prefix}(?:은|는|을|를)?(?:빼줘|제외해줘|제외)$`, "u").test(value)) return { type: "exclude", placeId: place.id };
      if (new RegExp(`^${prefix}(?:은|는|을|를)?(?:다시포함해줘|복원해줘|다시넣어줘|복원)$`, "u").test(value)) return { type: "restore", placeId: place.id };
      if (new RegExp(`^${prefix}(?:으로|로|만)?(?:고정해줘|고정)$`, "u").test(value)) return { type: "pin-place", placeId: place.id };
    }
  }
  const time = /^(오전|오후)?(\d{1,2})시(?:(\d{1,2})분)?(?:로|으로)?고정(?:해줘)?$/u.exec(value);
  if (time) {
    let hour = Number(time[2]); const minute = Number(time[3] ?? 0);
    if (hour > 23 || minute > 59 || time[1] && (hour < 1 || hour > 12)) throw new ConditionsError("시각을 확인해주세요.");
    if (!time[1] && hour >= 1 && hour <= 12) throw new ConditionsError("오전·오후를 알려주세요. 예: ‘오후 7시 고정’ 또는 ‘19시 고정’.");
    if (time[1]) hour = hour % 12 + (time[1] === "오후" ? 12 : 0);
    const w = state.base.hard.arrivalWindow;
    const dates = [...new Set([w.localDate, w.notAfter ? seoulInputTime(w.notAfter).slice(0, 10) : w.localDate])];
    const possible = dates.map(date => parseSeoulTime(`${date} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)!)
      .filter(at => at && (!w.notBefore || at >= w.notBefore) && (!w.notAfter || at <= w.notAfter));
    if (possible.length !== 1) throw new ConditionsError("허용한 날짜·시간 범위 안에서 시각을 고르거나 아래 범위를 수정해주세요.");
    return { type: "pin-time", at: possible[0] };
  }
  throw new ConditionsError("이 정정은 자동 적용하지 않았어요. ‘망원은 빼줘’, ‘시간 고정 해제’, ‘시간만 늦추자’처럼 입력하거나 아래 조건을 직접 바꿔주세요.");
}
