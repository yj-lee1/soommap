import { WalkArt } from "@/components/walk-art";
import { ManualPlanner } from "@/components/manual-planner";
import Link from "next/link";
import { MotionPreference } from "@/components/motion-preference";
import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";

export default async function Home() {
  const overview = await getPopulationOverview();
  return <main className="page planner-page" id="main">
    <header className="site-header"><Link className="wordmark" href="/" aria-label="숨맵 처음으로">숨맵<span className="brand-dot" /></Link>
      <span className="edition">서울 산책 안내서 <span>한강 편</span></span>
      <Link className="header-link" href="/data" prefetch={false}>자료와 출처 <span aria-hidden="true">↗</span></Link>
    </header>
    <section className="hero"><div className="hero-copy"><p className="eyebrow">서울 산책 안내서 · 가고 싶은 마음은 그대로</p>
      <h1>계획은 조금만,<br /><span>산책은 더 느긋하게.</span></h1>
      <p className="lead">지키고 싶은 약속은 그대로.<br />덜 붐비게 나갈 방법을 찾아요.</p>
      <p className="hero-caption">한강공원 5곳 · 도착부터 머무는 시간까지</p></div><WalkArt />
    </section>
    <ManualPlanner overview={overview} mobilityReady={Boolean(process.env.TMAP_API_KEY?.trim())} />
    <footer className="site-footer"><div><span className="wordmark">숨맵</span><p>멀리 바꾸지 않아도, 조금 더 느긋한 외출.</p></div>
      <details><summary>알아두면 좋은 점</summary>
        <p>현재 여의도·반포·뚝섬·망원·난지한강공원의 산책을 비교해요. 혼잡도는 공원 단위 추정값이며, 세부 산책로의 사람 수나 소음·안전성을 나타내지 않아요. 표본 사이의 혼잡은 달라질 수 있습니다.</p>
        <p>출처: <a href="https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do" target="_blank" rel="noreferrer">서울특별시 실시간 인구데이터</a> · 공공누리 제1유형. 원자료를 숨맵 형식으로 변환하고 인접 예측의 인구 범위만 참고 보간합니다.</p>
        <p><Link href="/about">서비스·개인정보·데이터 안내</Link> · <Link href="/data" prefetch={false}>공원별 원자료 확인</Link></p>
      </details>
      <details><summary>홈 화면에 추가하기</summary><p>iPhone Safari: 공유 → 홈 화면에 추가. Android Chrome: 메뉴 → 홈 화면에 추가 또는 앱 설치.</p><p className="note">설치 없이 웹으로 사용할 수 있어요. 최신 자료에는 인터넷이 필요하며, 브라우저와 홈 화면 앱의 저장 공간은 다를 수 있습니다.</p></details>
      <MotionPreference /><p className="colophon">SOOMMAP · SEOUL, 2026</p>
    </footer>
  </main>;
}
