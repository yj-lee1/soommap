"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatSeoulTime, seoulInputTime } from "@/lib/data/time";
import { manualConditions, type ManualDraft } from "@/lib/domain/manual";
import type { Candidate, Conditions, Recommendation } from "@/lib/domain/types";
import type { PopulationOverview } from "@/lib/server/population";

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
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [edited, setEdited] = useState(false);
  const sequence = useRef(0), active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);

  function update(patch: Partial<ManualDraft>) {
    sequence.current++; active.current?.abort(); setPending(false); setResponse(null); setError(""); setEdited(true);
    setDraft(current => ({ ...current, ...patch }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const version = ++sequence.current;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setError(""); setResponse(null); setPending(true);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const conditions = manualConditions(draft, version, places);
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
  const result = response?.result, applied = response?.conditions;
  return <>
    <section className="panel" aria-labelledby="planner-title">
      <h2 id="planner-title">내 조건으로 비교하기</h2>
      <p>먼저 원래 계획을 입력하고, 바꿔도 되는 범위를 정해주세요. 모든 시각은 한국 시간입니다.</p>
      <form onSubmit={submit}>
        <fieldset><legend>원래 계획</legend>
          <div className="form-grid">
            <label>원래 장소<select value={draft.placeId} onChange={e => update({ placeId: e.target.value })}>
              {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <label>원래 도착 시각<input required type="datetime-local" step="60" value={draft.arrival} onChange={e => update({ arrival: e.target.value })} /></label>
            <label>머무는 시간 (분)<input required type="number" min="15" max="240" step="1" value={draft.duration} onChange={e => update({ duration: e.target.value })} /></label>
          </div>
          <p className="note">머무는 시간은 유지하지만, 그 시간 내내 같은 혼잡도를 보장하지는 않아요.</p>
        </fieldset>
        <fieldset><legend>바꿔도 되는 범위</legend>
          <label className="checkbox"><input type="checkbox" checked={draft.allowPlaceChange} onChange={e => update({ allowPlaceChange: e.target.checked })} />다른 한강공원으로 변경해도 괜찮아요</label>
          {draft.allowPlaceChange && <div className="choice-list" role="group" aria-label="비교를 허용한 공원">
            {places.map(p => <label className="checkbox" key={p.id}><input type="checkbox" checked={draft.allowedPlaceIds.includes(p.id)}
              onChange={e => update({ allowedPlaceIds: e.target.checked ? [...draft.allowedPlaceIds, p.id] : draft.allowedPlaceIds.filter(id => id !== p.id) })} />{p.name}</label>)}
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
          <p className="note">‘늦어도 괜찮아요’는 도착을 앞당기지 않습니다. 없는 예측 시각을 보간하거나 반올림하지 않아요.</p>
        </fieldset>
        <fieldset><legend>선호하는 비교</legend><div className="form-grid">
          <label>혼잡 선호<select value={draft.maximumCongestion} onChange={e => update({ maximumCongestion: e.target.value as ManualDraft["maximumCongestion"] })}>
            <option value="여유">여유만 선호</option><option value="보통">보통까지 괜찮음</option><option value="약간 붐빔">약간 붐벼도 괜찮음</option>
          </select></label>
          <label>비교 기준<select value={draft.ranking} onChange={e => update({ ranking: e.target.value as ManualDraft["ranking"] })}>
            <option value="minimum-change">계획 변경 최소</option><option value="less-crowded">덜 붐빔 우선</option>
          </select></label>
        </div><p className="note">‘변경 최소’는 혼잡 선호를 만족하는 안 중 변경 항목 수 → 장소 유지 → 시간 차이 순으로 비교해요. 필수 조건을 자동으로 풀지 않습니다.</p></fieldset>
        <fieldset><legend>자료 기준 확인</legend>
          <p className="note">30분이 넘은 관측은 현재 상태로 취급하지 않아요. 30~60분 전 원자료에 포함된 미래 예측은 아래 항목을 선택한 경우에만 참고 비교합니다. 60분 초과·대체 자료·수신 지연 자료는 제외해요.</p>
          <label className="checkbox"><input type="checkbox" checked={draft.allowDelayedForecasts} onChange={e => update({ allowDelayedForecasts: e.target.checked })} />지연 예측 참고 비교를 허용해요</label>
        </fieldset>
        <button type="submit" disabled={pending}>{pending ? "조건에 맞는 예측 비교 중…" : "이 조건으로 비교"}</button>
        <p className="note" role="status" aria-live="polite">{pending ? "원래 계획과 허용 조건을 유지하며 자료를 확인하고 있어요." : edited ? "조건을 바꿨어요. 비교 버튼을 눌러 새 결과를 확인해주세요." : "이 단계는 AI 호출 없이 제공된 예측과 정해진 규칙으로 계산합니다."}</p>
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    </section>
    {result && applied && <section className="results" aria-labelledby="result-title" aria-live="polite">
      <div className="panel"><h2 id="result-title">{result.status === "ready" ? "조건에 맞는 비교 결과" : result.status === "preference-unmet" ? "혼잡 선호에 못 미치는 결과" : "비교를 완료하지 못했어요"}</h2>
        <p>{result.message}</p>
        <p>원래 계획: {names.get(applied.originalPlan.placeId!)} · {formatSeoulTime(applied.originalPlan.preferredArrivalAt!)} · {applied.originalPlan.durationMinutes}분 머물기</p>
        <p>반드시 지킬 범위: {applied.hard.pinnedPlaceId ? `${names.get(applied.hard.pinnedPlaceId)}만` : applied.hard.allowedPlaceIds?.map(id => names.get(id)).join(", ") || "허용 장소 없음"}<br />
          도착 {formatSeoulTime(applied.hard.arrivalWindow.notBefore!)} ~ {formatSeoulTime(applied.hard.arrivalWindow.notAfter!)}</p>
        <p className="note">계산 시각 {formatSeoulTime(result.checkedAt)} · 필수 조건과 데이터 검사를 통과한 후보 {result.eligibleCount}개</p>
        {result.explanation && <p>{result.explanation.reason}</p>}
        {result.limitations.map(text => <p className="note" key={text}>{text}</p>)}
      </div>
      <div className="result-options">{result.options.map((option, index) => {
        const c = option.candidate;
        const unchanged = c?.change.placeChanged === false && c.change.arrivalDeltaMinutes === 0;
        const title = option.role === "original" ? "원래 계획" : option.role === "alternative" ? "다른 선택" : unchanged ? "추천 · 원래 계획 유지" : "추천";
        return <article className="panel result-card" key={c?.id ?? `original-${index}`}>
          <p className="eyebrow">{title}{!option.eligible ? " · 비교 제외" : c?.dataConfidence === "delayed" ? " · 지연 예측 참고" : ""}</p>
          <h3>{c ? names.get(c.placeId) : names.get(applied.originalPlan.placeId!)}</h3>
          <p>{formatSeoulTime(c?.arrivalAt ?? applied.originalPlan.preferredArrivalAt!)} 도착 · {applied.originalPlan.durationMinutes}분 머물기</p>
          {c ? <><p><strong>{c.congestion}</strong> 예측{!c.meetsPreference ? " · 혼잡 선호 미충족" : " · 혼잡 선호 충족"}</p>
            <p>{changeText(c, names, applied)}</p>
            <p className="note">원자료 기준 {formatSeoulTime(c.sourceUpdatedAt)} · 수신 {formatSeoulTime(c.fetchedAt)}<br />계산 시점 기준 {Math.max(0, Math.floor((Date.parse(result.checkedAt) - Date.parse(c.sourceUpdatedAt)) / 60_000))}분 전 자료</p>
          </> : <p>해당 시각 예측을 확인할 수 없어요.</p>}
          {option.reasons.map(text => <p className="notice" key={text}>{text}</p>)}
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
