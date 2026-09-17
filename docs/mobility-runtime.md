# 4.5단계 이동시간·길찾기 구현

2026-09-17. 개발 브랜치 `feat/transit-arrival-and-map-handoff`. TMAP 키 설정 완료. 최신 사용자 선택에 따라 Free 하루 10건으로 Preview 실제 연결을 검증한다. 종량제는 추후 전환 지시 전까지 사용하지 않는다. 기존 서울·OpenAI·Redis·Vercel 설정은 재사용한다.

## 동작

- 현재 위치(명시적 버튼·브라우저 권한) 또는 출발역 검색. 서울시 역사마스터 784건을 로컬 검색하며 외부 지오코딩 API를 추가하지 않았다. 역 대표 좌표이므로 출구 좌표는 아니다. 현재 위치 권한 거부·실패 시 출발역 검색을 안내한다.
- 자동 모드: 사용자가 선택한 ‘지금 출발’을 서버 시간으로 기록 → TMAP 대중교통 요약 응답의 버스/지하철 경로 중 최소 소요시간 → 도착 분 단위 올림 → 기존 인접 서울 예측 정렬·체류 평가. 소요시간에는 TMAP의 도보 시간이 포함된다.
- 미래 출발시각의 소요시간은 보장하지 않는다. TMAP의 `searchDttm`은 운행 여부 확인용이며 미래 소요시간 예측이라는 근거가 없으므로 사용하지 않는다. 시간표·현재 운행과 상세 경로는 최종 지도 앱에서 다시 확인한다.
- 정확한 도착 고정·허용 시간대와 계산된 ETA가 충돌하면 제외한다. 버튼 조정은 기존 ETA 근거를 재사용하며 자동으로 시간 조건을 풀거나 새로운 ETA를 계산하지 않는다.
- 경로 실패·예측 범위 밖·체류 구간 부족은 이유와 함께 제외한다. 시간이나 인구를 외삽하지 않는다. 교통 연결·예산 제한 시 사용자가 직접 도착시각 모드를 선택할 수 있고 출발지는 유지된다.
- 확정 전 후보 카드에는 지도 버튼 없음. 확정 후 같은 출발지와 같은 `accessPoint`를 네이버·카카오에 전달한다. 새 출발지 선택은 이전 결과·확정을 해제한다. 출발 위치는 현재 탭에서만 유지한다.
- `displayCoordinate`는 서울시 장소 경계 내부의 표시 좌표. `accessPoint`는 서울시 한강 공식 시설 자료에서 검증한 공원 안내센터. 공원 경계나 가장 가까운 출입구라고 표현하지 않는다. TMAP 목적 좌표와 지도 링크 목적 좌표는 동일하다.

## 서버와 사용량

`src/lib/server/transit.ts`만 TMAP 키를 사용한다. 고정 HTTPS URL, 서버 fetch, 8초 timeout, redirect 차단, 자동 재시도 없음. 호출 전 같은 Redis에서 atomic Lua로 예약한다.

- 사용자 승인: TMAP 개발·검수 총 5,000원. OpenAI $20와 별도.
- 공식 요약 단가 0.55원/건. VAT·과금 불확실성을 포함해 서버에서는 **호출당 1원**을 보수적으로 예약하고 반환하지 않는다. 실패·시간 초과도 차감한다. 실제 청구액과 예약액은 다르다. 이 서버를 통하지 않은 계정의 다른 사용량은 포함할 수 없으므로 전용 앱 키를 사용한다.
- 총 예약액 최대 5,000원. `TMAP_BILLING_MODE=free` 기본 하루 10건, 계정 종량제 신청 뒤 `paid`이면 하루 1,000건. 하루 기준 Asia/Seoul. 사용자 3회/분·IP 6회/분의 신규 계산 한도. Preview들 사이에서도 같은 장부를 공유한다. Production 키는 별도 구성 전 비워 둔다.
- 장부 초기화는 `node --conditions=react-server scripts/transit-budget.mjs init` 1회. SET NX이므로 기존 예약액 보존. 장부가 없거나 Redis 장애면 외부 호출 전에 중지. 상태 확인은 같은 명령의 `status`.
- 출발지·대상 지점 묶음마다 세션별 HMAC 캐시 키, AES-GCM 암호화된 결과를 180초 저장. 오류 결과도 저장해 재시도 폭주를 줄인다. 좌표·이름은 Redis 키/로그에 기록하지 않는다. 다른 세션 결과를 공유하지 않는다.
- 동일 요청은 Redis NX 잠금 30초로 중복 차단. 완료된 계산은 세션에 묶인 암호화 토큰으로 5분 유효. 추천·선택 API는 토큰 인증·만료를 확인하며 클라이언트 소요시간을 신뢰하지 않는다. 조건 버튼 조정은 TMAP·AI 추가 호출 없이 처리한다.
- 좌표는 AI context에 넣지 않는다. 기존 모델 `gpt-5.6-terra`·Structured Outputs·최대 2회 구조 유지. AI는 코드가 계산한 이동시간과 근거 문장만 설명에 사용한다.

## 공식 지도 연결

- NAVER: `nmap://route/public`, Android 공식 intent. 출발·도착 좌표와 이름, 필수 appname 전달. 웹에서 앱 설치 여부를 확정할 수 없으므로 사용자 클릭 후 앱을 시도하고, visibility/pagehide 시 fallback 타이머를 취소한다. 데스크톱 또는 연결 실패 시 공식 앱 설치 안내 제공. 공식 문서에서 검증한 PC용 출발/도착 자동 입력 URL이 없으므로 임의 URL을 만들지 않았다.
- Kakao: 앱 `kakaomap://route?sp=...&ep=...&by=publictransit`, 웹 `https://map.kakao.com/link/by/traffic/출발이름,위도,경도/도착이름,위도,경도`. 앱 scheme은 이름 매개변수가 공식 문서에 없으므로 좌표만 전달하고, 웹에는 좌표와 이름을 모두 전달한다.
- 모바일 앱 설치/미설치 동작은 실제 iOS·Android 기기 검수가 필요하다. 데스크톱 카카오 웹에서 서울역 → 반포안내센터 및 대중교통 선택은 실제 확인했다.

## 출처

- [TMAP 상품·요금](https://transit.tmapmobility.com/), [요약 API](https://transit.tmapmobility.com/docs/routes/sub), [이용 가이드](https://transit.tmapmobility.com/guide), [이용 조건](https://transit.tmapmobility.com/terms): 취득 데이터 24시간 이상 경과 후 이용 금지. 런타임 캐시는 3분, 토큰은 5분이다.
- [NAVER 공식 URL Scheme](https://guide.ncloud-docs.com/docs/application-maps-url-scheme-vpc)
- [Kakao 앱 Scheme](https://apis.map.kakao.com/ios_v2/docs/getting-started/urlscheme/), [공식 웹 지도 링크](https://apis.map.kakao.com/web/guide/)
- [서울시 역사마스터](https://data.seoul.go.kr/dataList/OA-21232/S/1/datasetView.do): 2026-09-12 기준 784개 역 레코드, 공공누리 제1유형. 역명·노선·좌표만 정적 저장.
- [서울시 한강 시설 지도](https://hangang.seoul.go.kr/www/facility/map.tab): 여의도 9818, 반포 9816, 뚝섬 9814, 망원 9820, 난지 9821 안내센터의 이름·위경도·운영 여부를 2026-09-17 확인. 개별 출처 URL과 확인일은 places.json에 기록. 사진·설명 저작물은 복제하지 않았다.
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): 기존 strict schema 방식 유지.
