"use client";
import { formatSeoulTime } from "@/lib/data/time";
import type { SavedChoice } from "@/lib/domain/saved-planner";
import type { Origin } from "@/lib/domain/mobility";
import type { Place } from "@/lib/domain/types";
import { NavigationActions } from "./navigation-actions";

export function SavedPlanPanel({ saved, origin, places, pending, onCompare, onDismiss }: {
  saved: SavedChoice; origin: Origin | null; places: Place[]; pending: boolean; onCompare: () => void; onDismiss: () => void;
}) {
  const place = places.find(p => p.id === saved.choice.placeId)!;
  return <section className="panel selected-plan saved-execution" aria-labelledby="saved-plan-title">
    <h2 id="saved-plan-title">{saved.confirmedAt ? "저장된 확정 계획" : "저장된 선택 계획"}</h2>
    <h3>{place.name}</h3><p>{formatSeoulTime(saved.choice.arrivalAt)} 도착 · {saved.conditions.originalPlan.durationMinutes ? `${saved.conditions.originalPlan.durationMinutes}분 산책` : "체류시간 미정"}</p>
    {saved.confirmedAt && <p className="note">확정했던 시각 {formatSeoulTime(saved.confirmedAt)}</p>}
    <p className="notice">계획을 복원했어요. 이전 혼잡 예측과 이동시간은 현재 정보로 사용하지 않아요. 예정 시각이 지났다면 아래 조건을 수정해주세요.</p>
    {saved.confirmedAt && origin && <><p>저장한 출발지 {origin.name} → {place.accessPoint.name}. 위치가 달라졌다면 출발지를 다시 선택해주세요.</p>
      <NavigationActions origin={origin} place={place} /></>}
    <div className="action-row"><button disabled={pending} onClick={onCompare}>저장한 조건으로 새 자료 비교</button><button disabled={pending} onClick={onDismiss}>저장된 선택 해제</button></div>
    <p className="note">다시 비교하면 현재 자료로 후보를 계산하며, 이전 선택을 새 추천으로 자동 확정하지 않습니다.</p>
  </section>;
}
