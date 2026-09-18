"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

import { OriginControls } from "./origin-controls";
import type { Origin, TransitBundle } from "@/lib/domain/mobility";
import { PLANNER_STORAGE_KEY, parseSavedPlanner, readSavedPlanner, type SavedChoice } from "@/lib/domain/saved-planner";
import { SavedPlanPanel } from "./saved-plan";
import { PlaceExplorer } from "./place-explorer";

function changeText(candidate: Candidate, names: Map<string, string>, c: Conditions) {
  const parts: string[] = [];
  if (candidate.change.placeChanged === true) parts.push(`장소: ${names.get(c.originalPlan.placeId!)} → ${names.get(candidate.placeId)}`);
  else if (candidate.change.placeChanged === false) parts.push("장소 유지");
  const delta = candidate.change.arrivalDeltaMinutes;
  if (delta === 0) parts.push("도착 시각 유지");
  else if (delta !== null) parts.push(`도착 ${Math.abs(delta)}분 ${delta > 0 ? "늦춤" : "앞당김"}`);
  return parts.join(" · ");
}

export function ManualPlanner({ overview, mobilityReady }: { overview: PopulationOverview; mobilityReady: boolean }) {
  const places = useMemo(() => overview.rows.map(row => row.place), [overview]);
  const names = new Map(places.map(p => [p.id, p.name]));
  const times = [...new Set(overview.rows.flatMap(row => row.quality?.futureForecasts.map(p => p.at) ?? []))].sort();
  const firstArrival = times[0] ?? new Date(Math.ceil((Date.parse(overview.checkedAt) + 60_000) / 3_600_000) * 3_600_000).toISOString();
  const initialDraft = (): ManualDraft => ({ placeId: "", arrival: "", duration: "60",
    allowPlaceChange: true, allowedPlaceIds: places.map(p => p.id), timeMode: "custom",
    windowStart: seoulInputTime(mobilityReady ? overview.checkedAt : firstArrival),
    windowEnd: seoulInputTime(new Date(Date.parse(mobilityReady ? overview.checkedAt : firstArrival) + 180 * 60_000).toISOString()),
    maximumCongestion: "보통", ranking: "minimum-change", allowDelayedForecasts: false });
  const [draft, setDraft] = useState<ManualDraft>(initialDraft);
  const [origin, setOrigin] = useState<Origin | null>(null), [automatic, setAutomatic] = useState(mobilityReady);
  const [inputOpen, setInputOpen] = useState(true);
  const resultHeading = useRef<HTMLHeadingElement>(null), focusResults = useRef(false);
  const [transit, setTransit] = useState<TransitBundle | null>(null);
  const transitRef = useRef<TransitBundle | null>(null);
  function storeTransit(value: TransitBundle | null) { transitRef.current = value; setTransit(value); }
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
  const [hydrated, setHydrated] = useState(false), [storageNotice, setStorageNotice] = useState("");
  const [savedChoice, setSavedChoice] = useState<SavedChoice | null>(null);
  const skipSave = useRef(false);
  const restoredOnce = useRef(false);
  const [exploredPlaceId, setExploredPlaceId] = useState(places[0].id);
  useEffect(() => () => { active.current?.abort(); selectionRequest.current?.abort(); }, []);

  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    // Hydrate after SSR; local storage is an external source, unavailable during server rendering.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const { state, status } = readSavedPlanner(window.localStorage, places, Date.now());
      if (state) {
        setDraft(state.draft); setText(state.text); setOrigin(state.origin); setAutomatic(state.automatic);
        setReplanning(state.replanning); replanningRef.current = state.replanning; setSavedChoice(state.selection);
        setEdited(true); setStorageNotice("이전에 입력한 조건과 계획을 복원했어요. 새 비교는 버튼을 누를 때만 실행합니다.");
      } else if (status === "discarded") setStorageNotice("보관 기간이 지났거나 읽을 수 없는 저장 내용을 삭제했어요. 새 계획을 입력해주세요.");
      else if (status === "unavailable") setStorageNotice("브라우저 저장을 사용할 수 없어 이번 화면에서만 유지돼요.");
    } catch { setStorageNotice("브라우저 저장을 사용할 수 없어 이번 화면에서만 유지돼요."); }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [places]);
  useEffect(() => {
    if (!hydrated) return;
    if (skipSave.current) { skipSave.current = false; return; }
    try {
      const selection = choice && response ? { choice, conditions: response.conditions, confirmedAt: selected?.confirmedAt ?? null } : savedChoice;
      const state = parseSavedPlanner({ version: 1, savedAt: new Date().toISOString(), draft, text, origin, automatic, replanning, selection }, places, Date.now());
      window.localStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Saving failure must not break the usable in-memory planner.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageNotice("입력은 유지했지만 기기에 저장하지 못했어요. 브라우저 저장 설정과 입력값을 확인해주세요.");
    }
  }, [hydrated, draft, text, origin, automatic, replanning, choice, response, selected, savedChoice, places]);

  function nextRevision() { const value = ++sequence.current; setRevision(value); return value; }
  function setAdjustmentState(state: Replanning | null) { replanningRef.current = state; setReplanning(state); }
  function clearSelection() {
    selectionSequence.current++; selectionRequest.current?.abort(); setChoice(null); setSelected(null); setSavedChoice(null); setSelectionPending(false); setSelectionError("");
  }

  function clearSaved() {
    try { window.localStorage.removeItem(PLANNER_STORAGE_KEY); }
    catch { setStorageNotice("기기의 저장 내용을 지우지 못했어요. 브라우저의 사이트 데이터 설정에서 삭제해주세요."); return; }
    skipSave.current = true;
    update({}); storeTransit(null); setOrigin(null); setAutomatic(mobilityReady); setInputOpen(true); setText(""); setDraft(initialDraft());
    setStorageNotice("저장된 입력·출발지·계획을 삭제했어요. 새 입력부터 다시 저장합니다.");
  }
  function compareSaved() {
    if (!savedChoice) return;
    const state = replanningRef.current ?? startReplanning(savedChoice.conditions), version = nextRevision();
    setAdjustmentState(state); clearSelection(); setErrorScope("manual");
    void compare(effectiveConditions(state, version, places), version);
  }

  function update(patch: Partial<ManualDraft>) {
    nextRevision(); active.current?.abort(); setPending(false); setAiPending(false); setResponse(null); setAiPlan(null); setError(""); setEdited(true);
    setAdjustmentState(null); clearSelection();
    setDraft(current => ({ ...current, ...patch }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); focusResults.current = true;
    const version = nextRevision();
    active.current?.abort(); setPending(false); setError("");
    setResponse(null); setAiPlan(null); setErrorScope("manual"); clearSelection();
    try {
      const conditions = manualConditions(draft, version, places);
      setAdjustmentState(startReplanning(conditions));
      await compare(conditions, version);
    } catch (e) { setError(e instanceof Error ? e.message : "입력 조건을 확인해주세요."); }
  }
  async function prepareTransit(ids: string[], signal: AbortSignal): Promise<TransitBundle | null> {
    if (!automatic) return null;
    if (!origin) throw new Error("출발지를 먼저 선택해주세요. 현재 위치 또는 출발역 검색을 이용할 수 있어요.");
    const existing = transitRef.current;
    if (existing) {
      // Called only from submit/adjust handlers; freshness must be checked at request time.
      // eslint-disable-next-line react-hooks/purity
      if (Date.parse(existing.context.expiresAt) <= Date.now()) throw new Error("출발 기준이 만료됐어요. ‘출발 기준 다시 계산’을 눌러주세요.");
      if (ids.every(id => existing.context.routes.some(r => r.placeId === id) || existing.context.unavailable.some(r => r.placeId === id))) return existing;
    }
    if (!ids.length) throw new Error("비교할 공원을 먼저 선택해주세요.");
    const session = await fetch("/api/plan", { cache: "no-store", signal });
    if (!session.ok) throw new Error("출발지 확인 연결을 준비하지 못했어요.");
    const http = await fetch("/api/transit", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
      body: JSON.stringify({ origin, placeIds: ids }) });
    const data = await http.json();
    if (!http.ok) throw new Error(data.error || "이동시간을 계산하지 못했어요.");
    if (signal.aborted) throw new Error("요청이 변경됐어요.");
    storeTransit(data); return data;
  }
  async function compare(conditions: Conditions, version: number) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setError(""); setAiPending(false); setPending(true);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const mobility = await prepareTransit(conditions.hard.allowedPlaceIds?.filter(id => !conditions.hard.excludedPlaceIds.includes(id) && (!conditions.hard.pinnedPlaceId || conditions.hard.pinnedPlaceId === id)) ?? [], controller.signal);
      const http = await fetch("/api/recommendations", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions, transitToken: mobility?.token }), signal: controller.signal, cache: "no-store" });
      const data = await http.json();
      if (version !== sequence.current) return;
      if (!http.ok) throw new Error(typeof data.error === "string" ? data.error : "비교를 완료하지 못했어요.");
      if (data.result?.conditionsRevision !== version) throw new Error("조건 버전을 확인하지 못했어요. 다시 비교해주세요.");
      setResponse(data); setEdited(false); setInputOpen(false);
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
        body: JSON.stringify({ conditions: response.conditions, choice: nextChoice, transitToken: automatic ? transitRef.current?.token : undefined }) });
      const data = await http.json();
      if (version !== selectionSequence.current) return;
      if (!http.ok) throw new Error(data.error || "선택한 계획의 자료를 확인하지 못했어요.");
      const check = data as SelectionCheck;
      if (check.conditionsRevision !== response.conditions.revision || check.choice.placeId !== nextChoice.placeId || check.choice.arrivalAt !== nextChoice.arrivalAt) {
        throw new Error("선택한 계획과 응답이 다릅니다. 다시 확인해주세요.");
      }
      setSelected(updateSelection(previous, check));
    } catch (e) {
      if (version === selectionSequence.current) { setSelected(previous ? { ...previous, confirmedAt: null } : null); setSelectionError(e instanceof Error && e.name !== "TypeError" && e.name !== "AbortError" ? e.message : "선택은 유지했지만 자료를 확인하지 못했어요. 다시 확인해주세요."); }
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
    event.preventDefault(); focusResults.current = true;
    const version = nextRevision();
    clearSelection(); setAdjustmentState(null);
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setError(""); setErrorScope("ai"); setResponse(null); setAiPlan(null); setPending(true); setAiPending(true);
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const mobility = await prepareTransit(places.map(p => p.id), controller.signal);
      const session = await fetch("/api/plan", { cache: "no-store", signal: controller.signal });
      if (!session.ok) throw new Error("AI 연결을 준비하지 못했어요. 아래에서 조건을 직접 입력할 수 있어요.");
      const http = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        cache: "no-store", body: JSON.stringify({ text, transitToken: mobility?.token, revision: version, requestId: crypto.randomUUID(), allowDelayedForecasts: draft.allowDelayedForecasts }) });
      const data = await http.json();
      if (version !== sequence.current) return;
      if (!http.ok) throw new Error(typeof data.error === "string" ? data.error : "조건을 해석하지 못했어요.");
      if (data.result?.conditionsRevision !== version) throw new Error("조건 버전이 바뀌었어요. 다시 비교해주세요.");
      setDraft(draftFromConditions(data.conditions)); setAdjustmentState(startReplanning(data.conditions)); setResponse(data); setAiPlan(data); setEdited(false); setInputOpen(false);
    } catch (e) {
      if (version === sequence.current) setError(controller.signal.aborted ? "응답이 늦어 멈췄어요. 입력은 유지되며 아래 조건으로 비교할 수 있어요." :
        e instanceof Error && e.name !== "TypeError" ? e.message : "연결을 확인해주세요. 입력은 유지했어요.");
    } finally { clearTimeout(timeout); if (version === sequence.current) { setPending(false); setAiPending(false); } }
  }
  useEffect(() => {
    if (response && !pending && focusResults.current) { focusResults.current = false; resultHeading.current?.focus(); }
  }, [response, pending]);
  const result = response?.result, applied = response?.conditions;
  const resultCurrent = applied?.revision === revision && !pending;
  if (!hydrated) return <section className="panel" role="status">저장된 계획을 확인하고 있어요…</section>;
  return <>
    <section className="saved-strip" aria-label="기기에 저장한 계획">
      <p role="status">{storageNotice || "이 브라우저에서 계획을 이어볼 수 있어요."}</p>
      <details><summary>저장 안내·삭제</summary><p className="note">입력 문장·출발지·조건·선택 계획을 이 브라우저에 7일 보관해요. 혼잡 자료·이동시간·인증 토큰은 저장하지 않습니다.</p><button onClick={clearSaved}>저장 내용 삭제하고 새로 시작</button></details>
    </section>
    {savedChoice && <SavedPlanPanel saved={savedChoice} origin={origin} places={places} pending={pending} onCompare={compareSaved} onDismiss={clearSelection} />}
    <div className="planner-shell"><div className="planner-input">
    <div className="input-heading"><p className="eyebrow">01 / 나의 외출</p>{response && <button className="text-button" onClick={() => setInputOpen(!inputOpen)} aria-expanded={inputOpen} aria-controls="planner-fields">{inputOpen ? "입력 접기" : "처음 조건 수정"}</button>}</div>
    {!inputOpen && <div className="input-summary"><h2>처음 계획은 그대로</h2><p>{text || "직접 정한 조건으로 비교했어요."}</p><p className="note">{origin?.name || "출발지 미정"} · {automatic ? "지금 출발" : "방문 시각 직접 지정"}</p><p>고정·제외 조건은 비교 결과에서 조정할 수 있어요.</p></div>}
    <div id="planner-fields" hidden={!inputOpen}>
    <section className="natural-input" aria-labelledby="natural-title"><h2 id="natural-title">어떤 산책을 생각하나요?</h2>
      <label className="sr-only" htmlFor="outing-text">원하는 계획</label><textarea form="natural-form" id="outing-text" required maxLength={1200} rows={4} value={text}
        placeholder="지금 한강에서 한 시간 걷고 싶어.
