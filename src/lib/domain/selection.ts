import { ConditionsError } from "./conditions.ts";
import { formatSeoulTime } from "../data/time.ts";
import { DATA_POLICY } from "../data/quality.ts";
import type { Candidate, Conditions, Place } from "./types.ts";
import type { checkChoice } from "./recommend.ts";

export type SelectionCheck = ReturnType<typeof checkChoice>;
export interface SelectedPlan { check: SelectionCheck; confirmedAt: string | null; notice: string | null }
export const SELECTION_MAX_AGE_MS = 5 * 60_000;
export function parseChoice(value: unknown, places: Place[]): { placeId: string; arrivalAt: string } {
  if (!value || typeof value !== "object" || !("placeId" in value) || !("arrivalAt" in value)) throw new ConditionsError("선택할 장소와 시각이 필요해요.");
  const { placeId, arrivalAt } = value;
  if (typeof placeId !== "string" || !places.some(p => p.id === placeId) || typeof arrivalAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(arrivalAt) || !Number.isFinite(Date.parse(arrivalAt)) || new Date(arrivalAt).toISOString() !== arrivalAt) {
    throw new ConditionsError("선택한 장소와 시각을 확인해주세요.");
  }
  return { placeId, arrivalAt };
}
export function selectionUsable(check: SelectionCheck, revision: number, nowMs: number): boolean {
  const candidate = check.candidate;
  if (!candidate || nowMs - Date.parse(candidate.sourceUpdatedAt) > (candidate.dataConfidence === "fresh" ? DATA_POLICY.freshMinutes : DATA_POLICY.displayMaxMinutes) * 60_000 ||
    nowMs - Date.parse(candidate.fetchedAt) > DATA_POLICY.cacheGraceMinutes * 60_000) return false;
  return check.eligible && check.candidate !== null && check.conditionsRevision === revision &&
    Date.parse(check.choice.arrivalAt) > nowMs && nowMs >= Date.parse(check.checkedAt) - 60_000 && nowMs - Date.parse(check.checkedAt) <= SELECTION_MAX_AGE_MS;
}
const fingerprint = (c: Candidate | null) => c ? JSON.stringify({ arrival: c.arrival, visit: c.visit, confidence: c.dataConfidence,
  evidence: c.visit.evidence.map(p => ({ at: p.at, congestion: p.congestion, populationRange: p.populationRange })) },
  (key, value) => key === "id" || key === "evidenceIds" ? undefined : value) : null;
export function updateSelection(previous: SelectedPlan | null, check: SelectionCheck): SelectedPlan {
  const sameChoice = previous?.check.choice.placeId === check.choice.placeId && previous?.check.choice.arrivalAt === check.choice.arrivalAt;
  const unchanged = sameChoice && fingerprint(previous!.check.candidate) === fingerprint(check.candidate) && previous!.check.conditionsRevision === check.conditionsRevision;
  return { check, confirmedAt: check.eligible && unchanged ? previous!.confirmedAt : null,
    notice: !check.eligible ? "선택은 유지했지만 지금 자료로는 이 계획을 확정할 수 없어요." : !sameChoice ? null : unchanged
      ? "선택한 장소와 시각의 전망을 다시 확인했어요. 평가 내용은 같아요." : "예측 내용이나 자료 최신성 상태가 달라졌어요. 선택은 유지했으니 새 근거를 확인한 뒤 다시 확정해주세요." };
}
export function locationLink(place: Place): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.displayPoint.latitude},${place.displayPoint.longitude}`;
}
export function planSummary(plan: SelectedPlan, conditions: Conditions, places: Place[]): string {
  const c = plan.check.candidate;
  if (!c || !plan.confirmedAt) throw new ConditionsError("계획을 먼저 확정해주세요.");
  const place = places.find(p => p.id === c.placeId)!;
  const lines = ["숨맵에서 정한 산책 계획", place.name, `${formatSeoulTime(c.arrivalAt)} 도착`,
    conditions.originalPlan.durationMinutes === null ? "체류시간 미정 · 도착 기준 비교" : `${conditions.originalPlan.durationMinutes}분 산책 · ${formatSeoulTime(c.visit.endAt)}까지`,
    `전후·체류 참고 표본: ${c.visit.evidence.map(p => `${formatSeoulTime(p.at)} ${p.congestion}`).join(" → ")}`,
    c.visit.preference === "supported" ? "평가 표본은 설정한 혼잡 선호 이내" : "혼잡 선호 충족이 불확실하거나 선호를 넘는 표본 포함",
    `자료 확인 ${formatSeoulTime(plan.check.checkedAt)} · 원자료 ${formatSeoulTime(c.sourceUpdatedAt)}`];
  if (c.dataConfidence === "delayed") lines.push("30~60분 전 원자료의 미래 예측을 참고한 계획");
  lines.push("실제 혼잡은 달라질 수 있어요. 이동시간 미반영.", `공원 대표 위치: ${locationLink(place)}`);
  return lines.join("\n");
}
