import { ConditionsError } from "./conditions.ts";
import type { Place } from "./types.ts";

export interface Origin { name: string; latitude: number; longitude: number; source: "geolocation" | "station" }
export interface TransitRoute {
  placeId: string; accessPointId: string; totalSeconds: number; walkingSeconds: number; transfers: number;
  arrivalAt: string; fetchedAt: string;
}
export interface TransitContext {
  origin: Origin; departureAt: string; expiresAt: string; routes: TransitRoute[];
  unavailable: Array<{ placeId: string; reason: string }>;
}
export interface TransitBundle { context: TransitContext; token: string }

export function parseOrigin(value: unknown): Origin {
  if (!value || typeof value !== "object") throw new ConditionsError("출발지를 선택해주세요.");
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 80 || /[\u0000-\u001f]/.test(v.name) ||
    typeof v.latitude !== "number" || !Number.isFinite(v.latitude) || v.latitude < 33 || v.latitude > 39 ||
    typeof v.longitude !== "number" || !Number.isFinite(v.longitude) || v.longitude < 124 || v.longitude > 132 ||
    (v.source !== "geolocation" && v.source !== "station")) throw new ConditionsError("국내 출발지 이름과 좌표를 확인해주세요.");
  return { name: v.name.trim(), latitude: v.latitude, longitude: v.longitude, source: v.source };
}
export function routeReasons(context: TransitContext, place: Place, at: string, now: number): string[] {
  if (Date.parse(context.expiresAt) <= now) return ["이동시간 확인 후 5분이 지났어요. 출발 기준을 새로 계산해주세요."];
  const route = context.routes.find(r => r.placeId === place.id && r.accessPointId === place.accessPoint.id);
  if (!route) return [context.unavailable.find(r => r.placeId === place.id)?.reason ?? "이 장소의 이동시간을 확인하지 못했어요."];
  return route.arrivalAt === at ? [] : ["지금 출발 기준으로 계산한 도착시각과 달라요. 시간 고정을 해제하거나 직접 도착시각 모드로 비교해주세요."];
}

/** Coordinates are WGS84; route calculation and both handoffs share this access point. */
export function navigationLinks(origin: Origin, place: Place, appUrl: string) {
  const end = place.accessPoint.coordinate, endName = `${place.name} ${place.accessPoint.name}`;
  const params = new URLSearchParams({ slat: String(origin.latitude), slng: String(origin.longitude), sname: origin.name,
    dlat: String(end.latitude), dlng: String(end.longitude), dname: endName, appname: appUrl }).toString().replace(/\+/g, "%20");
  const naver = `nmap://route/public?${params}`;
  const kakaoParams = new URLSearchParams({ sp: `${origin.latitude},${origin.longitude}`, ep: `${end.latitude},${end.longitude}`, by: "publictransit" });
  return {
    naver, naverAndroid: `intent://route/public?${params}#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end`,
    naverIosStore: "https://apps.apple.com/app/id311867728",
    naverAndroidStore: "https://play.google.com/store/apps/details?id=com.nhn.android.nmap",
    kakao: `kakaomap://route?${kakaoParams}`,
    kakaoWeb: `https://map.kakao.com/link/by/traffic/${encodeURIComponent(origin.name)},${origin.latitude},${origin.longitude}/${encodeURIComponent(endName)},${end.latitude},${end.longitude}`,
  };
}
