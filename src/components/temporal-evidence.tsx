import { formatSeoulTime } from "@/lib/data/time";
import type { Candidate, ForecastTrend, VisitAssessment } from "@/lib/domain/types";
import { ForecastChart } from "./forecast-chart";

const trendText: Record<ForecastTrend, string> = {
  same: "평가에 사용한 예측 표본은 같은 혼잡 단계예요.",
  rising: "평가에 사용한 예측 표본에서 혼잡 단계가 높아지는 흐름이에요.",
  falling: "평가에 사용한 예측 표본에서 혼잡 단계가 낮아지는 흐름이에요.",
  mixed: "평가에 사용한 예측 표본에서 혼잡 단계가 오르내려요.",
  unknown: "자료가 부족해 구간 전체의 흐름은 판단하지 않아요.",
};
const preferenceText: Record<VisitAssessment["preference"], string> = {
  supported: "참고 표본이 모두 혼잡 선호 이내",
  uncertain: "선호 충족 불확실 · 전후 표본이 선호 수준을 넘나듦",
  exceeds: "혼잡 선호를 넘는 예측 포함",
  unknown: "평가 자료 부족",
};
const gapText = { "no-forecast": "예측 없음", "before-range": "첫 예측 이전", "after-range": "마지막 예측 이후", "wide-gap": "표본 간격 60분 초과" };
const number = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });

export function TemporalEvidence({ candidate }: { candidate: Candidate }) {
  const { arrival, visit } = candidate, population = arrival.population;
  return <div>
    {arrival.kind === "exact" ? <p><strong>{arrival.evidence[0].congestion}</strong> · 도착 시각의 서울시 예측</p> :
      <p>도착 전후 서울시 예측: <strong>{arrival.evidence.map(p => `${formatSeoulTime(p.at)} ${p.congestion}`).join(" → ")}</strong></p>}
    <p><strong>{preferenceText[visit.preference]}</strong></p>
    {visit.scope === "stay" && <p>체류 구간 {formatSeoulTime(visit.startAt)} ~ {formatSeoulTime(visit.endAt)}<br />
      {trendText[visit.trend]}</p>}
    {arrival.kind === "between" && visit.scope === "arrival" && <p>{trendText[arrival.trend]}</p>}
    {population && <p className="note">{population.kind === "official" ?
      `서울시 도착 시각 예측 인구 ${number(population.min)}~${number(population.max)}명` :
      `도착 시각 인구 · 숨맵 추정 약 ${number(Math.round(population.min / 100) * 100)}~${number(Math.round(population.max / 100) * 100)}명`}</p>}
    {arrival.kind === "between" && !population && <p className="note">양쪽 인구 범위가 없어 인구는 보간하지 않았어요. 혼잡 단계 표본으로만 비교해요.</p>}
    {visit.coverage !== "complete" && <p className="notice">전체 체류 구간을 평가할 수 없어 추천에서는 제외했어요.</p>}
    <details><summary>체류 구간 예측 그래프</summary>
      <ForecastChart points={visit.evidence} startAt={visit.evidence[0]?.at ?? visit.startAt}
        hours={Math.max(1, (Date.parse(visit.evidence.at(-1)?.at ?? visit.endAt) - Date.parse(visit.evidence[0]?.at ?? visit.startAt)) / 3_600_000)} visit={visit} />
    </details>
    <details><summary>예측 근거와 계산 방식</summary>
      <p className="note">{arrival.kind === "exact" ? "도착 시각과 일치하는 공식 예측값입니다." :
        "도착 시각 양쪽의 공식 예측을 참고합니다. 해당 시각의 공식 혼잡 단계나 단계 전환 시각을 새로 만들지 않습니다."}</p>
      {population?.kind === "linear-estimate" && <p className="note">인구 범위 양끝을 시간 비율 약 {(population.weight! * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%로 선형 보간했습니다. 표시값은 100명 단위로 반올림한 숨맵 추정이며, 공식 예측·신뢰구간이 아닙니다. 인구 수는 장소 간 추천 순위에 사용하지 않습니다.</p>}
      <table><caption>서울시 제공 예측 · 구간 전후 표본 포함</caption><thead><tr><th scope="col">예측 시각</th><th scope="col">혼잡 단계</th><th scope="col">예측 인구 (명)</th></tr></thead>
        <tbody>{visit.evidence.map(p => <tr key={p.id}><th scope="row">{formatSeoulTime(p.at)}</th><td>{p.congestion}</td>
          <td>{p.populationRange ? `${number(p.populationRange.min)}~${number(p.populationRange.max)}` : "미제공"}</td></tr>)}</tbody>
      </table>
      {visit.gaps.map(g => <p className="notice" key={g.startAt}>{formatSeoulTime(g.startAt)} ~ {formatSeoulTime(g.endAt)}: {gapText[g.reason]}</p>)}
      <p className="note">표본 사이의 실제 혼잡과 정확한 변화 시점은 알 수 없습니다. ‘같은 단계’는 표본이 같다는 뜻이며 계속 한산하다는 보장은 아닙니다.</p>
    </details>
  </div>;
}
