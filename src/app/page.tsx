import { RefreshData } from "@/components/refresh-data";
import { SEOUL_SOURCE_URL } from "@/lib/data/catalog";
import { formatSeoulTime } from "@/lib/data/time";
import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";

function PopulationRange({ range }: { range?: { min: number; max: number } }) {
  return range ? <span>{range.min.toLocaleString("ko-KR")}~{range.max.toLocaleString("ko-KR")}명 추정</span> : <span>인원 추정 없음</span>;
}

export default async function Home() {
  const overview = await getPopulationOverview();
  return <main className="page">
    <header>
      <p className="eyebrow">개발 검수용 · 1단계</p>
      <h1>숨맵</h1>
      <p className="lead">한강에 나가기 전, 붐비는 시간을 살펴보세요.</p>
      <p>지금은 한강공원 5곳의 실제 자료를 확인하는 단계예요. 조건 입력과 AI 추천은 다음 단계에서 연결합니다.</p>
    </header>
    <section className="panel" aria-labelledby="overview-title">
      <h2 id="overview-title">한강공원 혼잡 정보</h2>
      <p>5곳 중 {overview.availableCount}곳 자료 수신 · 확인 시각 {formatSeoulTime(overview.checkedAt)} (한국 시간)</p>
      <p>{overview.commonForecastTimes.length > 0
        ? `자료상 5곳 공통 예측 시각 ${overview.commonForecastTimes.length}개 · ${formatSeoulTime(overview.commonForecastTimes[0])}부터 ${formatSeoulTime(overview.commonForecastTimes.at(-1)!)}까지`
        : "5곳에서 함께 비교할 수 있는 미래 예측 시각이 아직 확인되지 않았어요."}</p>
      {!overview.comparisonReady && <p className="notice">일부 자료의 지연·누락·갱신 상태로 최신 조건의 전체 비교를 보류하고 있어요. 아래에서 장소별 상태를 확인해주세요.</p>}
      <RefreshData />
    </section>
    <div className="place-list">
      {overview.rows.map(({ place, snapshot, quality }) => <section key={place.id} className="panel place-panel" aria-labelledby={`place-${place.id}`}>
        <div className="place-heading"><h2 id={`place-${place.id}`}>{place.name}</h2>
          <span className="badge">{!quality ? "자료 없음" : quality.freshness === "stale" ? "오래된 자료" : quality.freshness === "delayed" ? "자료 지연" : "최근 자료"}</span>
        </div>
        {!snapshot || !quality ? <p role="status">현재 자료를 가져오지 못했어요. 다른 공원의 정보는 계속 볼 수 있습니다. 잠시 후 다시 확인해주세요.</p> : <>
          <dl className="observation">
            <div><dt>최근 관측</dt><dd><strong>{snapshot.observation?.congestion ?? "확인 불가"}</strong><br />
              <PopulationRange range={snapshot.observation?.populationRange} /></dd></div>
            <div><dt>자료 기준 시각</dt><dd>{formatSeoulTime(snapshot.sourceUpdatedAt)}<br /><span className="note">확인 시점 기준 {quality.sourceAgeMinutes}분 전 자료</span></dd></div>
          </dl>
          {quality.freshness !== "fresh" && <p className="notice">{quality.freshness === "stale" ? "1시간 넘게 지난 자료입니다." : "30분 넘게 지난 자료입니다."} 현재 상태로 간주하지 않고, 최신 추천에는 사용하지 않아요.</p>}
          {quality.refreshOverdue && <p className="notice">새 자료 수신이 늦어 이전에 받은 자료를 보여드리고 있어요. 현재 상태는 다시 확인해야 합니다.</p>}
          {snapshot.isReplacement !== false && <p className="notice">{snapshot.isReplacement === true ? "서울시가 대체 자료로 표시한 값입니다." : "대체 자료 여부를 확인하지 못했습니다."} 최신 추천 대상에서 제외합니다.</p>}
          {snapshot.issues.some(issue => ["forecast_partial", "forecast_conflict"].includes(issue)) && <p className="notice">일부 예측값을 확인하지 못해 해당 시각을 제외했어요. 없는 값은 임의로 채우지 않습니다.</p>}
          <details>
            <summary>앞으로의 예측 {quality.futureForecasts.length}개 보기</summary>
            {quality.futureForecasts.length ? <table>
              <caption>{place.name} · 서울시 제공 예측 (한국 시간)</caption>
              <thead><tr><th scope="col">예측 시각</th><th scope="col">혼잡 예측</th><th scope="col">추정 인원</th></tr></thead>
              <tbody>{quality.futureForecasts.map(point => <tr key={point.at}>
                <th scope="row">{formatSeoulTime(point.at)}</th><td>{point.congestion}</td>
                <td><PopulationRange range={point.populationRange} /></td>
              </tr>)}</tbody>
            </table> : <p>앞으로의 예측 자료가 없어요. 최근 관측값으로 미래 혼잡을 대신 판단하지 않습니다.</p>}
          </details>
          <p className="note">마지막 수신 {formatSeoulTime(snapshot.fetchedAt)} · 장소 코드 {place.source.areaCode}</p>
        </>}
      </section>)}
    </div>
    <footer className="panel">
      <h2>자료를 읽을 때 알아두세요</h2>
      <p>관측은 집계 시점의 추정값, 예측은 서울시가 제공한 해당 시각의 예상값입니다. 예측 시각 사이 또는 머무는 내내 같은 혼잡도라는 뜻은 아니에요.</p>
      <p>공원별 공식 집계 영역의 정보입니다. 공원 내부의 특정 산책로 혼잡이나 소음 수준까지 알 수는 없어요. 네 단계는 장소별 혼잡 지표이며, 공원 사이의 절대적인 밀도가 같다는 뜻은 아닙니다.</p>
      <a href={SEOUL_SOURCE_URL} target="_blank" rel="noreferrer">출처: 서울특별시 실시간 인구데이터</a>
      <p className="note">공공누리 제1유형 · 자료와 공식 영역을 숨맵 표시 형식으로 변환했습니다. 화면 디자인은 기능 검수 후 일괄 적용합니다.</p>
    </footer>
  </main>;
}
