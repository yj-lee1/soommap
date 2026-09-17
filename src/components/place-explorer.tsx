"use client";
import { useEffect, useState } from "react";
import type { PopulationOverview } from "@/lib/server/population";
import { formatSeoulTime } from "@/lib/data/time";
import { areaProjection, type AreaFeature } from "@/lib/domain/area-map";
import { ForecastChart } from "./forecast-chart";
import { RefreshData } from "./refresh-data";

function AreaMap({ overview, selectedId, onSelect }: { overview: PopulationOverview; selectedId: string; onSelect: (id: string) => void }) {
  const [features, setFeatures] = useState<AreaFeature[] | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8_000);
    void fetch("/data/hangang-boundaries.geojson", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("map_unavailable");
      const data = await response.json();
      if (!Array.isArray(data.features) || data.features.length !== 5 || data.features.some((f: AreaFeature) => f.geometry?.type !== "Polygon")) throw new Error("map_invalid");
      areaProjection(data.features); setFeatures(data.features);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => clearTimeout(timeout));
    const abort = () => setFailed(true); controller.signal.addEventListener("abort", abort);
    return () => { controller.signal.removeEventListener("abort", abort); controller.abort(); clearTimeout(timeout); };
  }, []);
  if (failed) return <p className="notice">영역 지도를 불러오지 못했어요. 아래 장소 버튼과 예측은 계속 사용할 수 있어요.</p>;
  if (!features) return <p role="status">공식 집계 영역을 불러오고 있어요…</p>;
  const project = areaProjection(features);
  return <svg className="area-map" viewBox="0 0 720 260" role="group" aria-label="한강공원 5곳의 공식 집계 영역 지도">
    <text x="12" y="24" className="chart-small">북 ↑</text><text x="12" y="246" className="chart-small">서울 · 집계 영역과 대표 위치</text>
    {features.map(f => <path key={f.properties.placeId} className={selectedId === f.properties.placeId ? "area-shape selected" : "area-shape"}
      d={f.geometry.coordinates.map(ring => ring.map((p, i) => `${i ? "L" : "M"}${project(p[0], p[1]).join(",")}`).join(" ") + " Z").join(" ")} fillRule="evenodd" />)}
    {overview.rows.map(({ place }, index) => {
      const [x, y] = project(place.displayCoordinate.longitude, place.displayCoordinate.latitude);
      const [ax, ay] = project(place.accessPoint.coordinate.longitude, place.accessPoint.coordinate.latitude);
      return <g key={place.id}>
        {selectedId === place.id && <rect x={ax - 4} y={ay - 4} width="8" height="8" className="access-point" />}
        <g role="button" tabIndex={0} aria-label={`${place.name} 위치와 예측 보기`} aria-pressed={selectedId === place.id}
          onClick={() => onSelect(place.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(place.id); } }} className="map-marker">
          <circle cx={x} cy={y - 24} r="22" fill="transparent" /><line x1={x} x2={x} y1={y - 12} y2={y} className="marker-stem" />
          <circle cx={x} cy={y - 24} r="13" className={selectedId === place.id ? "marker selected" : "marker"} />
          <text x={x} y={y - 19} textAnchor="middle" className="marker-label">{index + 1}</text>
        </g>
      </g>;
    })}
  </svg>;
}

export function PlaceExplorer({ overview, selectedId, onSelect }: { overview: PopulationOverview; selectedId: string; onSelect: (id: string) => void }) {
  const [mapOpen, setMapOpen] = useState(false);
  const row = overview.rows.find(row => row.place.id === selectedId) ?? overview.rows[0];
  const { place, snapshot, quality } = row;
  return <section className="panel" id="place-explorer" aria-labelledby="explorer-title">
    <h2 id="explorer-title">공원 위치와 앞으로의 혼잡</h2>
    <p className="note">이 영역은 페이지에서 조회한 전체 예측입니다. 위 추천 카드의 계산 근거와 확인 시각이 다를 수 있어요. 장소를 살펴봐도 입력 조건이나 선택 계획은 바뀌지 않습니다.</p>
    <details onToggle={event => setMapOpen(event.currentTarget.open)}><summary>2D 집계 영역 지도 펼치기</summary>
      {mapOpen && <AreaMap overview={overview} selectedId={place.id} onSelect={onSelect} />}
      <p className="note">면은 서울시 공식 인구 집계 영역, 번호는 공원 표시점, 사각형은 선택한 공원의 길찾기 기준 안내센터예요. 도로·산책 경로를 표시하는 지도는 아닙니다.</p>
    </details>
    <div className="action-row" role="group" aria-label="살펴볼 공원">{overview.rows.map(({ place: p }, i) => <button key={p.id} aria-pressed={p.id === place.id} onClick={() => onSelect(p.id)}>{i + 1}. {p.name}</button>)}</div>
    <h3>{place.name}</h3>
    <p>길찾기 기준: {place.accessPoint.name} · <a href={place.accessPoint.sourceUrl} target="_blank" rel="noreferrer">공식 시설 안내</a></p>
    {snapshot && quality ? <>
      <p className="note">원자료 {formatSeoulTime(snapshot.sourceUpdatedAt)} · 수신 {formatSeoulTime(snapshot.fetchedAt)} · 화면 확인 {formatSeoulTime(overview.checkedAt)}</p>
      {(quality.freshness !== "fresh" || quality.refreshOverdue || snapshot.isReplacement !== false) && <p className="notice">지연·대체 여부를 확인해야 하는 자료예요. 아래 그래프가 현재 혼잡이나 추천 가능 상태를 뜻하지 않습니다.</p>}
      <h4>앞으로 최대 12시간 · 제공된 예측 표본</h4><ForecastChart points={snapshot.forecasts} startAt={overview.checkedAt} />
    </> : <p className="notice">이 공원의 예측 자료를 가져오지 못했어요. 다른 장소를 선택하거나 자료를 다시 확인해주세요.</p>}
    <RefreshData />
    <p className="note">출처: <a href="https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do" target="_blank" rel="noreferrer">서울특별시 실시간 인구데이터·공식 장소 영역</a> · 공공누리 제1유형. 영역의 좌표를 화면에 투영했습니다.</p>
  </section>;
}
