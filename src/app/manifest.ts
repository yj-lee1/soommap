import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "숨맵 — 덜 붐비는 외출", short_name: "숨맵", lang: "ko",
    description: "내 조건을 지키며 덜 붐비는 외출 계획을 찾고 조정해요.",
    start_url: "/", scope: "/", display: "standalone", background_color: "#f8f7f2", theme_color: "#f8f7f2",
    icons: [192, 512].map(size => ({ src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" })),
  };
}
