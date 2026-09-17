import type { Candidate, Conditions, CongestionLevel, Place, Recommendation, Snapshot } from "./types.ts";
import { assessSnapshot, forecastUse } from "../data/quality.ts";

const severity: Record<CongestionLevel, number> = { "여유": 0, "보통": 1, "약간 붐빔": 2, "붐빔": 3 };
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
function makeCandidate(snapshot: Snapshot, at: string, c: Conditions, nowMs: number): Candidate | null {
  const point = snapshot.forecasts.find(p => p.at === at);
  if (!point) return null;
  return { id: `${snapshot.placeId}@${at}`, placeId: snapshot.placeId, arrivalAt: at,
    congestion: point.congestion, snapshotId: snapshot.id, evidenceIds: [`${snapshot.id}#forecast:${at}`],
    sourceUpdatedAt: snapshot.sourceUpdatedAt, fetchedAt: snapshot.fetchedAt, dataConfidence: forecastUse(snapshot, nowMs),
    meetsPreference: severity[point.congestion] <= severity[c.soft.maximumPreferredCongestion],
    change: { placeChanged: c.originalPlan.placeId === null ? null : c.originalPlan.placeId !== snapshot.placeId,
      arrivalDeltaMinutes: c.originalPlan.preferredArrivalAt === null ? null :
        (Date.parse(at) - Date.parse(c.originalPlan.preferredArrivalAt)) / 60_000 } };
}
function compare(a: Candidate, b: Candidate, mode: Conditions["soft"]["ranking"]) {
  const changes = (v: Candidate) => Number(v.change.placeChanged === true) + Number(v.change.arrivalDeltaMinutes !== null && v.change.arrivalDeltaMinutes !== 0);
  const delta = (v: Candidate) => Math.abs(v.change.arrivalDeltaMinutes ?? 0);
  const congestion = severity[a.congestion] - severity[b.congestion];
  const minimum = [changes(a) - changes(b), Number(a.change.placeChanged) - Number(b.change.placeChanged), delta(a) - delta(b)];
  const order = mode === "less-crowded" ? [congestion, ...minimum] : [...minimum, congestion];
  return order.find(v => v !== 0) ?? (lexical(a.arrivalAt, b.arrivalAt) || lexical(a.placeId, b.placeId));
}

/** Pure deterministic engine: caller supplies validated conditions, server data and time. */
export function recommend(c: Conditions, places: Place[], snapshots: Snapshot[], nowMs: number): Recommendation {
  const result: Recommendation = { checkedAt: new Date(nowMs).toISOString(), conditionsRevision: c.revision,
    snapshotIds: [], status: "no-candidates", message: "", recommendedCandidateId: null, alternativeCandidateIds: [],
    candidates: [], explanation: null, limitations: ["서울시가 제공한 도착 시각의 예측만 비교해요. 머무는 시간 내내 같은 혼잡도를 보장하지 않아요.", "장소별 혼잡 지표이며 소음·실제 이동시간은 계산하지 않아요."],
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
    for (const point of forecasts) {
      if (timeReasons(point.at, c, nowMs).length) continue;
      const candidate = makeCandidate(snapshot, point.at, c, nowMs)!;
      eligible.push(candidate); added++;
    }
    if (!added) result.excludedPlaces.push({ placeId: place.id, reasons: ["허용한 날짜·범위·고정 시각에 맞는 제공 예측이 없어요. 시각을 임의로 반올림하지 않아요."] });
  }
  result.availableForecastTimes = unique(result.availableForecastTimes).sort();
  result.eligibleCount = eligible.length;
  const preferred = eligible.filter(v => v.meetsPreference);
  const ranked = [...(preferred.length ? preferred : eligible)].sort((a, b) => compare(a, b, preferred.length ? c.soft.ranking : "less-crowded"));
  if (ranked.length) {
    result.status = preferred.length ? "ready" : "preference-unmet";
    result.message = preferred.length ? "반드시 지킬 조건 안에서 비교했어요." : "혼잡 선호를 만족하는 안이 없어요. 필수 조건은 지키면서 상대적으로 덜 붐비는 안을 보여드려요.";
    result.recommendedCandidateId = ranked[0].id;
    result.options.push({ role: "recommended", candidate: ranked[0], eligible: true, reasons: [] });
    result.explanation = { reason: preferred.length ? c.soft.ranking === "minimum-change"
      ? "혼잡 선호를 만족하는 안 중 변경 항목 수, 장소 유지, 시간 차이 순으로 골랐어요."
      : "허용 범위 안에서 혼잡 단계가 낮은 안을 먼저 골랐어요."
      : "선호 수준에는 못 미치지만, 허용 범위 안에서 혼잡 단계가 가장 낮은 안이에요.",
      tradeoff: "장소 변경의 실제 이동 부담은 계산하지 않았어요. 갈 수 있는 장소만 허용해주세요.", evidenceIds: ranked[0].evidenceIds };
  } else {
    result.status = !hardPlaces ? "no-candidates" : !usablePlaces ? "data-unavailable" : "forecast-unavailable";
    result.message = !hardPlaces ? "장소 조건을 모두 지키는 후보가 없어요. 허용 장소·고정 조건을 확인해주세요."
      : !usablePlaces ? "사용 가능한 예측 자료가 없어 비교를 보류했어요. 아래 제외 이유를 확인해주세요."
        : "지정한 시각의 예측이 없어요. 제공 시각을 확인한 뒤 도착 범위를 직접 조정해주세요.";
  }
  let originalOption: Recommendation["options"][number] | null = null;
  if (c.originalPlan.placeId !== null && c.originalPlan.preferredArrivalAt !== null) {
    const place = places.find(p => p.id === c.originalPlan.placeId), snapshot = byPlace.get(c.originalPlan.placeId);
    const candidate = snapshot ? makeCandidate(snapshot, c.originalPlan.preferredArrivalAt, c, nowMs) : null;
    const reasons = [...(place ? placeReasons(place, c) : ["지원하지 않는 원래 장소예요."]), ...dataReasons(snapshot, c, nowMs),
      ...timeReasons(c.originalPlan.preferredArrivalAt, c, nowMs), ...(!candidate ? ["원래 도착 시각에 해당하는 예측이 없어요."] : [])];
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
  return result;
}
