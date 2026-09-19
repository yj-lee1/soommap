import boundaries from '@/lib/data/hangang-boundaries.json';
import { areaProjection, type AreaFeature } from '@/lib/domain/area-map';
import type { Place } from '@/lib/domain/types';

/** Static official geometry; selection is presentation only, never a routing request. */
export function ParkMap({ places, activeId, compact = false }: { places: Place[]; activeId?: string; compact?: boolean }) {
  const features = boundaries.features as AreaFeature[];
  const project = areaProjection(features, 640, 300);
  return <figure className={`park-map ${compact ? 'compact-map' : ''}`}>
    <div className="map-caption"><span>서울, 한강의 다섯 자리</span><span>북 ↑</span></div>
    <svg viewBox="0 0 640 300" role="img" aria-label={`한강공원 위치와 서울시 집계 영역${activeId ? ` · ${places.find(p => p.id === activeId)?.name} 강조` : ''}`}>
      <text x="290" y="60" className="map-city-label">SEOUL</text>
      {features.map(f => <path key={f.properties.placeId} className={`park-area ${activeId === f.properties.placeId ? 'active' : ''}`}
        d={f.geometry.coordinates.map(ring => ring.map((p, i) => `${i ? 'L' : 'M'}${project(p[0], p[1]).join(',')}`).join(' ') + ' Z').join(' ')} />)}
      {places.map(p => {
        const [x, y] = project(p.displayCoordinate.longitude, p.displayCoordinate.latitude);
        const above = p.id !== 'mangwon' && p.id !== 'banpo';
        return <g key={p.id} className={`park-map-point ${activeId === p.id ? 'active' : ''}`}>
          <line x1={x} x2={x} y1={y} y2={y + (above ? -28 : 28)} />
          <circle cx={x} cy={y} r={activeId === p.id ? 9 : 5} />
          <text x={x} y={y + (above ? -36 : 49)} textAnchor="middle">{p.name.replace('한강공원', '')}{activeId === p.id ? ' ↗' : ''}</text>
        </g>;
      })}
    </svg>
    <figcaption>공식 인구 집계 영역 · 대표 위치<br /><span>강의 경계·이동 경로·혼잡 분포를 나타내지 않아요.</span></figcaption>
  </figure>;
}
