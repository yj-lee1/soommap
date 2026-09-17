# 이동시간 계산과 최종 길찾기 연결 계획

2026-09-17 사용자가 출발지 재입력 없이 최종 선택 후 지도 앱으로 이어지는 흐름을 요청했다. 3단계 AI → 4단계 조건 조정·선택 → 4.5단계 이동시간·실행 연결 → 5단계 보조 기능 순으로 진행하며 각 단계에서 검수를 받는다.

## 역할과 데이터

- TMAP: 서버에서 대중교통 예상 이동시간을 계산한다. 후보별 도착시각을 기존 시간 정렬·체류 평가에 전달한다.
- 네이버지도·카카오맵: 사용자가 계획을 확정하고 버튼을 누른 이후 상세 길찾기로 넘긴다. 후보 카드마다 지도 버튼을 반복하지 않는다.
- 출발지는 좌표·이름·획득 방식(현위치/직접 선택)을 한 번 보관해 계산과 최종 링크가 공유한다. 현재 위치 사용은 사용자 동작·권한 허용 후 수행한다.
- 지도 표시점과 실제 접근 지점을 분리한다. 표시용 중심점을 임의로 공원 입구로 취급하지 않는다.

```ts
type Coordinate = { latitude: number; longitude: number };
type AccessPoint = {
  id: string;
  name: string;
  coordinate: Coordinate;
  sourceUrl: string;
  verifiedAt: string;
};
type PlaceRouting = {
  displayCoordinate: Coordinate;
  accessPoint: AccessPoint | null;
};
type Origin = { name: string; coordinate: Coordinate; source: "geolocation" | "selection" };
type RouteContext = {
  origin: Origin;
  destination: AccessPoint;
  mode: "public-transit";
};
```

기존 `displayPoint`는 연결 단계에서 `displayCoordinate`로 이전한다. `accessPoint`는 공식 접근 안내와 실제 좌표를 검증한 뒤 채운다. TMAP 요청과 외부 링크는 동일한 `RouteContext.destination`을 전달받는다. 계획 확정 시 좌표·이름을 스냅샷으로 고정하며 장소 변경 시 오래된 경로를 재사용하지 않는다.

## 공식 연결 규격 확인

- 네이버: `nmap://route/public`에 slat/slng/sname/dlat/dlng/dname/appname. 이름은 URL 인코딩, appname은 웹 URL. Android는 공식 Intent 형식과 설치 연결, iOS는 앱 스킴과 설치 안내를 사용한다. [공식 문서](https://guide.ncloud-docs.com/docs/application-maps-url-scheme-vpc)
- 카카오 앱: `kakaomap://route?sp=위도,경도&ep=위도,경도&by=publictransit`. 공식 스킴 문서에는 이름 파라미터가 없으므로 임의 파라미터를 추가하지 않는다. 이름은 숨맵 확정 요약과 공식 웹 링크에 보존한다. [공식 스킴](https://apis.map.kakao.com/ios_v2/docs/getting-started/urlscheme/)
- 카카오 웹: `https://map.kakao.com/link/by/traffic/이름,위도,경도/이름,위도,경도`. 출발·도착 이름과 좌표를 사전 입력한다. [공식 웹 가이드](https://apis.map.kakao.com/web/guide/)

모바일 앱 설치 여부를 웹에서 확실히 알아낼 수 있다고 가정하지 않는다. 사용자 클릭으로 앱 열기를 시도하고 visibility/pagehide 시 fallback 타이머를 해제해 앱 이동 뒤 설치 안내가 덮어쓰지 않도록 한다. 실패 시 공식 웹 또는 명시적인 설치 안내·재시도 선택을 제공한다. 무조건 성공했다고 표시하지 않는다.

네이버의 앱 길찾기 파라미터는 공식 확인 완료. 임의 조합한 PC 경로 URL을 공식 규격으로 취급하지 않는다. PC에서 양쪽 위치를 보존하는 공식 웹 연결의 가용성은 4.5단계 검증 항목이며, 확인되지 않으면 앱 설치/열기 안내와 카카오 공식 웹 경로를 제공하고 제한을 보고한다. Android/iOS 앱 설치/미설치의 실제 검증은 사용 가능한 기기에 따라 사용자 확인이 필요할 수 있다.

## 단계별 완료 조건

1. 3단계: 실제 자연어 해석·근거 설명, 금액/횟수 제한. 위치 좌표는 LLM에 전달하지 않는다.
2. 4단계: 시간 미정·목적지 미정, 고정·해제·제외·선택 확정. 조건 변경과 확정 상태를 구분한다.
3. 4.5단계: 접근 지점 검증 → 출발지 확보/선택 → TMAP 서버 계산 → 도착·체류 평가 → 최종 확정 후 두 길찾기 버튼. 좌표 순서·인코딩·이동수단·동일 지점·오래된 계획·권한 거절·앱 미설치·API 장애를 검사한다.
4. 5~6단계: 위 기능을 유지하면서 그래프·지도·디자인 적용. 장소 확대·3D보다 이동 연결을 우선한다.

TMAP 키·유료 종량제 사용 한도는 실제 연결 전에 요청한다. 무료/유료 정책을 확인했더라도 별도 유료 사용을 자동 승인으로 해석하지 않는다. API 연결 실패 시 정확한 도착시각을 필수로 되돌리지 않고, 방문 희망 시간대와 ‘이동시간 미반영’을 사용한다. 외부 지도는 자체 경로·소요시간을 다시 계산할 수 있으므로 TMAP과 동일 경로/시간을 보장하지 않는다.
