"use client";
import { useState, type FormEvent } from "react";
import { formatSeoulTime } from "@/lib/data/time";
import { adjustmentConflicts, correctionAction, type Adjustment, type Replanning } from "@/lib/domain/replanning";
import type { Place } from "@/lib/domain/types";

export function AdjustmentControls({ state, places, pending, onAdjust }: {
  state: Replanning; places: Place[]; pending: boolean; onAdjust: (action: Adjustment) => void;
}) {
  const [text, setText] = useState(""), [error, setError] = useState("");
  const names = new Map(places.map(p => [p.id, p.name]));
  function correct(event: FormEvent) {
    event.preventDefault(); setError("");
    try { onAdjust(correctionAction(text, state, places)); }
    catch (e) { setError(e instanceof Error ? e.message : "정정 내용을 확인해주세요."); }
  }
  return <section className="adjustment-panel" aria-labelledby="adjust-title">
    <div className="pin-heading"><span aria-hidden="true" className="pin-icon">⌖</span><h2 id="adjust-title">지키고 싶은 조건</h2><span className="pin-status">{pending ? "다시 비교 중" : "고정하면 유지해요"}</span></div>
    {state.base.hard.pinnedPlaceId && <p className="pin-label anchored-pin">처음부터 고정한 장소: {names.get(state.base.hard.pinnedPlaceId)}. 변경하려면 위 입력의 허용 범위를 바꿔주세요.</p>}
    {state.base.hard.pinnedArrivalAt && <p className="pin-label anchored-pin">처음부터 고정한 시각: {formatSeoulTime(state.base.hard.pinnedArrivalAt)}. 변경하려면 위 입력의 도착 범위를 바꿔주세요.</p>}
    <div className="action-row pin-controls">
      {state.placePin && <button className="anchored-pin" onClick={() => onAdjust({ type: "unpin-place" })}>⌖ {names.get(state.placePin)} <span>고정 해제 ×</span></button>}
      {state.timePin && <button className="anchored-pin" onClick={() => onAdjust({ type: "unpin-time" })}>⌖ {formatSeoulTime(state.timePin)} <span>고정 해제 ×</span></button>}
      {state.laterOnly && <button onClick={() => onAdjust({ type: "clear-later-only" })}>늦추기만 제한 해제</button>}
      <button className="text-button" onClick={() => onAdjust({ type: "reset" })}>처음 조건으로</button>
    </div>
    {state.excludedPlaceIds.length > 0 && <div><p>이번 비교에서 제외한 공원</p><div className="action-row">
      {state.excludedPlaceIds.map(id => <button key={id} onClick={() => onAdjust({ type: "restore", placeId: id })}>{names.get(id)} 다시 포함</button>)}
    </div></div>}
    {adjustmentConflicts(state, places).map(text => <p className="notice" role="alert" key={text}>{text}</p>)}
    <details><summary>조건 수정·고정 안내</summary><p className="note">고정한 조건은 재비교해도 유지해요. 고정을 해제하면 처음 허용한 범위로 돌아갑니다.</p><form onSubmit={correct}>
      <label>짧은 정정 명령<input value={text} maxLength={120} onChange={e => { setText(e.target.value); setError(""); }} placeholder="망원은 빼줘" /></label>
      <p className="note">예: ‘망원은 빼줘’, ‘반포로 고정’, ‘19시 고정’, ‘시간 고정 해제’, ‘그럼 시간만 늦추자’. 복합 조건은 위 입력에서 직접 수정해주세요.</p>
      <button disabled={!text.trim()} type="submit">정정 적용</button>
      {error && <p className="notice" role="alert">{error}</p>}
    </form></details>
    {pending && <p className="notice" role="status">새 조건을 반영하고 있어요. 아래 이전 결과에서는 계획을 선택할 수 없어요.</p>}
  </section>;
}
