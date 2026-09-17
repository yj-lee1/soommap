import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "숨맵 — 외출 계획",
  description: "내 조건을 지키며 덜 붐비는 외출 계획을 찾고 조정하는 서비스.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
