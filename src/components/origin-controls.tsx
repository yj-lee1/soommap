"use client";
import { useEffect, useRef, useState } from "react";
import stations from "@/lib/data/stations.json";
import type { Origin, TransitContext } from "@/lib/domain/mobility";
import { formatSeoulTime } from "@/lib/data/time";

export function OriginControls({ origin, automatic, transit, disabled, mobilityReady, onOrigin, onMode, onReset }: {
  origin: Origin | null; automatic: boolean; transit: TransitContext | null; disabled: boolean;
  mobilityReady: boolean; onOrigin: (origin: Origin | null) => void; onMode: (value: boolean) => void; onReset: () => void;
}) {
  const [query, setQuery] = useState(""), [notice, setNotice] = useState(""), [locating, setLocating] = useState(false);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const results = query.trim() ? stations.filter(s => s.name.includes(query.trim())).slice(0, 15) : [];
  function locate() {
    const version = ++sequence.current;
    if (!navigator.geolocation) { setNotice("현재 위치를 사용할 수 없어요. 출발역을 검색해주세요."); return; }
    setLocating(true); setNotice("");
    navigator.geolocation.getCurrentPosition(position => {
      if (version !== sequence.current) return;
      setLocating(false);
      const { latitude, longitude } = position.coords;
      if (latitude < 33 || latitude > 39 || longitude < 124 || longitude > 132) { setNotice("국내 출발지를 선택해주세요."); return; }
      onOrigin({ name: "현재 위치", latitude, longitude, source: "geolocation" }); setQuery("");
      setNotice(`현재 위치를 선택했어요. 위치 오차 약 ${Math.round(position.coords.accuracy)}m가 있을 수 있어요.`);
    }, () => { if (version === sequence.current) { setLocating(false); setNotice("위치 권한이나 위치 확인이 어려워요. 아래에서 출발역을 검색해주세요."); } },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 });
  }
  return <section className="panel" aria-labelledby="origin-title">
    <h2 id="origin-title">어디서 출발하나요?</h2>
    <div className="action-row"><button disabled={disabled || locating} onClick={locate}>{locating ? "위치 확인 중…" : "현재 위치 사용"}</button>
      {origin && <button disabled={disabled} onClick={() => { sequence.current++; setLocating(false); onOrigin(null); setNotice(""); }}>출발지 지우기</button>}</div>
    <label>출발역 검색<input type="search" maxLength={40} value={query} placeholder="예: 홍대입구, 서울역" disabled={disabled}
      onChange={e => { setQuery(e.target.value); sequence.current++; setLocating(false); }} /></label>
    {!!query.trim() && <div className="choice-list" aria-label="출발역 검색 결과">
      {results.map(s => <button key={s.id} disabled={disabled} onClick={() => {
        sequence.current++; setLocating(false); onOrigin({ name: `${s.name} · ${s.line}`, latitude: s.latitude, longitude: s.longitude, source: "station" }); setQuery(""); setNotice("");
      }}>{s.name} · {s.line}</button>)}
      {!results.length && <p>일치하는 역이 없어요. 역 이름 일부로 검색하거나 현재 위치를 사용해주세요.</p>}
    </div>}
    {origin && <p><strong>출발: {origin.name}</strong>{origin.source === "station" ? " · 출발역 대표 위치 기준" : " · 이번 탭에서만 유지"}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset><legend>도착시각 정하기</legend>
      <label className="checkbox"><input type="radio" name="arrival-mode" checked={automatic} disabled={disabled || !mobilityReady} onChange={() => onMode(true)} />지금 출발 · 대중교통 이동시간으로 계산</label>
      <label className="checkbox"><input type="radio" name="arrival-mode" checked={!automatic} disabled={disabled} onChange={() => onMode(false)} />도착시각 직접 입력 · 이동시간 미반영</label>
    </fieldset>
    {!mobilityReady && <p className="notice">검수 서버의 TMAP 키 연결을 기다리고 있어요. 지금은 도착시각을 직접 정해 비교한 뒤, 선택한 출발지로 지도 길찾기를 이용할 수 있어요.</p>}
    {automatic && <p className="note">출발지에서 공원 안내센터까지 버스·지하철과 도보를 포함한 예상시간을 계산해요. 미래 출발시각의 소요시간을 예측하는 기능은 아니에요.</p>}
    {transit && automatic && <><p>출발 계산 기준 {formatSeoulTime(transit.departureAt)} · 이동시간 확인 {transit.routes.length}곳 / 미확인 {transit.unavailable.length}곳</p>
      <button disabled={disabled} onClick={onReset}>출발 기준 다시 계산</button><p className="note">다시 계산하면 기존 선택·확정은 해제돼요. 같은 출발지의 최근 결과는 최대 3분 재사용해요.</p></>}
    <p className="note">출발 좌표는 이동시간 계산 시 TMAP, 확정 후 길찾기를 누를 때 선택한 지도 서비스에 전달돼요. AI 조건 해석에는 출발 좌표를 전달하지 않습니다. 검색 역은 <a href="https://data.seoul.go.kr/dataList/OA-21232/S/1/datasetView.do" target="_blank" rel="noreferrer">서울 열린데이터광장 역사마스터</a> (2026.9.12 기준)를 사용해요.</p>
  </section>;
}
