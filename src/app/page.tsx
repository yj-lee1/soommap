import { ManualPlanner } from "@/components/manual-planner";
import Link from "next/link";
import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";

export default async function Home() {
  const overview = await getPopulationOverview();
  return <main className="page planner-page">
    <header><p className="eyebrow">개발 검수용 · 2단계 보완 · 도착·체류 평가</p><h1>숨맵</h1>
      <p className="lead">내 조건을 지키며, 덜 붐비는 외출 계획 찾기</p>
      <p>한강공원 5곳의 실제 예측을 비교합니다. 지금은 수동 조건 입력으로 작동하며, 자연어 AI 연결과 화면 디자인은 다음 단계입니다.</p>
      <Link href="/data" prefetch={false}>5곳 원자료·기준 시각·예측 표 보기</Link>
    </header>
    <ManualPlanner overview={overview} />
    <footer className="panel"><p>출처: <a href="https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do" target="_blank" rel="noreferrer">서울특별시 실시간 인구데이터</a> · 공공누리 제1유형</p>
      <p className="note">공원 단위의 추정값입니다. 혼잡 단계는 안전성 등급이나 세부 산책로·소음 측정값이 아닙니다. 원자료를 숨맵 형식으로 변환했습니다.</p>
    </footer>
  </main>;
}
