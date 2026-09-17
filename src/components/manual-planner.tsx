"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatSeoulTime, seoulInputTime } from "@/lib/data/time";
import { draftFromConditions, manualConditions, type ManualDraft } from "@/lib/domain/manual";
import type { Candidate, Conditions, Recommendation } from "@/lib/domain/types";
import type { PopulationOverview } from "@/lib/server/population";
import type { AiPlan } from "@/lib/server/ai-planner";
import { adjustPlan, effectiveConditions, startReplanning, type Adjustment, type Replanning } from "@/lib/domain/replanning";
import { selectionUsable, updateSelection, type SelectedPlan, type SelectionCheck } from "@/lib/domain/selection";
import { AdjustmentControls } from "./adjustment-controls";
import { SelectedPlanPanel } from "./selected-plan";
import { TemporalEvidence } from "./temporal-evidence";

function changeText(candidate: Candidate, names: Map<string, string>, c: Conditions) {
  const parts: string[] = [];
  if (candidate.change.placeChanged === true) parts.push(`장소: ${names.get(c.originalPlan.placeId!)} → ${names.get(candidate.placeId)}`);
  else if (candidate.change.placeChanged === false) parts.push("장소 유지");
  const delta = candidate.change.arrivalDeltaMinutes;
  if (delta === 0) parts.push("도착 시각 유지");
  else if (delta !== null) parts.push(`도착 ${Math.abs(delta)}분 ${delta > 0 ? "늦춤" : "앞당김"}`);
  return parts.join(" · ");
}