사람 많은 곳은 피하고 싶어."
        onChange={e => { setText(e.target.value); update({}); }} />
      <p className="note">장소나 정확한 도착시각을 몰라도 괜찮아요.</p>
    </section>
    <OriginControls origin={origin} automatic={automatic} transit={transit?.context ?? null} disabled={pending} mobilityReady={mobilityReady}
      onOrigin={value => { setOrigin(value); storeTransit(null); update({}); }}
      onMode={value => {
        setAutomatic(value); storeTransit(null);
        const start = new Date(Math.ceil(Date.now() / 60_000) * 60_000).toISOString();
        update(value ? { arrival: "", timeMode: "custom", windowStart: seoulInputTime(start), windowEnd: seoulInputTime(new Date(Date.parse(start) + 180 * 60_000).toISOString()) } : {});
      }}
      onReset={() => { storeTransit(null); update({}); }} />

    <form id="natural-form" className="natural-submit" onSubmit={submitText}><button className="primary" type="submit" disabled={pending || !text.trim()}>{aiPending ? "계획을 읽고 비교하고 있어요…" : "이 산책의 대안 찾기"}<span aria-hidden="true"> ↗</span></button>
      <p className="note" role="status">{aiPending ? "입력은 그대로 두고 잠시만 기다려주세요." : "입력 문장은 조건 해석을 위해 OpenAI에 전달돼요."}</p>
    </form>
    {error && errorScope === "ai" && <div className="notice" role="alert"><p>{error}</p><p>입력은 남아 있어요. 아래에서 조건을 직접 정해 계속할 수 있습니다.</p><button onClick={() => { setAutomatic(false); storeTransit(null); update({}); const el = document.getElementById("manual-editor") as HTMLDetailsElement | null; if (el) el.open = true; }}>도착 시간대를 직접 정할게요</button></div>}
    <details className="manual-editor" id="manual-editor"><summary>조건을 직접 입력하거나 수정하기</summary><section aria-labelledby="planner-title">
      <h2 id="planner-title">내 조건으로 비교하기</h2>
      <p>원래 계획이 있으면 입력하고, 바꿔도 되는 범위를 정해주세요. 모든 시각은 한국 시간입니다.</p>
      <div className="action-row" role="group" aria-label="목적지 결정 여부">
        <button aria-pressed={!!draft.placeId} onClick={() => update({ placeId: draft.placeId || places[0].id })}>목적지를 정했어요</button>
        <button aria-pressed={!draft.placeId} onClick={() => update({ placeId: "", arrival: "", allowPlaceChange: true, timeMode: "custom" })}>아직 못 정했어요</button>
      </div>
      {!draft.placeId && !automatic && <p className="note">갈 수 있는 공원과 방문 시간대를 골라주세요. 도착시각을 계산할 필요는 없어요. 아래 시간 범위는 수정 가능한 제안이며 이동시간은 아직 반영하지 않습니다.</p>}
      {replanning && <p className="note">아래 입력은 처음 비교 조건입니다. 입력을 수정하면 추가 고정·제외와 확정 상태가 초기화되고 새 조건으로 비교합니다.</p>}
      <form onSubmit={submit}>
        <fieldset><legend>{draft.placeId ? "원래 계획" : "처음 정할 조건"}</legend>
          <div className="form-grid">
            <label>원래 장소<select value={draft.placeId} onChange={e => update({ placeId: e.target.value })}>
              <option value="">아직 못 정했어요</option>
              {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            {(!automatic || draft.arrival) && <label>원래 도착 시각<input type="datetime-local" step="60" value={draft.arrival} onChange={e => update({ arrival: e.target.value })} /></label>}
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
            <p className="note">갈 수 있는 공원만 선택해주세요. 자동 도착 계산에서는 선택한 출발지의 대중교통 예상시간을 함께 비교해요.</p>
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
          {automatic && <p className="note">자동 모드의 초기 범위는 지금부터 3시간이며 위에서 바꿀 수 있어요. 입력한 도착 범위·고정 조건은 그대로 지켜요. 도착부터 머무는 시간 전체의 예측이 있어야 추천합니다. 이동시간 계산과 고정 시각이 다르면 해당 안을 추천하지 않아요.</p>}
        </fieldset>
        <fieldset><legend>선호하는 비교</legend><div className="form-grid">
          <label>혼잡 선호<select value={draft.maximumCongestion} onChange={e => update({ maximumCongestion: e.target.value as ManualDraft["maximumCongestion"] })}>
            <option value="여유">여유만 선호</option><option value="보통">보통까지 괜찮음</option><option value="약간 붐빔">약간 붐벼도 괜찮음</option>
            <option value="붐빔">혼잡 단계 제한 없음</option>
          </select></label>
          <label>비교 기준<select value={draft.ranking} onChange={e => update({ ranking: e.target.value as ManualDraft["ranking"] })}>
            <option value="minimum-change">계획 변경 최소</option><option value="less-crowded">덜 붐빔 우선</option>
          </select></label>
        </div><p className="note">체류 구간의 평가 표본이 모두 혼잡 선호 이내인 안을 우선해요. ‘변경 최소’는 그 안에서 변경 항목 수 → 장소 유지 → 시간 차이 순으로 비교하며, 자동 도착 계산에서는 이어서 이동시간을 비교합니다. 필수 조건을 자동으로 풀지 않습니다.</p></fieldset>
        <fieldset><legend>자료 기준 확인</legend>
          <p className="note">30분이 넘은 관측은 현재 상태로 취급하지 않아요. 30~60분 전 원자료에 포함된 미래 예측은 아래 항목을 선택한 경우에만 참고 비교합니다. 60분 초과·대체 자료·수신 지연 자료는 제외해요.</p>
          <label className="checkbox"><input type="checkbox" checked={draft.allowDelayedForecasts} onChange={e => update({ allowDelayedForecasts: e.target.checked })} />지연 예측 참고 비교를 허용해요</label>
        </fieldset>
        <button className="primary" type="submit" disabled={pending}>{pending ? "조건에 맞는 예측 비교 중…" : "이 조건으로 비교"}</button>
        {error && errorScope === "manual" && <p className="notice" role="alert">{error}</p>}
        <p className="note" role="status" aria-live="polite">{pending ? "원래 계획과 허용 조건을 유지하며 자료를 확인하고 있어요." : edited ? "조건을 바꿨어요. 비교 버튼을 눌러 새 결과를 확인해주세요." : "이 단계는 AI 호출 없이 제공된 예측과 정해진 규칙으로 계산합니다."}</p>
      </form>
    </section></details>
    </div></div><div className="planner-output">
    {!response && !pending && <section className="welcome-note"><p className="eyebrow">오늘의 작은 변경</p><h2>가고 싶은 곳,<br />바꾸지 않아도 될까요?</h2><p>먼저 원래 계획을 살펴봐요.<br />그대로 괜찮다면 그대로, 조금 붐빈다면<br />장소 또는 시간을 바꾼 대안을 비교해요.</p><ol className="journey-steps"><li><span>01</span>바꾸기 어려운 조건은 고정하고</li><li><span>02</span>도착해서 머무는 시간까지 살펴보고</li><li><span>03</span>고른 계획은 지도 길찾기로 이어가요</li></ol><p className="note">여의도 · 반포 · 뚝섬 · 망원 · 난지</p></section>}
    {pending && !response && <section className="loading-plan" role="status"><p className="eyebrow">잠시, 계획을 살펴볼게요</p><h2>{aiPending ? "말씀하신 조건을 읽고 있어요." : "머무는 시간의 예측을 비교해요."}</h2><p>조건과 자료를 확인한 뒤 대안을 보여드릴게요.</p></section>}
    {aiPlan && <details className="interpreted-conditions"><summary>말씀하신 조건은 이렇게 읽었어요</summary><p>{draft.placeId ? names.get(draft.placeId) : "목적지 미정"} · {draft.duration ? `${draft.duration}분 산책` : "체류시간 미정 · 도착 기준"} · {draft.maximumCongestion}까지 선호</p>{aiPlan.assumptions.map(value => <p key={value}>{value}</p>)}{aiPlan.unsupported.map(value => <p className="notice" key={value}>평가하지 못한 조건: {value}</p>)}<button className="text-button" onClick={() => setInputOpen(true)}>읽은 조건 직접 수정</button></details>}
    {replanning && <><AdjustmentControls state={replanning} places={places} pending={pending} onAdjust={adjust} />
      {error && errorScope === "adjust" && <p className="notice" role="alert">{error}</p>}
      {!pending && !resultCurrent && <button onClick={() => {
        const version = nextRevision(); setErrorScope("adjust"); clearSelection(); void compare(effectiveConditions(replanning, version, places), version);
      }}>현재 조정 조건으로 다시 비교</button>}
    </>}
    {result && applied && <section className="results" aria-labelledby="result-title" aria-live="polite" aria-busy={pending}>
      <div className="results-intro"><p className="eyebrow">02 / 계획 비교</p><h2 ref={resultHeading} tabIndex={-1} id="result-title">{result.status === "ready" ? "조건에 맞는 비교 결과" : result.status === "preference-uncertain" ? "혼잡 선호 충족이 불확실한 결과" : result.status === "preference-unmet" ? "혼잡 선호에 못 미치는 결과" : "비교를 완료하지 못했어요"}</h2>
        {!resultCurrent && <p className="notice">이전 조건의 결과입니다. 새 비교가 완료되어야 선택할 수 있어요.</p>}
        <p>{result.message}</p>
        <details><summary>원래 계획·지킬 조건 확인</summary><p>{applied.originalPlan.placeId ? "원래 계획" : "처음 정한 조건"}: {applied.originalPlan.placeId ? names.get(applied.originalPlan.placeId) : "장소 미정"} · {applied.originalPlan.preferredArrivalAt ? formatSeoulTime(applied.originalPlan.preferredArrivalAt) : "시각 미정"} · {applied.originalPlan.durationMinutes ? `${applied.originalPlan.durationMinutes}분 머물기` : "체류시간 미정"}</p>
        <p>반드시 지킬 범위: {applied.hard.pinnedPlaceId ? `${names.get(applied.hard.pinnedPlaceId)}만` : applied.hard.allowedPlaceIds?.map(id => names.get(id)).join(", ") || "허용 장소 없음"}<br />
          도착 {formatSeoulTime(applied.hard.arrivalWindow.notBefore!)} ~ {formatSeoulTime(applied.hard.arrivalWindow.notAfter!)}</p>
        {applied.hard.pinnedArrivalAt && <p>고정한 도착시각: {formatSeoulTime(applied.hard.pinnedArrivalAt)}</p>}
        {!!applied.hard.excludedPlaceIds.length && <p>제외: {applied.hard.excludedPlaceIds.map(id => names.get(id)).join(", ")}</p>}
        </details><p className="note">계산 시각 {formatSeoulTime(result.checkedAt)} · 필수 조건과 데이터 검사를 통과한 후보 {result.eligibleCount}개</p>
        {aiPlan?.conditions.revision === applied.revision && aiPlan.explanation.facts.length ? <div><p className="eyebrow">{aiPlan.explanation.mode === "ai-selected-evidence" ? "계산된 근거에서 AI가 정리한 설명" : "계산 근거 설명"}</p>
          {aiPlan.explanation.facts.map(fact => <p key={fact.id}>{fact.text}</p>)}</div> : result.explanation && <p>{result.explanation.reason}</p>}
        {aiPlan?.conditions.revision === applied.revision && aiPlan.notice && <p className="notice">{aiPlan.notice}</p>}
        <details className="result-limitations"><summary>자료·예측·이동시간의 한계</summary>{result.limitations.map(text => <p className="note" key={text}>{text}</p>)}</details>
      </div>
      <div className="result-options">{result.options.map((option, index) => {
        const c = option.candidate;
        const unchanged = c?.change.placeChanged === false && c.change.arrivalDeltaMinutes === 0;
        const title = option.role === "original" ? "원래 계획" : option.role === "alternative" ? "다른 선택" : unchanged ? "추천 · 원래 계획 유지" : "추천";
        return <article className={`panel result-card ${option.role === "recommended" ? "recommended-card" : ""}`} key={c?.id ?? `original-${index}`} aria-label={`${c ? names.get(c.placeId) : "원래 계획"} ${c ? formatSeoulTime(c.arrivalAt) : ""} ${title}`}>
          <p className="eyebrow card-role">{title}{!option.eligible ? " · 비교 제외" : c?.dataConfidence === "delayed" ? " · 지연 예측 참고" : ""}</p>
          {choice && c && choice.placeId === c.placeId && choice.arrivalAt === c.arrivalAt ? <SelectedPlanPanel key={`${choice.placeId}:${choice.arrivalAt}:${selected?.check.checkedAt ?? "pending"}`} plan={selected} choice={choice} conditions={applied} places={places} origin={origin} pending={selectionPending} error={selectionError} onConfirm={confirmSelected} onRecheck={() => void checkSelected(choice, selected)} onAdjust={clearSelection} /> : <>
          <h3 className="place-title">{c ? names.get(c.placeId) : names.get(applied.originalPlan.placeId!)}</h3>
          <p className="arrival-line">{c?.arrivalAt || applied.originalPlan.preferredArrivalAt ? <time dateTime={c?.arrivalAt ?? applied.originalPlan.preferredArrivalAt!}>{formatSeoulTime(c?.arrivalAt ?? applied.originalPlan.preferredArrivalAt!)}</time> : "도착시각 미정"} 도착 · {applied.originalPlan.durationMinutes ? `${applied.originalPlan.durationMinutes}분 머물기` : "도착 기준 비교"}</p>
          {c && <p className="change-summary"><span>계획의 변화</span>{changeText(c, names, applied) || "처음 정하는 외출 계획"}</p>}
          {c && option.eligible && <div className="action-row">
            <button className="primary select-plan" disabled={!resultCurrent || selectionPending} onClick={() => void checkSelected({ placeId: c.placeId, arrivalAt: c.arrivalAt })}>이 계획 선택</button>

            {replanning && !replanning.base.hard.pinnedPlaceId && <button aria-pressed={replanning.placePin === c.placeId} disabled={!resultCurrent} onClick={() => adjust({ type: replanning.placePin === c.placeId ? "unpin-place" : "pin-place", placeId: c.placeId })}>{names.get(c.placeId)?.replace("한강공원", "")} 고정</button>}
            {replanning && !replanning.base.hard.pinnedArrivalAt && <button aria-pressed={replanning.timePin === c.arrivalAt} disabled={!resultCurrent} onClick={() => adjust({ type: replanning.timePin === c.arrivalAt ? "unpin-time" : "pin-time", at: c.arrivalAt })}>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(c.arrivalAt))} 고정</button>}
            <button disabled={!resultCurrent} onClick={() => adjust({ type: "exclude", placeId: c.placeId })}>이번에는 이곳 제외</button>
          </div>}
          {c ? <>{c.travel && <p><strong>대중교통 약 {Math.ceil(c.travel.totalSeconds / 60)}분</strong> · 도보 {Math.ceil(c.travel.walkingSeconds / 60)}분 포함 · 환승 {c.travel.transfers}회<br />{places.find(p => p.id === c.placeId)?.accessPoint.name} 도착 기준</p>}{option.role === "recommended" ? <TemporalEvidence candidate={c} maximum={applied.soft.maximumPreferredCongestion} /> : <details><summary>도착·체류 예측 살펴보기</summary><TemporalEvidence candidate={c} maximum={applied.soft.maximumPreferredCongestion} /></details>}

            <p className="note">원자료 기준 {formatSeoulTime(c.sourceUpdatedAt)} · 수신 {formatSeoulTime(c.fetchedAt)}<br />계산 시점 기준 {Math.max(0, Math.floor((Date.parse(result.checkedAt) - Date.parse(c.sourceUpdatedAt)) / 60_000))}분 전 자료</p>
          </> : <p>해당 시각 예측을 확인할 수 없어요.</p>}
          {option.reasons.map(text => <p className="notice" key={text}>{text}</p>)}
          {c && <button onClick={() => { setExploredPlaceId(c.placeId); document.getElementById("place-explorer")?.scrollIntoView({ block: "start" }); }}>위치·전체 예측 보기</button>}

          </>}
        </article>;
      })}</div>
      {result.excludedPlaces.length > 0 && <details className="panel"><summary>장소별 제외 이유 {result.excludedPlaces.length}곳</summary>
        {result.excludedPlaces.map(item => <div key={item.placeId}><h3>{names.get(item.placeId)}</h3><ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>)}
      </details>}
      {result.status === "forecast-unavailable" && result.availableForecastTimes.length > 0 && <div className="panel"><h3>현재 제공된 예측 시각</h3><p>허용한 장소 중 하나 이상에서 제공한 시각입니다. 모든 공원에 같은 시각의 예측이 있다는 뜻은 아니에요.</p>
        <p>{result.availableForecastTimes.map(at => formatSeoulTime(at)).join(" / ")}</p><p>위 입력에서 시각이나 허용 범위를 직접 수정해주세요.</p></div>}
    </section>}
    </div></div>
    <PlaceExplorer overview={overview} selectedId={exploredPlaceId} onSelect={setExploredPlaceId} />
  </>;
}
