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
  return <section className="panel" aria-labelledby="adjust-title">
    <h2 id="adjust-title">처음 조건 안에서 조정하기</h2>
    <p className="note">고정·제외는 AI 없이 다시 비교합니다. 추가 고정을 해제하면 처음 허용한 범위로 돌아갑니다.</p>
    {state.base.hard.pinnedPlaceId && <p>처음부터 고정한 장소: {names.get(state.base.hard.pinnedPlaceId)}. 변경하려면 위 입력의 허용 범위를 바꿔주세요.</p>}
    {state.base.hard.pinnedArrivalAt && <p>처음부터 고정한 시각: {formatSeoulTime(state.base.hard.pinnedArrivalAt)}. 변경하려면 위 입력의 도착 범위를 바꿔주세요.</p>}
    <div className="action-row">
      {state.placePin && <button onClick={() => onAdjust({ type: "unpin-place" })}>추가 장소 고정 해제 · {names.get(state.placePin)}</button>}
      {state.timePin && <button onClick={() => onAdjust({ type: "unpin-time" })}>추가 시간 고정 해제 · {formatSeoulTime(state.timePin)}</button>}
      {state.laterOnly && <button onClick={() => onAdjust({ type: "clear-later-only" })}>늦추기만 제한 해제</button>}
      <button onClick={() => onAdjust({ type: "reset" })}>처음 비교 조건으로 복원</button>
    </div>
    {state.excludedPlaceIds.length > 0 && <div><p>이번 비교에서 제외한 공원</p><div className="action-row">
      {state.excludedPlaceIds.map(id => <button key={id} onClick={() => onAdjust({ type: "restore", placeId: id })}>{names.get(id)} 다시 포함</button>)}
    </div></div>}
    {adjustmentConflicts(state, places).map(text => <p className="notice" role="alert" key={text}>{text}</p>)}
    <form onSubmit={correct}>
      <label>짧은 정정 명령<input value={text} maxLength={120} onChange={e => { setText(e.target.value); setError(""); }} placeholder="망원은 빼줘" /></label>
      <p className="note">예: ‘망원은 빼줘’, ‘반포로 고정’, ‘19시 고정’, ‘시간 고정 해제’, ‘그럼 시간만 늦추자’. 복합 조건은 위 입력에서 직접 수정해주세요.</p>
      <button disabled={!text.trim()} type="submit">정정 적용</button>
      {error && <p className="notice" role="alert">{error}</p>}
    </form>
    {pending && <p className="notice" role="status">새 조건을 반영하고 있어요. 아래 이전 결과에서는 계획을 선택할 수 없어요.</p>}
  </section>;
}