export function ManualPlanner({ overview }: { overview: PopulationOverview }) {
  const places = overview.rows.map(row => row.place);
  const names = new Map(places.map(p => [p.id, p.name]));
  const times = [...new Set(overview.rows.flatMap(row => row.quality?.futureForecasts.map(p => p.at) ?? []))].sort();
  const firstArrival = times[0] ?? new Date(Math.ceil((Date.parse(overview.checkedAt) + 60_000) / 3_600_000) * 3_600_000).toISOString();
  const [draft, setDraft] = useState<ManualDraft>(() => ({ placeId: places[0].id, arrival: seoulInputTime(firstArrival), duration: "60",
    allowPlaceChange: false, allowedPlaceIds: places.map(p => p.id), timeMode: "fixed", windowStart: seoulInputTime(firstArrival),
    windowEnd: seoulInputTime(new Date(Date.parse(firstArrival) + 60 * 60_000).toISOString()),
    maximumCongestion: "보통", ranking: "minimum-change", allowDelayedForecasts: false }));
  const [response, setResponse] = useState<{ conditions: Conditions; result: Recommendation } | null>(null);
  const [aiPlan, setAiPlan] = useState<AiPlan | null>(null);
  const [text, setText] = useState("");
  const [aiPending, setAiPending] = useState(false);
  const [error, setError] = useState("");
  const [errorScope, setErrorScope] = useState<"ai" | "manual" | "adjust">("ai");
  const [pending, setPending] = useState(false);
  const [edited, setEdited] = useState(false);
  const [replanning, setReplanning] = useState<Replanning | null>(null);
  const replanningRef = useRef<Replanning | null>(null);
  const [choice, setChoice] = useState<{ placeId: string; arrivalAt: string } | null>(null);
  const [selected, setSelected] = useState<SelectedPlan | null>(null);
  const [selectionPending, setSelectionPending] = useState(false), [selectionError, setSelectionError] = useState("");
  const selectionSequence = useRef(0), selectionRequest = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0), active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); selectionRequest.current?.abort(); }, []);

  function nextRevision() { const value = ++sequence.current; setRevision(value); return value; }
  function setAdjustmentState(state: Replanning | null) { replanningRef.current = state; setReplanning(state); }
  function clearSelection() {
    selectionSequence.current++; selectionRequest.current?.abort(); setChoice(null); setSelected(null); setSelectionPending(false); setSelectionError("");
  }

  function update(patch: Partial<ManualDraft>) {
    nextRevision(); active.current?.abort(); setPending(false); setAiPending(false); setResponse(null); setAiPlan(null); setError(""); setEdited(true);
    setAdjustmentState(null); clearSelection();
    setDraft(current => ({ ...current, ...patch }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const version = nextRevision();
    active.current?.abort(); setPending(false); setError("");
    setResponse(null); setAiPlan(null); setErrorScope("manual"); clearSelection();
    try {
      const conditions = manualConditions(draft, version, places);
      setAdjustmentState(startReplanning(conditions));
      await compare(conditions, version);
    } catch (e) { setError(e instanceof Error ? e.message : "입력 조건을 확인해주세요."); }
  }
  async function compare(conditions: Conditions, version: number) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setError(""); setAiPending(false); setPending(true);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const http = await fetch("/api/recommendations", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conditions), signal: controller.signal, cache: "no-store" });
      const data = await http.json();
      if (version !== sequence.current) return;
      if (!http.ok) throw new Error(typeof data.error === "string" ? data.error : "비교를 완료하지 못했어요.");
      if (data.result?.conditionsRevision !== version) throw new Error("조건 버전을 확인하지 못했어요. 다시 비교해주세요.");
      setResponse(data); setEdited(false);
    } catch (e) {
      if (version === sequence.current) setError(controller.signal.aborted ? "응답이 늦어 비교를 멈췄어요. 입력을 유지했으니 다시 시도해주세요." :
        e instanceof Error && e.name !== "TypeError" ? e.message : "연결을 확인한 뒤 다시 시도해주세요. 입력은 유지됩니다.");
    } finally { clearTimeout(timeout); if (version === sequence.current) setPending(false); }
  }
  function adjust(action: Adjustment) {
    const state = replanningRef.current;
    if (!state) return;
    setErrorScope("adjust");
    try {
      const next = adjustPlan(state, action, places), version = nextRevision();
      setAdjustmentState(next); clearSelection();
      void compare(effectiveConditions(next, version, places), version);
    } catch (e) { setError(e instanceof Error ? e.message : "조건을 확인해주세요."); }
  }
  async function checkSelected(nextChoice: { placeId: string; arrivalAt: string }, previous: SelectedPlan | null = null) {
    if (!response || pending || response.conditions.revision !== sequence.current) return;
    const version = ++selectionSequence.current;
    selectionRequest.current?.abort(); const controller = new AbortController(); selectionRequest.current = controller;
    setChoice(nextChoice); setSelected(previous); setSelectionPending(true); setSelectionError("");
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const http = await fetch("/api/selection", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, cache: "no-store",
        body: JSON.stringify({ conditions: response.conditions, choice: nextChoice }) });
      const data = await http.json();
      if (version !== selectionSequence.current) return;
      if (!http.ok) throw new Error(data.error || "선택한 계획의 자료를 확인하지 못했어요.");
      const check = data as SelectionCheck;
      if (check.conditionsRevision !== response.conditions.revision || check.choice.placeId !== nextChoice.placeId || check.choice.arrivalAt !== nextChoice.arrivalAt) {
        throw new Error("선택한 계획과 응답이 다릅니다. 다시 확인해주세요.");
      }
      setSelected(updateSelection(previous, check));
    } catch {
      if (version === selectionSequence.current) { setSelected(previous ? { ...previous, confirmedAt: null } : null); setSelectionError("선택은 유지했지만 자료를 확인하지 못했어요. 다시 확인해주세요."); }
    } finally { clearTimeout(timeout); if (version === selectionSequence.current) setSelectionPending(false); }
  }
  function confirmSelected() {
    if (!selected || !response || selectionPending) return;
    if (!selectionUsable(selected.check, response.conditions.revision, Date.now())) {
      setSelectionError("자료를 다시 확인한 뒤 확정해주세요."); return;
    }
    setSelected({ ...selected, confirmedAt: new Date().toISOString() });
  }
  async function submitText(event: FormEvent) {
    event.preventDefault();
    const version = nextRevision();
    clearSelection(); setAdjustmentState(null);
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setError(""); setErrorScope("ai"); setResponse(null); setAiPlan(null); setPending(true); setAiPending(true);
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const session = await fetch("/api/plan", { cache: "no-store", signal: controller.signal });
      if (!session.ok) throw new Error("AI 연결을 준비하지 못했어요. 아래에서 조건을 직접 입력할 수 있어요.");
      const http = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        cache: "no-store", body: JSON.stringify({ text, revision: version, requestId: crypto.randomUUID(), allowDelayedForecasts: draft.allowDelayedForecasts }) });
      const data = await http.json();
      if (version !== sequence.current) return;
      if (!http.ok) throw new Error(typeof data.error === "string" ? data.error : "조건을 해석하지 못했어요.");
      if (data.result?.conditionsRevision !== version) throw new Error("조건 버전이 바뀌었어요. 다시 비교해주세요.");
      setDraft(draftFromConditions(data.conditions)); setAdjustmentState(startReplanning(data.conditions)); setResponse(data); setAiPlan(data); setEdited(false);
    } catch (e) {
      if (version === sequence.current) setError(controller.signal.aborted ? "응답이 늦어 멈췄어요. 입력은 유지되며 아래 조건으로 비교할 수 있어요." :
        e instanceof Error && e.name !== "TypeError" ? e.message : "연결을 확인해주세요. 입력은 유지했어요.");
    } finally { clearTimeout(timeout); if (version === sequence.current) { setPending(false); setAiPending(false); } }
  }
  const result = response?.result, applied = response?.conditions;
  const resultCurrent = applied?.revision === revision && !pending;
  return <>
    <section className="panel" aria-labelledby="natural-title">
      <h2 id="natural-title">어떤 외출을 생각하고 있나요?</h2>
      <form onSubmit={submitText}>
        <label htmlFor="outing-text">원하는 계획<textarea id="outing-text" required maxLength={1200} rows={4} value={text}
          placeholder="오늘 저녁 7~9시 사이에 한 시간 산책하고 싶어. 목적지는 아직 못 정했고 보통보다 붐비면 싫어."
          onChange={e => { setText(e.target.value); update({}); }} /></label>
        <p className="note">현재 한강공원 5곳의 산책을 지원해요. 이동시간·소음은 아직 평가하지 않습니다. 입력한 문장은 조건 해석을 위해 OpenAI로 전송됩니다.</p>
        <button type="submit" disabled={pending || !text.trim()}>{aiPending ? "계획을 해석하고 예측 비교 중…" : "말로 계획 비교하기"}</button>
        <p className="note" role="status">{aiPending ? "조건을 해석한 뒤 실제 예측으로 계산하고 있어요. 잠시만 기다려주세요." : "해석한 조건은 아래에서 직접 수정할 수 있어요."}</p>
      </form>
      {error && errorScope === "ai" && <p className="notice" role="alert">{error}</p>}
      {aiPlan && <div className="notice"><h3>이렇게 해석했어요</h3>
        <p>{draft.placeId ? names.get(draft.placeId) : "목적지 미정"} · {draft.duration ? `${draft.duration}분 산책` : "체류시간 미정 · 도착 기준 비교"} · {draft.maximumCongestion}까지 선호</p>
        {aiPlan.assumptions.map(value => <p key={value}>{value}</p>)}
        {aiPlan.unsupported.map(value => <p key={value}>평가하지 못한 조건: {value}</p>)}
        <p>아래 조건과 결과를 확인해주세요. 직접 수정한 조건은 AI 호출 없이 다시 비교합니다.</p>
      </div>}
    </section>
    <section className="panel" aria-labelledby="planner-title">
      <h2 id="planner-title">내 조건으로 비교하기</h2>
      <p>원래 계획이 있으면 입력하고, 바꿔도 되는 범위를 정해주세요. 모든 시각은 한국 시간입니다.</p>
      <div className="action-row" role="group" aria-label="목적지 결정 여부">
        <button aria-pressed={!!draft.placeId} onClick={() => update({ placeId: draft.placeId || places[0].id })}>목적지를 정했어요</button>
        <button aria-pressed={!draft.placeId} onClick={() => update({ placeId: "", arrival: "", allowPlaceChange: true, timeMode: "custom" })}>아직 못 정했어요</button>
      </div>
      {!draft.placeId && <p className="note">갈 수 있는 공원과 방문 시간대를 골라주세요. 도착시각을 계산할 필요는 없어요. 아래 시간 범위는 수정 가능한 제안이며 이동시간은 아직 반영하지 않습니다.</p>}
      {replanning && <p className="note">아래 입력은 처음 비교 조건입니다. 입력을 수정하면 추가 고정·제외와 확정 상태가 초기화되고 새 조건으로 비교합니다.</p>}
      <form onSubmit={submit}>
        <fieldset><legend>{draft.placeId ? "원래 계획" : "처음 정할 조건"}</legend>
          <div className="form-grid">
            <label>원래 장소<select value={draft.placeId} onChange={e => update({ placeId: e.target.value })}>
              <option value="">아직 못 정했어요</option>
              {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <label>원래 도착 시각<input type="datetime-local" step="60" value={draft.arrival} onChange={e => update({ arrival: e.target.value })} /></label>
            <label>머무는 시간 (분, 선택)<input type="number" min="15" max="240" step="1" value={draft.duration} onChange={e => update({ duration: e.target.value })} /></label>
          </div>
          <p className="note">머무는 시간을 입력하면 종료까지의 예측 표본을 함께 비교해요. 비워두면 도착시각만 비교합니다. 도착시각이 미정이면 허용 범위를 직접 정해주세요.</p>
        </fieldset>
        <fieldset><legend>바꿔도 되는 범위</legend>
          <label className="checkbox"><input type="checkbox" checked={draft.allowPlaceChange} onChange={e => update({ allowPlaceChange: e.target.checked })} />다른 한강공원으로 변경해도 괜찮아요</label>
          {draft.allowPlaceChange && <div className="choice-list" role="group" aria-label="비교를 허용한 공원">
            {places.map(p => <label className="checkbox" key={p.id}><input type="checkbox" checked={draft.allowedPlaceIds.includes(p.id) && !draft.excludedPlaceIds?.includes(p.id)}
              onChange={e => update({ allowedPlaceIds: e.target.checked ? [...new Set([...draft.allowedPlaceIds, p.id])] : draft.allowedPlaceIds.filter(id => id !== p.id),
                excludedPlaceIds: e.target.checked ? draft.excludedPlaceIds?.filter(id => id !== p.id) : draft.excludedPlaceIds })} />{p.name}</label>)}
            <p className="note">갈 수 있는 공원만 선택해주세요. 실제 이동시간은 계산하지 않아요.</p>
          </div>}
          <label>도착 시각 변경<select value={draft.timeMode} onChange={e => update({ timeMode: e.target.value as ManualDraft["timeMode"] })}>
            <option value="fixed">원래 도착 시각 그대로</option><option value="later-60">최대 1시간 늦어도 괜찮아요</option>
            <option value="later-120">최대 2시간 늦어도 괜찮아요</option><option value="custom">허용 범위를 직접 정할게요</option>
          </select></label>
          {draft.timeMode === "custom" && <div className="form-grid">
            <label>가장 이른 도착<input required type="datetime-local" step="60" value={draft.windowStart} onChange={e => update({ windowStart: e.target.value })} /></label>
            <label>가장 늦은 도착<input required type="datetime-local" step="60" value={draft.windowEnd} onChange={e => update({ windowEnd: e.target.value })} /></label>
          </div>}
          <p className="note">‘늦어도 괜찮아요’는 도착을 앞당기지 않습니다. 시각 사이에서는 60분 이내 간격의 전후 예측을 참고하고, 인구만 숨맵 추정으로 보간해요.</p>
        </fieldset>
        <fieldset><legend>선호하는 비교</legend><div className="form-grid">
          <label>혼잡 선호<select value={draft.maximumCongestion} onChange={e => update({ maximumCongestion: e.target.value as ManualDraft["maximumCongestion"] })}>
            <option value="여유">여유만 선호</option><option value="보통">보통까지 괜찮음</option><option value="약간 붐빔">약간 붐벼도 괜찮음</option>
            <option value="붐빔">혼잡 단계 제한 없음</option>
          </select></label>
          <label>비교 기준<select value={draft.ranking} onChange={e => update({ ranking: e.target.value as ManualDraft["ranking"] })}>
            <option value="minimum-change">계획 변경 최소</option><option value="less-crowded">덜 붐빔 우선</option>
          </select></label>
        </div><p className="note">체류 구간의 평가 표본이 모두 혼잡 선호 이내인 안을 우선해요. ‘변경 최소’는 그 안에서 변경 항목 수 → 장소 유지 → 시간 차이 순으로 비교합니다. 필수 조건을 자동으로 풀지 않습니다.</p></fieldset>
        <fieldset><legend>자료 기준 확인</legend>
          <p className="note">30분이 넘은 관측은 현재 상태로 취급하지 않아요. 30~60분 전 원자료에 포함된 미래 예측은 아래 항목을 선택한 경우에만 참고 비교합니다. 60분 초과·대체 자료·수신 지연 자료는 제외해요.</p>
          <label className="checkbox"><input type="checkbox" checked={draft.allowDelayedForecasts} onChange={e => update({ allowDelayedForecasts: e.target.checked })} />지연 예측 참고 비교를 허용해요</label>
        </fieldset>
        <button type="submit" disabled={pending}>{pending ? "조건에 맞는 예측 비교 중…" : "이 조건으로 비교"}</button>
        {error && errorScope === "manual" && <p className="notice" role="alert">{error}</p>}
        <p className="note" role="status" aria-live="polite">{pending ? "원래 계획과 허용 조건을 유지하며 자료를 확인하고 있어요." : edited ? "조건을 바꿨어요. 비교 버튼을 눌러 새 결과를 확인해주세요." : "이 단계는 AI 호출 없이 제공된 예측과 정해진 규칙으로 계산합니다."}</p>
      </form>
    </section>
    {replanning && <><AdjustmentControls state={replanning} places={places} pending={pending} onAdjust={adjust} />
      {error && errorScope === "adjust" && <p className="notice" role="alert">{error}</p>}
      {!pending && !resultCurrent && <button onClick={() => {
        const version = nextRevision(); setErrorScope("adjust"); clearSelection(); void compare(effectiveConditions(replanning, version, places), version);
      }}>현재 조정 조건으로 다시 비교</button>}
    </>}
    {choice && applied && <SelectedPlanPanel key={`${choice.placeId}:${choice.arrivalAt}:${selected?.check.checkedAt ?? "pending"}`} plan={selected} choice={choice} conditions={applied}
      places={places} pending={selectionPending} error={selectionError} onConfirm={confirmSelected} onRecheck={() => void checkSelected(choice, selected)} onAdjust={clearSelection} />}
    {result && applied && <section className="results" aria-labelledby="result-title" aria-live="polite" aria-busy={pending}>
      <div className="panel"><h2 id="result-title">{result.status === "ready" ? "조건에 맞는 비교 결과" : result.status === "preference-uncertain" ? "혼잡 선호 충족이 불확실한 결과" : result.status === "preference-unmet" ? "혼잡 선호에 못 미치는 결과" : "비교를 완료하지 못했어요"}</h2>
        {!resultCurrent && <p className="notice">이전 조건의 결과입니다. 새 비교가 완료되어야 선택할 수 있어요.</p>}
        <p>{result.message}</p>
        <p>{applied.originalPlan.placeId ? "원래 계획" : "처음 정한 조건"}: {applied.originalPlan.placeId ? names.get(applied.originalPlan.placeId) : "장소 미정"} · {applied.originalPlan.preferredArrivalAt ? formatSeoulTime(applied.originalPlan.preferredArrivalAt) : "시각 미정"} · {applied.originalPlan.durationMinutes ? `${applied.originalPlan.durationMinutes}분 머물기` : "체류시간 미정"}</p>
        <p>반드시 지킬 범위: {applied.hard.pinnedPlaceId ? `${names.get(applied.hard.pinnedPlaceId)}만` : applied.hard.allowedPlaceIds?.map(id => names.get(id)).join(", ") || "허용 장소 없음"}<br />
          도착 {formatSeoulTime(applied.hard.arrivalWindow.notBefore!)} ~ {formatSeoulTime(applied.hard.arrivalWindow.notAfter!)}</p>
        {applied.hard.pinnedArrivalAt && <p>고정한 도착시각: {formatSeoulTime(applied.hard.pinnedArrivalAt)}</p>}
        {!!applied.hard.excludedPlaceIds.length && <p>제외: {applied.hard.excludedPlaceIds.map(id => names.get(id)).join(", ")}</p>}
        <p className="note">계산 시각 {formatSeoulTime(result.checkedAt)} · 필수 조건과 데이터 검사를 통과한 후보 {result.eligibleCount}개</p>
        {aiPlan?.conditions.revision === applied.revision && aiPlan.explanation.facts.length ? <div><p className="eyebrow">{aiPlan.explanation.mode === "ai-selected-evidence" ? "계산된 근거에서 AI가 정리한 설명" : "계산 근거 설명"}</p>
          {aiPlan.explanation.facts.map(fact => <p key={fact.id}>{fact.text}</p>)}</div> : result.explanation && <p>{result.explanation.reason}</p>}
        {aiPlan?.conditions.revision === applied.revision && aiPlan.notice && <p className="notice">{aiPlan.notice}</p>}
        {result.limitations.map(text => <p className="note" key={text}>{text}</p>)}
      </div>
      <div className="result-options">{result.options.map((option, index) => {
        const c = option.candidate;
        const unchanged = c?.change.placeChanged === false && c.change.arrivalDeltaMinutes === 0;
        const title = option.role === "original" ? "원래 계획" : option.role === "alternative" ? "다른 선택" : unchanged ? "추천 · 원래 계획 유지" : "추천";
        return <article className="panel result-card" key={c?.id ?? `original-${index}`} aria-label={`${c ? names.get(c.placeId) : "원래 계획"} ${c ? formatSeoulTime(c.arrivalAt) : ""} ${title}`}>
          <p className="eyebrow">{title}{!option.eligible ? " · 비교 제외" : c?.dataConfidence === "delayed" ? " · 지연 예측 참고" : ""}</p>
          <h3>{c ? names.get(c.placeId) : names.get(applied.originalPlan.placeId!)}</h3>
          <p>{c?.arrivalAt || applied.originalPlan.preferredArrivalAt ? `${formatSeoulTime(c?.arrivalAt ?? applied.originalPlan.preferredArrivalAt!)} 도착` : "도착시각 미정"} · {applied.originalPlan.durationMinutes ? `${applied.originalPlan.durationMinutes}분 머물기` : "도착 기준 비교"}</p>
          {c ? <><TemporalEvidence candidate={c} />
            <p>{changeText(c, names, applied)}</p>
            <p className="note">원자료 기준 {formatSeoulTime(c.sourceUpdatedAt)} · 수신 {formatSeoulTime(c.fetchedAt)}<br />계산 시점 기준 {Math.max(0, Math.floor((Date.parse(result.checkedAt) - Date.parse(c.sourceUpdatedAt)) / 60_000))}분 전 자료</p>
          </> : <p>해당 시각 예측을 확인할 수 없어요.</p>}
          {option.reasons.map(text => <p className="notice" key={text}>{text}</p>)}
          {c && option.eligible && <div className="action-row">
            {replanning && !replanning.base.hard.pinnedPlaceId && <button disabled={!resultCurrent} onClick={() => adjust({ type: "pin-place", placeId: c.placeId })}>이 장소 고정</button>}
            {replanning && !replanning.base.hard.pinnedArrivalAt && <button disabled={!resultCurrent} onClick={() => adjust({ type: "pin-time", at: c.arrivalAt })}>이 시각 고정</button>}
            <button disabled={!resultCurrent} onClick={() => adjust({ type: "exclude", placeId: c.placeId })}>이번에는 이곳 제외</button>
            <button disabled={!resultCurrent || selectionPending} onClick={() => void checkSelected({ placeId: c.placeId, arrivalAt: c.arrivalAt })}>이 계획 선택</button>
          </div>}
        </article>;
      })}</div>
      {result.excludedPlaces.length > 0 && <details className="panel"><summary>장소별 제외 이유 {result.excludedPlaces.length}곳</summary>
        {result.excludedPlaces.map(item => <div key={item.placeId}><h3>{names.get(item.placeId)}</h3><ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>)}
      </details>}
      {result.status === "forecast-unavailable" && result.availableForecastTimes.length > 0 && <div className="panel"><h3>현재 제공된 예측 시각</h3><p>허용한 장소 중 하나 이상에서 제공한 시각입니다. 모든 공원에 같은 시각의 예측이 있다는 뜻은 아니에요.</p>
        <p>{result.availableForecastTimes.map(at => formatSeoulTime(at)).join(" / ")}</p><p>위 입력에서 시각이나 허용 범위를 직접 수정해주세요.</p></div>}
    </section>}
  </>;
}
