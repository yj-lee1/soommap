"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="page"><h1>자료를 표시하지 못했어요</h1><p>일시적인 오류입니다. 잠시 후 다시 시도해주세요.</p><button onClick={reset}>다시 확인</button></main>;
}
