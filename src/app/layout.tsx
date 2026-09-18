import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Noto_Serif_KR } from "next/font/google";
const editorial = Noto_Serif_KR({ weight: "500", subsets: ["latin"], display: "swap", preload: false, variable: "--font-editorial" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "https://soommap-review-yeongjis-projects-f12fc56b.vercel.app"),
  title: "숨맵 — 계획은 조금만, 산책은 더 느긋하게",
  description: "원래 계획을 가능한 한 유지하며 덜 붐비는 한강 산책을 찾아요. 도착·체류 시간대의 혼잡 예측을 비교하고, 고른 계획은 지도 길찾기로 이어집니다.",
  openGraph: { title: "숨맵 — 계획은 조금만, 산책은 더 느긋하게", description: "내 조건을 지키며 덜 붐비는 한강 산책을 찾아요.", images: [{ url: "/images/soommap-cover.png", width: 1200, height: 630 }], locale: "ko_KR", type: "website" },
  twitter: { card: "summary_large_image", images: ["/images/soommap-cover.png"] },
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "숨맵", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-180.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f8f7f2" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={editorial.variable}><a href="#main" className="skip-link">본문으로 건너뛰기</a>{children}</body>
    </html>
  );
}
