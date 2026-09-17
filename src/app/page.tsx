import { ManualPlanner } from "@/components/manual-planner";
import Link from "next/link";
import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";

export default async function Home() {
  const overview = await getPopulationOverview();
  return <main className="page planner-page">
    <header><p className="eyebrow">개발 검수용 · 5단계 · 계획 저장·예측·지도</p><h1>숨맵</h1>
      <p className="lead">내 조건을 지키며, 덜 붐비는 외출 계획 찾기</p>
      <p>원하는 외출을 말로 입력하고 한강공원 5곳의 실제 예측을 비교해보세요. AI가 조건을 해석하고, 도착·체류 구간은 정해진 규칙으로 평가합니다.</p>
      <Link href="/data" prefetch={false}>5곳 원자료·기준 시각·예측 표 보기</Link>
    </header>
    <ManualPlanner overview={overview} mobilityReady={Boolean(process.env.TMAP_API_KEY?.trim())} />
    <footer className="panel"><details><summary>홈 화면에 숨맵 추가하기</summary>
      <p>iPhone Safari에서는 공유 → 홈 화면에 추가, Android Chrome에서는 메뉴 → 홈 화면에 추가 또는 앱 설치를 선택해주세요. 브라우저에 따라 메뉴가 다를 수 있어요.</p>
      <p className="note">설치 없이 이 주소로도 사용할 수 있어요. 최신 혼잡 자료와 추천에는 인터넷 연결이 필요합니다. 홈 화면 앱과 브라우저의 저장 공간이 다르면 계획이 서로 공유되지 않을 수 있어요.</p>
    </details><p>출처: <a href="https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do" target="_blank" rel="noreferrer">서울특별시 실시간 인구데이터</a> · 공공누리 제1유형</p>
      <p className="note">공원 단위의 추정값입니다. 혼잡 단계는 안전성 등급이나 세부 산책로·소음 측정값이 아닙니다. 원자료를 숨맵 형식으로 변환했습니다.</p>
    </footer>
  </main>;
}
