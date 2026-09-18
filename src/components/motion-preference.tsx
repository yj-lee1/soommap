"use client";
import { useEffect, useState } from "react";
export function MotionPreference() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduced);
    return () => { delete document.documentElement.dataset.reduceMotion; };
  }, [reduced]);
  return <label className="checkbox motion-preference"><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} />화면 동작 줄이기<span className="sr-only">기기의 동작 줄이기 설정도 자동으로 따릅니다.</span></label>;
}
