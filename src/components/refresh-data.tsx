"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshData() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="refresh-control">
    <button disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? "자료 확인 중…" : "자료 다시 확인"}
    </button>
    <span role="status" aria-live="polite" className="note">
      {pending ? "기존 자료를 유지하며 확인하고 있어요." : "서울시 갱신 주기에 따라 같은 자료가 보일 수 있어요."}
    </span>
  </div>;
}
