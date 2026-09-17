"use client";
import { useEffect, useRef, useState } from "react";
import { navigationLinks, type Origin } from "@/lib/domain/mobility";
import type { Place } from "@/lib/domain/types";

export function NavigationActions({ origin, place }: { origin: Origin; place: Place }) {
  const [fallback, setFallback] = useState<"naver" | "kakao" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
    const hidden = () => { if (document.visibilityState === "hidden") cancel(); };
    window.addEventListener("pagehide", cancel); document.addEventListener("visibilitychange", hidden);
    return () => { cancel(); window.removeEventListener("pagehide", cancel); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  // Used only after hydration/click; official appname identifies this web service.
  const links = navigationLinks(origin, place, typeof window === "undefined" ? "https://soommap.vercel.app" : window.location.origin);
  function launch(provider: "naver" | "kakao") {
    if (timer.current) clearTimeout(timer.current);
    setFallback(null);
    const android = /Android/i.test(navigator.userAgent), ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!android && !ios) {
      if (provider === "kakao") window.open(links.kakaoWeb, "_blank", "noopener,noreferrer");
      else setFallback("naver");
      return;
    }
    timer.current = setTimeout(() => { if (document.visibilityState === "visible") setFallback(provider); }, 1800);
    window.location.href = provider === "kakao" ? links.kakao : android ? links.naverAndroid : links.naver;
  }
  return <div className="navigation-actions">
    <p><strong>{origin.name} → {place.accessPoint.name}</strong><br />대중교통 길찾기 · 출발지와 목적지를 자동 입력해요.</p>
    <div className="action-row"><button onClick={() => launch("naver")}>네이버지도로 길찾기</button><button onClick={() => launch("kakao")}>카카오맵으로 길찾기</button></div>
    {fallback && <div className="notice" role="status"><p>{fallback === "naver" ? "네이버 길찾기는 모바일 지도 앱으로 연결합니다. 앱이 열리지 않았다면 설치 후 다시 눌러주세요." : "카카오맵 앱이 열리지 않았다면 아래 공식 웹 길찾기를 이용해주세요."}</p>
      {fallback === "naver" && <div className="action-row"><a href={links.naverIosStore} target="_blank" rel="noreferrer">네이버지도 iOS 설치</a><a href={links.naverAndroidStore} target="_blank" rel="noreferrer">네이버지도 Android 설치</a></div>}
      <a href={links.kakaoWeb} target="_blank" rel="noreferrer">출발·도착지가 입력된 카카오맵 웹 길찾기</a>
    </div>}
    <p className="note">모바일은 앱 연결을 먼저 시도해요. 설치 여부를 웹에서 확정할 수는 없어요. 지도 앱은 현재 시점에 경로를 다시 계산하므로 숨맵 예상시간과 달라질 수 있습니다.</p>
    <details><summary>도착 기준 지점</summary><p>공원 내부의 공식 안내센터를 대표 접근 지점으로 사용합니다. 공원 경계·가장 가까운 출입구와는 다를 수 있어요.</p><a href={place.accessPoint.sourceUrl} target="_blank" rel="noreferrer">서울시 공식 시설 위치 확인</a></details>
  </div>;
}
