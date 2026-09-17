import type { Candidate, Conditions, Place, Recommendation, Snapshot } from "./types.ts";
import { assessSnapshot, forecastUse } from "../data/quality.ts";
import { alignArrival, assessVisit, congestionOrder } from "./temporal.ts";

import { formatSeoulTime } from "../data/time.ts";
import { routeReasons, type TransitContext } from "./mobility.ts";

const unique = (values: string[]) => [...new Set(values)];
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function placeReasons(place: Place, c: Conditions): string[] {
  const reasons: string[] = [];
  if (!place.enabled || !place.activities.includes(c.activity) || c.hard.requiredSettings.some(s => !place.settings.includes(s))) reasons.push("요청한 활동·환경과 맞지 않는 장소예요.");
  if (!c.hard.allowedPlaceIds?.includes(place.id)) reasons.push("비교를 허용한 장소가 아니에요.");
  if (c.hard.excludedPlaceIds.includes(place.id)) reasons.push("이번 비교에서 제외한 장소예요.");
  if (c.hard.pinnedPlaceId && c.hard.pinnedPlaceId !== place.id) reasons.push("장소 고정 조건을 지켜야 해요.");
  return reasons;
}
function dataReasons(snapshot: Snapshot | undefined, c: Conditions, nowMs: number): string[] {
  if (!snapshot) return ["정상 자료를 받지 못했어요."];
  const q = assessSnapshot(snapshot, nowMs), reasons: string[] = [];
  if (q.freshness === "stale") reasons.push("원자료가 60분 넘게 지나 비교에서 제외했어요.");
  if (q.refreshOverdue) reasons.push("새 자료를 10분 넘게 받지 못해 비교에서 제외했어요.");
  if (snapshot.isReplacement !== false) reasons.push("대체 자료이거나 대체 여부를 확인하지 못했어요.");
  if (!snapshot.forecastAvailable || !q.futureForecasts.length) reasons.push("앞으로의 예측 자료가 없어요.");
  if (q.freshness === "delayed" && !c.dataPolicy.allowDelayedForecasts) reasons.push("원자료가 30~60분 전이에요. 원하면 ‘지연 예측 참고 비교’를 직접 허용해주세요.");
  return reasons;
}
function timeReasons(at: string, c: Conditions, nowMs: number): string[] {
  const reasons: string[] = [];
  if (Date.parse(at) < nowMs) reasons.push("이미 지난 도착 시각이에요.");
  if ((c.hard.arrivalWindow.notBefore && at < c.hard.arrivalWindow.notBefore) ||
    (c.hard.arrivalWindow.notAfter && at > c.hard.arrivalWindow.notAfter)) reasons.push("허용한 도착 범위 밖이에요.");
  if (c.hard.pinnedArrivalAt && c.hard.pinnedArrivalAt !== at) reasons.push("고정한 도착 시각과 달라요.");
  return reasons;
}
function makeCandidate(snapshot: Snapshot, at: string, c: Conditions, nowMs: number, transit?: TransitContext): Candidate | null {
  const arrival = alignArrival(snapshot, at);
  if (arrival.kind === "unavailable") return null;
  const visit = assessVisit(snapshot, at, c.originalPlan.durationMinutes, c.soft.maximumPreferredCongestion);
  const route = transit?.routes.find(r => r.placeId === snapshot.placeId && r.arrivalAt === at);
  return { ...(route ? { travel: { ...route, departureAt: transit!.departureAt, expiresAt: transit!.expiresAt } } : {}), id: `${snapshot.placeId}@${at}`, placeId: snapshot.placeId, arrivalAt: at,
    arrival, visit, snapshotId: snapshot.id, evidenceIds: visit.evidence.map(p => p.id),
    sourceUpdatedAt: snapshot.sourceUpdatedAt, fetchedAt: snapshot.fetchedAt, dataConfidence: forecastUse(snapshot, nowMs),
    meetsPreference: visit.preference === "supported",
    change: { placeChanged: c.originalPlan.placeId === null ? null : c.originalPlan.placeId !== snapshot.placeId,
      arrivalDeltaMinutes: c.originalPlan.preferredArrivalAt === null ? null :
        (Date.parse(at) - Date.parse(c.originalPlan.preferredArrivalAt)) / 60_000 } };
}
function compare(a: Candidate, b: Candidate, mode: Conditions["soft"]["ranking"]) {
  const changes = (v: Candidate) => Number(v.change.placeChanged === true) + Number(v.change.arrivalDeltaMinutes !== null && v.change.arrivalDeltaMinutes !== 0);
  const delta = (v: Candidate) => Math.abs(v.change.arrivalDeltaMinutes ?? 0);
  const congestion = congestionOrder[a.visit.worstSampledCongestion!] - congestionOrder[b.visit.worstSampledCongestion!];
  const minimum = [changes(a) - changes(b), Number(a.change.placeChanged) - Number(b.change.placeChanged), delta(a) - delta(b), (a.travel?.totalSeconds ?? 0) - (b.travel?.totalSeconds ?? 0)];
  const order = mode === "less-crowded" ? [congestion, ...minimum] : [...minimum, congestion];
  return (order.find(v => v !== 0) ?? (Number(a.visit.trend !== "same") - Number(b.visit.trend !== "same"))) ||
    lexical(a.arrivalAt, b.arrivalAt) || lexical(a.placeId, b.placeId);
}

