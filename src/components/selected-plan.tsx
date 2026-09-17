"use client";
import { useEffect, useRef, useState } from "react";
import { formatSeoulTime } from "@/lib/data/time";
import { locationLink, planSummary, selectionUsable, type SelectedPlan } from "@/lib/domain/selection";
import type { Conditions, Place } from "@/lib/domain/types";
import { TemporalEvidence } from "./temporal-evidence";

export function SelectedPlanPanel({ plan, choice, conditions, places, pending, error, onConfirm, onRecheck, onAdjust }: {
  plan: SelectedPlan | null; choice: { placeId: string; arrivalAt: string }; conditions: Conditions; places: Place[];
  pending: boolean; error: string; onConfirm: () => void; onRecheck: () => void; onAdjust: () => void;
}) {
  const [now, setNow] = useState(() => Date.now()), [accepted, setAccepted] = useState(false);
  const [copyMessage, setCopyMessage] = useState(""), [copyFallback, setCopyFallback] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); const interval = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(interval); }, []);
  const place = places.find(p => p.id === choice.placeId)!;
  const usable = !!plan && selectionUsable(plan.check, conditions.revision, now) && !pending && !error;
  const candidate = plan?.check.candidate;
  async function copy() {
    if (!plan || !selectionUsable(plan.check, conditions.revision, Date.now())) { setCopyMessage("자료를 다시 확인한 뒤 복사해주세요."); return; }
    const text = planSummary(plan, conditions, places);
    try { await navigator.clipboard.writeText(text); setCopyMessage("계획 문구를 복사했어요."); setCopyFallback(""); }
    catch { setCopyFallback(text); setCopyMessage("자동 복사가 막혀 있어요. 아래 문구를 선택해 복사해주세요."); }
  }
  return <section className="panel selected-plan" aria-labelledby="selected-title" aria-busy={pending}>
    <h2 ref={heading} tabIndex={-1} id="selected-title">{plan?.confirmedAt ? "확정한 산책 계획" : "선택한 계획 확인"}</h2>
    <h3>{place.name}</h3><p>{formatSeoulTime(choice.arrivalAt)} 도착 · {conditions.originalPlan.durationMinutes ? `${conditions.originalPlan.durationMinutes}분 산책` : "체류시간 미정"}</p>
    {pending && <p role="status">선택한 장소와 시각의 자료를 확인하고 있어요. 아래 근거는 확인이 끝나기 전 자료입니다.</p>}
    {error && <p className="notice" role="alert">{error}</p>}
    {plan?.notice && <p className="notice">{plan.notice}</p>}
    {plan && !usable && !pending && !error && plan.check.eligible && <p className="notice">확인 후 시간이 지났거나 도착시각이 지났어요. 자료를 다시 확인해주세요.</p>}
    {plan?.check.reasons.map(reason => <p className="notice" key={reason}>{reason}</p>)}
    {candidate && <><TemporalEvidence candidate={candidate} />
      <p className="note">원자료 {formatSeoulTime(candidate.sourceUpdatedAt)} · 수신 {formatSeoulTime(candidate.fetchedAt)} · 확인 {formatSeoulTime(plan!.check.checkedAt)}</p>
      {candidate.dataConfidence === "delayed" && <p className="notice">허용하신 30~60분 전 원자료의 미래 예측을 참고했어요.</p>}
      <p>처음 계획 대비: {candidate.change.placeChanged === null ? "처음 정한 장소" : candidate.change.placeChanged ? "장소 변경" : "장소 유지"} · {candidate.change.arrivalDeltaMinutes === null ? "처음 정한 도착시각" : candidate.change.arrivalDeltaMinutes === 0 ? "도착시각 유지" : `${Math.abs(candidate.change.arrivalDeltaMinutes)}분 ${candidate.change.arrivalDeltaMinutes > 0 ? "늦춤" : "앞당김"}`}</p>
    </>}
    {!plan?.confirmedAt && usable && candidate && <div>
      {!candidate.meetsPreference && <label className="checkbox"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />혼잡 선호 충족이 불확실하거나 선호를 넘는 예측임을 확인했어요</label>}
      <button disabled={!candidate.meetsPreference && !accepted} onClick={onConfirm}>이 계획 확정</button>
    </div>}
    {plan?.confirmedAt && <><p>계획을 확정했어요. 이동시간은 아직 반영하지 않았습니다.</p><div className="action-row">
      <button disabled={!usable} onClick={copy}>계획 문구 복사</button>
      <a href={locationLink(place)} target="_blank" rel="noreferrer">카카오맵에서 공원 위치 보기</a>
    </div><p className="note">공원 대표 위치를 표시합니다. 출입구를 기준으로 한 대중교통 길찾기는 다음 이동 단계에서 연결합니다.</p></>}
    {copyMessage && <p role="status">{copyMessage}</p>}
    {copyFallback && <label>복사할 계획 문구<textarea readOnly rows={9} value={copyFallback} onFocus={e => e.target.select()} /></label>}
    <div className="action-row"><button disabled={pending} onClick={onRecheck}>선택한 계획의 자료 다시 확인</button><button onClick={onAdjust}>다시 조정하기</button></div>
    <p className="note">자료를 다시 확인해도 선택한 장소·시각은 자동으로 바뀌지 않아요. 화면의 자료는 공용 캐시를 사용하며 최대 5분 간격으로 갱신합니다. 이 선택은 현재 탭에서 유지되고 새로고침하면 초기화됩니다.</p>
  </section>;
}
