"use client";
import { useId, useMemo, useState } from "react";
import { alignArrival, assessVisit } from "@/lib/domain/temporal";
import type { Candidate, CongestionLevel, Snapshot } from "@/lib/domain/types";

const shortTime = (at: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
const population = (value: number) => (Math.round(value / 100) * 100).toLocaleString("ko-KR");

/** Presentation-only inspection of the candidate's own snapshot evidence. No requests or plan mutations. */
export function VisitTimeline({ candidate, maximum }: { candidate: Candidate; maximum: CongestionLevel }) {
  const id = useId(), points = candidate.visit.evidence;
  const first = points[0]?.at, last = points.at(-1)?.at;
  const duration = candidate.visit.scope === "stay" ? (Date.parse(candidate.visit.endAt) - Date.parse(candidate.visit.startAt)) / 60_000 : null;
  const [at, setAt] = useState(candidate.arrivalAt);
  const snapshot = useMemo<Snapshot>(() => ({ id: candidate.snapshotId, placeId: candidate.placeId,
    sourceUpdatedAt: candidate.sourceUpdatedAt, fetchedAt: candidate.fetchedAt, observation: null,
    isReplacement: false, forecastAvailable: true, forecasts: points, issues: [] }), [candidate.snapshotId, candidate.placeId, candidate.sourceUpdatedAt, candidate.fetchedAt, points]);
  if (!first || !last) return <p className="notice">도착 전후 예측이 없어 시간대를 살펴볼 수 없어요.</p>;
  const firstMs = Date.parse(first), span = Math.max(1, (Date.parse(last) - firstMs) / 60_000);
  const offset = (Date.parse(at) - firstMs) / 60_000;
  const upper = Math.max(0, span - (duration ?? 0));
  const arrival = alignArrival(snapshot, at), visit = assessVisit(snapshot, at, duration, maximum);
  const valid = arrival.kind !== "unavailable" && visit.coverage === "complete";
  const gaps = points.slice(1).flatMap((p, i) => Date.parse(p.at) - Date.parse(points[i].at) > 3_600_000 ? [{ from: points[i].at, to: p.at }] : []);
  return <section className="visit-timeline" aria-labelledby={`${id}-title`}>
    <div className="timeline-title"><h4 id={`${id}-title`}>머무는 동안은 어떨까요?</h4><span>한국 시각</span></div>
    <p className="note">○ 서울시 공식 예측 시점</p>
    <div className="forecast-ruler">
      <div className="forecast-axis" />
      {gaps.map(g => <div className="forecast-gap" key={g.from} style={{ left: `${(Date.parse(g.from) - firstMs) / 60_000 / span * 100}%`, width: `${(Date.parse(g.to) - Date.parse(g.from)) / 60_000 / span * 100}%` }} aria-label="예측 공백" />)}
      {points.map((p, index) => <div className={`forecast-sample ${points.length > 4 && index !== 0 && index !== points.length - 1 && index % Math.ceil((points.length - 1) / 3) !== 0 ? "compact-sample" : ""}`} key={p.id} style={{ left: `${(Date.parse(p.at) - firstMs) / 60_000 / span * 100}%` }}><time dateTime={p.at}>{shortTime(p.at)}</time><span className="sample-dot" data-congestion={p.congestion} /><span>{p.congestion}</span></div>)}
      <div className={`stay-band ${duration ? "" : "arrival-only"}`} style={{ left: `${Math.max(0, Math.min(100, offset / span * 100))}%`, width: `${Math.max(0, Math.min(100 - Math.max(0, offset / span * 100), (duration ?? 0) / span * 100))}%` }}><span>{duration ? `${duration}분 체류` : "도착"}</span></div>
    </div>
    {points.length === 1 && <p className="note">이 카드에는 공식 예측 한 시점만 있어요.</p>}
    {gaps.length > 0 && <p className="notice">빗금 구간은 예측 공백입니다. 누락된 구간은 채우지 않아요.</p>}
    <label className="timeline-control" htmlFor={`${id}-range`}>체류 구간 살펴보기 <output aria-live="off">{shortTime(at)}{duration ? `–${shortTime(visit.endAt)}` : " 도착"}</output></label>
    <input id={`${id}-range`} type="range" min={0} max={upper} step={1} value={Math.max(0, Math.min(upper, offset))} disabled={upper === 0 || points.length < 2}
      aria-valuetext={`${shortTime(at)}${duration ? `부터 ${shortTime(visit.endAt)}까지` : " 도착"}`}
      onChange={event => setAt(new Date(firstMs + Number(event.target.value) * 60_000).toISOString())} />
    <p className="note timeline-hint">탐색만 해요. 추천 시각·고정 조건은 바뀌지 않아요.</p>
    <div className={`timeline-reading ${arrival.kind === "between" ? "estimated-reading" : ""}`}>
      {valid ? <><strong key={arrival.evidence.map(p => p.id).join(":")}>{arrival.kind === "exact" ? `${shortTime(at)} 공식 예측` : `${shortTime(at)} 전후 공식 예측`}</strong><p>{arrival.evidence.map(p => `${shortTime(p.at)} ${p.congestion}`).join(" → ")}</p>
        {arrival.population && <p className="note"><span className="value-kind">{arrival.population.kind === "official" ? "공식 인구 범위" : "숨맵 인구 추정 · 선형 보간"}</span><br />{arrival.population.kind === "linear-estimate" ? "약 " : ""}{(arrival.population.kind === "official" ? arrival.population.min.toLocaleString("ko-KR") : population(arrival.population.min))}–{(arrival.population.kind === "official" ? arrival.population.max.toLocaleString("ko-KR") : population(arrival.population.max))}명</p>}
        <p className="note">{visit.preference === "supported" ? "체류 평가 표본이 모두 선호 이내예요." : "체류 전후 표본에 선호를 넘는 단계가 있어요."}</p></> : <><strong>이 구간은 판단을 보류해요.</strong><p>도착부터 종료까지 예측이 이어지지 않아 인구 추정도 표시하지 않아요.</p></>}
    </div>
  </section>;
}
