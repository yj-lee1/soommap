import { useId } from "react";
import { formatSeoulTime } from "@/lib/data/time";
import { forecastChart } from "@/lib/domain/forecast-chart";
import type { ForecastPoint } from "@/lib/domain/types";

const levels = ["붐빔", "약간 붐빔", "보통", "여유"];
const timeLabel = (at: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
export function ForecastChart({ points, startAt, hours = 12, visit }: {
  points: ForecastPoint[]; startAt: string; hours?: number; visit?: { startAt: string; endAt: string };
}) {
  const id = useId(), chart = forecastChart(points, startAt, hours);
  if (!chart.samples.length) return <p>이 범위의 예측이 제공되지 않았어요. 관측값으로 채우지 않습니다.</p>;
  const x = (at: string) => 100 + chart.position(at) * 580;
  const first = chart.samples[0].at, last = chart.samples.at(-1)!.at;
  const visitStart = visit && Math.max(100, x(visit.startAt)), visitEnd = visit && Math.min(680, x(visit.endAt));
  return <figure className="forecast-figure">
    <div className="chart-scroll" tabIndex={0} role="region" aria-label="혼잡 예측 그래프, 작은 화면에서 가로로 스크롤">
      <svg viewBox="0 0 720 260" className="forecast-chart" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>서울시 제공 혼잡 예측 표본</title>
        <desc id={`${id}-desc`}>{chart.samples.map(p => `${formatSeoulTime(p.at)} ${p.congestion}`).join(", ")}. 점 사이를 연결하거나 혼잡 단계를 보간하지 않습니다.</desc>
        {visitStart !== undefined && visitEnd !== undefined && visitEnd >= visitStart && <rect x={visitStart} y="22" width={Math.max(2, visitEnd - visitStart)} height="177" className="visit-shade" />}
        {levels.map((level, index) => <g key={level}><text x="8" y={52 + index * 44}>{level}</text>
          <line x1="100" x2="680" y1={47 + index * 44} y2={47 + index * 44} className="chart-grid" /></g>)}
        {chart.gaps.map(gap => <g key={gap.startAt}><line x1={x(gap.startAt) + 6} x2={x(gap.endAt) - 6} y1="20" y2="20" className="chart-gap" />
          <text x={(x(gap.startAt) + x(gap.endAt)) / 2} y="14" textAnchor="middle" className="chart-small">자료 간격 큼</text></g>)}
        {chart.samples.map((point, index) => <g key={point.at}><circle cx={x(point.at)} cy={47 + levels.indexOf(point.congestion) * 44} r="6" className="forecast-dot"><title>{formatSeoulTime(point.at)} {point.congestion}</title></circle>
          <text x={x(point.at)} y={index % 2 ? 236 : 218} textAnchor="middle" className="chart-small">{timeLabel(point.at)}</text></g>)}
      </svg>
    </div>
    <figcaption className="note">{formatSeoulTime(first)} ~ {formatSeoulTime(last)} · 점은 해당 시각의 공식 예측입니다. 단계 사이의 간격은 수치 차이를 뜻하지 않아요. 표본 사이 상태와 빈 구간은 알 수 없습니다.{visit && " 음영은 계획한 도착~체류 종료 구간입니다."}</figcaption>
    <details><summary>그래프를 표로 보기</summary><table><thead><tr><th scope="col">예측 시각</th><th scope="col">혼잡 단계</th></tr></thead>
      <tbody>{chart.samples.map(p => <tr key={p.at}><th scope="row">{formatSeoulTime(p.at)}</th><td>{p.congestion}</td></tr>)}</tbody></table></details>
  </figure>;
}
