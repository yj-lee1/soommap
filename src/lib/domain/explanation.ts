import type { Conditions, Place, Recommendation } from "./types.ts";
import { formatSeoulTime } from "../data/time.ts";

export interface ExplanationFact { id: string; text: string; evidenceIds: string[] }
/** Only deterministic, evidence-backed sentences may reach the explanation renderer. */
export function explanationFacts(result: Recommendation, conditions: Conditions, places: Place[]): ExplanationFact[] {
  const candidate = result.candidates.find(c => c.id === result.recommendedCandidateId);
  if (!candidate || !result.explanation) return [];
  const name = places.find(p => p.id === candidate.placeId)?.name;
  if (!name) return [];
  const evidenceIds = candidate.evidenceIds;
  const facts: ExplanationFact[] = [
    { id: "reason", text: result.explanation.reason, evidenceIds },
    { id: "arrival", text: `${name}에 ${formatSeoulTime(candidate.arrivalAt)} 도착하는 안입니다.`, evidenceIds },
    { id: "preference", text: candidate.visit.preference === "supported" ? "평가에 사용한 전후·체류 예측 표본이 모두 설정한 혼잡 선호 이내입니다. 실제 방문 내내 같은 상태라는 보장은 아니에요." :
      candidate.visit.preference === "uncertain" ? "방문 경계의 전후 예측 단계가 달라 혼잡 선호 충족을 확정할 수 없어요." : "평가 표본에 설정한 혼잡 선호를 넘는 단계가 포함되어 있어요.", evidenceIds },
  ];
  if (candidate.travel) facts.push({ id: "travel", text: `대중교통 예상 이동 ${Math.ceil(candidate.travel.totalSeconds / 60)}분이며 도보 ${Math.ceil(candidate.travel.walkingSeconds / 60)}분이 포함돼요. 실제 운행과 이동시간은 지도 앱에서 다시 확인해주세요.`, evidenceIds });
  if (result.explanation.tradeoff) facts.push({ id: "tradeoff", text: result.explanation.tradeoff, evidenceIds });
  if (candidate.arrival.kind === "between") facts.push({ id: "between", text: "도착시각 양쪽의 서울시 예측을 함께 참고했어요. 인구 범위의 보간값은 숨맵 추정이며 혼잡 단계는 보간하지 않았어요.", evidenceIds });
  if (conditions.originalPlan.durationMinutes !== null) facts.push({ id: "stay", text: `${conditions.originalPlan.durationMinutes}분 머무는 구간과 그 경계를 둘러싼 예측 표본을 함께 평가했어요.`, evidenceIds });
  if (candidate.visit.trend === "rising" || candidate.visit.trend === "falling") facts.push({ id: "trend", text: `평가에 사용한 예측 표본은 시간 순서대로 혼잡 단계가 ${candidate.visit.trend === "rising" ? "높아지는" : "낮아지는"} 흐름이에요.`, evidenceIds });
  if (candidate.dataConfidence === "delayed") facts.push({ id: "delayed", text: "사용자가 참고를 허용한 30~60분 전 원자료의 미래 예측입니다. 현재 상태로 해석하지 마세요.", evidenceIds });
  return facts;
}
export function explanationSchema(facts: ExplanationFact[]) {
  return { type: "object", additionalProperties: false, required: ["factIds"],
    properties: { factIds: { type: "array", items: { type: "string", enum: facts.map(f => f.id) }, minItems: 1, maxItems: 3 } } };
}
export function renderExplanation(value: unknown, facts: ExplanationFact[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !("factIds" in value)) throw new Error("invalid_explanation");
  const ids = value.factIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 3 || new Set(ids).size !== ids.length || ids.some(id => !facts.some(f => f.id === id))) throw new Error("invalid_explanation");
  return ids.map(id => facts.find(f => f.id === id)!);
}