function candidateTimes(snapshot: Snapshot, c: Conditions): string[] {
  // A finite, explainable set; no synthetic forecast samples or per-minute grid.
  const times = snapshot.forecasts.map(p => p.at);
  if (c.originalPlan.durationMinutes !== null) times.push(...snapshot.forecasts.map(p =>
    new Date(Date.parse(p.at) - c.originalPlan.durationMinutes! * 60_000).toISOString()));
  return unique([...times, c.originalPlan.preferredArrivalAt, c.hard.pinnedArrivalAt,
    c.hard.arrivalWindow.notBefore, c.hard.arrivalWindow.notAfter].filter((at): at is string => at !== null)).sort();
}
function coverageReasons(candidate: Candidate | null): string[] {
  return !candidate ? ["도착 시각을 평가할 예측이 없어요. 정확히 일치하는 표본 또는 60분 이내 간격의 양쪽 표본이 필요해요."] :
    candidate.visit.coverage !== "complete" ? ["체류 종료까지 예측이 이어지지 않거나 표본 간격이 60분을 넘어 비교에서 제외했어요. 부족한 구간을 외삽하지 않아요."] : [];
}

/** Recheck exactly the selected place/time, even if a different candidate ranks higher. */
export function checkChoice(c: Conditions, choice: { placeId: string; arrivalAt: string }, places: Place[], snapshots: Snapshot[], nowMs: number, transit?: TransitContext) {
  const place = places.find(p => p.id === choice.placeId), snapshot = snapshots.find(s => s.placeId === choice.placeId);
  const candidate = snapshot ? makeCandidate(snapshot, choice.arrivalAt, c, nowMs, transit) : null;
  const reasons = [...(place ? placeReasons(place, c) : ["지원하지 않는 장소예요."]), ...timeReasons(choice.arrivalAt, c, nowMs),
    ...dataReasons(snapshot, c, nowMs), ...coverageReasons(candidate), ...(transit && place ? routeReasons(transit, place, choice.arrivalAt, nowMs) : [])];
  return { choice: { ...choice }, conditionsRevision: c.revision, checkedAt: new Date(nowMs).toISOString(),
    eligible: !!candidate && reasons.length === 0, reasons: unique(reasons), candidate };
}

