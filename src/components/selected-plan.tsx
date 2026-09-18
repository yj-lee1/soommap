"use client";
import { useEffect, useRef, useState } from "react";
import { formatSeoulTime } from "@/lib/data/time";
import { locationLink, planSummary, selectionUsable, type SelectedPlan } from "@/lib/domain/selection";
import type { Conditions, Place } from "@/lib/domain/types";
import { NavigationActions } from "./navigation-actions";
import type { Origin } from "@/lib/domain/mobility";
import { TemporalEvidence } from "./temporal-evidence";

export function SelectedPlanPanel({ plan, choice, conditions, places, origin, pending, error, onConfirm, onRecheck, onAdjust }: {
  plan: SelectedPlan | null; choice: { placeId: string; arrivalAt: string }; conditions: Conditions; places: Place[];
  origin: Origin | null; pending: boolean; error: string; onConfirm: () => void; onRecheck: () => void; onAdjust: () => void;
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
    {plan && !usable && !pending && !error && plan.check.eligible && <p className="notice">자료의 최신성 기준, 확인 유효시간 또는 도착시각을 지났어요. 자료를 다시 확인해주세요.</p>}
    {plan?.check.reasons.map(reason => <p className="notice" key={reason}>{reason}</p>)}
    {candidate && <><details><summary>선택한 계획의 혼잡 근거</summary><TemporalEvidence candidate={candidate} maximum={conditions.soft.maximumPreferredCongestion} /></details>
      <p className="note">원자료 {formatSeoulTime(candidate.sourceUpdatedAt)} · 수신 {formatSeoulTime(candidate.fetchedAt)} · 확인 {formatSeoulTime(plan!.check.checkedAt)}</p>
      {candidate.dataConfidence === "delayed" && <p className="notice">허용하신 30~60분 전 원자료의 미래 예측을 참고했어요.</p>}
      <p>처음 계획 대비: {candidate.change.placeChanged === null ? "처음 정한 장소" : candidate.change.placeChanged ? "장소 변경" : "장소 유지"} · {candidate.change.arrivalDeltaMinutes === null ? "처음 정한 도착시각" : candidate.change.arrivalDeltaMinutes === 0 ? "도착시각 유지" : `${Math.abs(candidate.change.arrivalDeltaMinutes)}분 ${candidate.change.arrivalDeltaMinutes > 0 ? "늦춤" : "앞당김"}`}</p>
    </>}
    {!plan?.confirmedAt && usable && candidate && <div>
      {!candidate.meetsPreference && <label className="checkbox"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />혼잡 선호 충족이 불확실하거나 선호를 넘는 예측임을 확인했어요</label>}
      <button className="primary" disabled={!candidate.meetsPreference && !accepted} onClick={onConfirm}>이 계획 확정</button>
    </div>}
    {plan?.confirmedAt && <><h4 className="execution-heading">이 계획으로 나가볼까요?</h4><p>계획을 확정했어요. {candidate?.travel ? `대중교통 약 ${Math.ceil(candidate.travel.totalSeconds / 60)}분이 반영됐어요.` : "이동시간은 반영하지 않은 계획입니다."}</p><div className="action-row">
      <button disabled={!usable} onClick={copy}>계획 문구 복사</button>
      {!origin && <a href={locationLink(place)} target="_blank" rel="noreferrer">카카오맵에서 공원 위치 보기</a>}
    </div>{origin ? <NavigationActions origin={origin} place={place} /> : <p className="note">위에서 출발지를 선택한 뒤 비교하면 확정 후 출발·도착지가 입력된 길찾기를 이용할 수 있어요.</p>}</>}
    {copyMessage && <p role="status">{copyMessage}</p>}
    {copyFallback && <label>복사할 계획 문구<textarea readOnly rows={9} value={copyFallback} onFocus={e => e.target.select()} /></label>}
    <div className="action-row"><button disabled={pending} onClick={onRecheck}>선택한 계획의 자료 다시 확인</button><button onClick={onAdjust}>다시 조정하기</button></div>
    <p className="note">자료를 다시 확인해도 선택한 장소·시각은 자동으로 바뀌지 않아요. 화면의 자료는 공용 캐시를 사용하며 최대 5분 간격으로 갱신합니다. 선택·확정 계획은 이 브라우저에 저장되며, 다시 열 때 이전 혼잡·이동시간은 최신 정보로 복원하지 않습니다.</p>
  </section>;
}
