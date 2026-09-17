"use client";

import { useState } from "react";

export function ServerCheck() {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function check() {
    setState("loading");
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("unavailable");
      const payload: unknown = await response.json();
      if (
        typeof payload !== "object" || payload === null ||
        !("status" in payload) || payload.status !== "ok" ||
        !("service" in payload) || payload.service !== "soommap"
      ) throw new Error("invalid_response");
      setState("success");
    } catch {
      setState("error");
    }
  }

  return (
    <div>
      <button type="button" onClick={check} disabled={state === "loading"}>
        {state === "loading" ? "확인 중…" : "웹 서버 연결 확인"}
      </button>
      <p aria-live="polite" className="check-result">
        {state === "success" && "웹 서버가 정상 응답했습니다. 외부 API 연결은 별도로 확인합니다."}
        {state === "error" && "서버 응답을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요."}
      </p>
    </div>
  );
}