/** Pure deterministic engine: caller supplies validated conditions, server data and time. */
export function recommend(c: Conditions, places: Place[], snapshots: Snapshot[], nowMs: number, transit?: TransitContext): Recommendation {
  const result: Recommendation = { checkedAt: new Date(nowMs).toISOString(), conditionsRevision: c.revision,
    snapshotIds: [], status: "no-candidates", message: "", recommendedCandidateId: null, alternativeCandidateIds: [],
    candidates: [], explanation: null, limitations: ["도착·체류 구간을 둘러싼 서울시 예측 표본으로 비교해요. 같은 단계의 표본 사이에서도 실제 혼잡은 달라질 수 있어요.",
      "시각 사이의 인구는 숨맵이 선형 보간한 참고 추정값이며 공식 예측·신뢰구간이 아니에요. 혼잡 단계는 보간하지 않아요.", transit ? "TMAP 대중교통 예상시간에 걷기가 포함돼요. 시간표·현장 상황에 따라 달라지므로 확정 후 지도 앱에서 운행·상세 경로를 확인해주세요." : "장소별 혼잡 지표이며 소음·실제 이동시간은 계산하지 않아요."],
    options: [], excludedPlaces: [], availableForecastTimes: [], eligibleCount: 0 };
  if (c.hard.allowedPlaceIds === null || !c.hard.arrivalWindow.notBefore || !c.hard.arrivalWindow.notAfter) {
    return { ...result, status: "needs-clarification", message: "비교해도 되는 장소와 도착 범위를 먼저 정해주세요." };
  }
  const byPlace = new Map(snapshots.map(s => [s.placeId, s]));
  const eligible: Candidate[] = [];
  let hardPlaces = 0, usablePlaces = 0;
  for (const place of places) {
    const hardReasons = placeReasons(place, c), snapshot = byPlace.get(place.id);
    if (hardReasons.length) { result.excludedPlaces.push({ placeId: place.id, reasons: hardReasons }); continue; }
    hardPlaces++;
    const unavailable = dataReasons(snapshot, c, nowMs);
    if (unavailable.length || !snapshot) { result.excludedPlaces.push({ placeId: place.id, reasons: unavailable }); continue; }
    usablePlaces++;
    const forecasts = assessSnapshot(snapshot, nowMs).futureForecasts;
    result.availableForecastTimes.push(...forecasts.map(p => p.at));
    let added = 0;
    const missing = new Set<string>();
    const route = transit?.routes.find(r => r.placeId === place.id);
    const arrivalTimes = transit ? (route ? [route.arrivalAt] : []) : candidateTimes(snapshot, c);
    if (transit) routeReasons(transit, place, route?.arrivalAt ?? "", nowMs).forEach(r => missing.add(r));
    for (const at of arrivalTimes) {
      if (transit && routeReasons(transit, place, at, nowMs).length) continue;
      if (timeReasons(at, c, nowMs).length) continue;
      const candidate = makeCandidate(snapshot, at, c, nowMs, transit);
      const reasons = coverageReasons(candidate);
      if (!candidate || reasons.length) { reasons.forEach(r => missing.add(r)); continue; }
      eligible.push(candidate); added++;
    }
    if (!added) result.excludedPlaces.push({ placeId: place.id, reasons: missing.size ? [...missing] : ["허용한 날짜·범위·고정 시각에 맞는 후보가 없어요."] });
  }
  result.availableForecastTimes = unique(result.availableForecastTimes).sort();
  result.eligibleCount = eligible.length;
  const preferred = eligible.filter(v => v.meetsPreference);
  const uncertain = eligible.filter(v => v.visit.preference === "uncertain");
  const pool = preferred.length ? preferred : uncertain.length ? uncertain : eligible;
  const ranked = [...pool].sort((a, b) => compare(a, b, preferred.length ? c.soft.ranking : "less-crowded"));
  if (ranked.length) {
    result.status = preferred.length ? "ready" : uncertain.length ? "preference-uncertain" : "preference-unmet";
    result.message = preferred.length ? "반드시 지킬 조건 안에서, 평가에 사용한 예측 표본이 모두 혼잡 선호 이내인 안을 골랐어요." : uncertain.length
      ? "도착·체류 경계 주변의 예측이 선호 수준을 넘나들어요. 선호 충족을 단정할 수 없는 참고 후보입니다."
      : "평가에 사용한 예측에 혼잡 선호를 넘는 단계가 있어요. 필수 조건은 유지하며 비교합니다.";
    result.recommendedCandidateId = ranked[0].id;
    result.options.push({ role: "recommended", candidate: ranked[0], eligible: true, reasons: [] });
    result.explanation = { reason: preferred.length ? c.soft.ranking === "minimum-change"
      ? transit ? "평가 표본이 모두 선호 이내인 안 중 변경 항목 수, 장소 유지, 시간 차이와 예상 이동시간 순으로 골랐어요." : "평가 표본이 모두 선호 이내인 안 중 변경 항목 수, 장소 유지, 시간 차이 순으로 골랐어요."
      : "평가 표본이 모두 선호 이내인 안 중 가장 높은 표본 단계가 낮은 안을 먼저 골랐어요."
      : uncertain.length ? "선호 충족이 불확실한 안 중 전후 표본의 가장 높은 단계를 보수적으로 비교했어요."
      : "평가에 사용한 표본의 가장 높은 단계를 기준으로 상대적으로 덜 붐비는 안을 골랐어요.",
      tradeoff: transit ? "같은 선호 조건 안에서 계획 변경과 예상 이동시간을 함께 비교했어요. 안내센터를 공원 방문 기준 지점으로 사용하며 실제 출입구까지의 최단 경로를 보장하지 않아요." : "장소 변경의 실제 이동 부담은 계산하지 않았어요. 갈 수 있는 장소만 허용해주세요.", evidenceIds: ranked[0].evidenceIds };
  } else {
    result.status = !hardPlaces ? "no-candidates" : !usablePlaces ? "data-unavailable" : "forecast-unavailable";
    result.message = !hardPlaces ? "장소 조건을 모두 지키는 후보가 없어요. 허용 장소·고정 조건을 확인해주세요."
      : !usablePlaces ? "사용 가능한 예측 자료가 없어 비교를 보류했어요. 아래 제외 이유를 확인해주세요."
        : "도착부터 체류 종료까지 평가할 예측이 부족해요. 제공 시각과 제외 이유를 확인해주세요.";
  }
  if (transit && !transit.routes.length && hardPlaces) {
    result.status = "data-unavailable"; result.message = "이동시간을 확인한 공원이 없어 자동 도착 비교를 보류했어요. 출발지는 유지됩니다. 직접 도착시각 모드로 비교하고 확정 후 지도 앱에서 상세 경로를 확인할 수 있어요.";
  }
  let originalOption: Recommendation["options"][number] | null = null;
  if (c.originalPlan.placeId !== null && c.originalPlan.preferredArrivalAt !== null) {
    const place = places.find(p => p.id === c.originalPlan.placeId), snapshot = byPlace.get(c.originalPlan.placeId);
    const candidate = snapshot ? makeCandidate(snapshot, c.originalPlan.preferredArrivalAt, c, nowMs, transit) : null;
    const reasons = [...(place ? placeReasons(place, c) : ["지원하지 않는 원래 장소예요."]), ...dataReasons(snapshot, c, nowMs),
      ...timeReasons(c.originalPlan.preferredArrivalAt, c, nowMs), ...coverageReasons(candidate),
      ...(transit && place ? routeReasons(transit, place, c.originalPlan.preferredArrivalAt, nowMs) : [])];
    originalOption = { role: "original", candidate, eligible: candidate !== null && !reasons.length, reasons: unique(reasons) };
  }
  const originalIsRecommended = originalOption?.candidate?.id === result.recommendedCandidateId && result.recommendedCandidateId !== null;
  const alternatives = ranked.filter(v => v.id !== result.recommendedCandidateId && v.id !== originalOption?.candidate?.id)
    .slice(0, originalOption && !originalIsRecommended ? 1 : 2);
  result.alternativeCandidateIds = alternatives.map(v => v.id);
  result.options.push(...alternatives.map(candidate => ({ role: "alternative" as const, candidate, eligible: true, reasons: [] })));
  if (originalOption && !originalIsRecommended) result.options.push(originalOption);
  result.candidates = result.options.flatMap(v => v.candidate ? [v.candidate] : []);
  result.snapshotIds = unique(result.candidates.map(v => v.snapshotId));
  if (result.options.some(o => o.eligible && o.candidate?.dataConfidence === "delayed")) result.limitations.unshift("지연 예측 참고 비교를 허용했어요. 30~60분 전 원자료에 포함된 미래 예측이며 현재 관측 상태로 해석하지 마세요.");
  if (transit) result.limitations.unshift(`출발 기준 ${formatSeoulTime(transit.departureAt)} · 확인된 ${transit.routes.length}곳의 이동시간만 반영했어요. 도착시각은 분 단위로 올림합니다.`);
  return result;
}
