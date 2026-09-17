import { ServerCheck } from "@/components/server-check";

export default function Home() {
  return (
    <main className="page">
      <header>
        <p className="eyebrow">개발 검수용 · 0단계</p>
        <h1>숨맵</h1>
        <p className="lead">내 조건에 맞는, 덜 붐비는 외출 계획.</p>
      </header>

      <section aria-labelledby="setup-title" className="panel">
        <h2 id="setup-title">서비스 연결을 준비하고 있어요</h2>
        <p>
          현재는 웹 실행과 외부 서비스 연결을 확인하는 단계입니다.
          공원 혼잡 정보와 AI 추천은 아직 제공하지 않습니다.
        </p>
        <dl>
          <div><dt>첫 비교 대상</dt><dd>한강공원 5곳 · 산책</dd></div>
          <div><dt>다음 기능</dt><dd>실제 혼잡 정보와 방문 시각 비교</dd></div>
        </dl>
        <ServerCheck />
      </section>

      <p className="note">화면 스타일은 기능 검수 후 일괄 적용합니다.</p>
    </main>
  );
}
