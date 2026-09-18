# 숨맵 시각 방향 검토 소스

`two-directions.html`은 2026-09-19의 시각 방향 검토용 HTML fragment다. 앱 경로에 연결하지 않았다. 모든 혼잡·인구·판정·시간은 fixture이며 운영 데이터가 아니다. 두 모바일 안과 조건 고정/시간 탐색/실행 카드의 동작을 비교한다. URL·위치 권한·서울시/OpenAI/TMAP 호출은 하지 않는다. 정적 Google Fonts와 D3만 로드한다.

Codex의 대화 내 미리보기에서 사용한다. 아이콘과 선택적 Tweak 도구는 해당 미리보기 환경에서 제공되며, 미지원 환경에서도 글자 라벨과 주요 동작은 유지된다. 일반 HTML 문서로 쓰려면 문서 래퍼가 필요하다. 서비스 배포/브라우저 저장 기능은 없다.

## 지도 자료 출처

- 서울 구 경계: [southkorea/seoul-maps](https://github.com/southkorea/seoul-maps), [KOSTAT 2013 단순화 GeoJSON](https://github.com/southkorea/seoul-maps/blob/master/kostat/2013/json/seoul_municipalities_geo_simple.json). 저장소가 명시한 원자료는 통계청 KOSTAT 2013이며 라이선스는 Apache 2.0이다. [라이선스 사본](licenses/Apache-2.0.txt)을 포함했다. 좌표 소수점을 5자리로 줄여 fragment에 포함하고 D3 Mercator로 투영했다. 원본과 다른 표시 색상/스타일을 적용했다. **2013 자료이며 현재 행정 경계나 상세 경로 자료로 쓰지 않는다.**
- 한강공원 집계 영역: 이 프로젝트의 [공식 집계 영역 GeoJSON](../../../public/data/hangang-boundaries.geojson)을 재사용했다. 해당 파일의 출처·확인일 속성을 함께 보존했다. 지도상의 공원 영역은 혼잡 집계 범위이며 실제 보행 동선이 아니다.
- 공원 표시 좌표: 기존 장소 데이터의 여의도·반포 displayCoordinate 재사용. 경로 선을 추정해서 그리지 않는다. 실제 TMAP·외부 지도는 기존 앱의 accessPoint 계약을 유지한다.
- 출발역·안내센터 이름은 검토 흐름의 예시다. 지리 배경만 공개 자료이며, 인구·혼잡 수치를 실제 자료로 오해하지 않도록 화면에 표시한다.

D3 7.9.0과 Noto Sans/Serif KR은 CDN에서 로드하며 원본 라이브러리/서체 파일을 이 폴더에 배포하지 않는다. Design Spells는 동작 참고만 했으며 영상·이미지·코드를 복사하지 않았다. 상세 사례와 검수 결과는 [시각 방향 검토](../stage-6-visual-directions.md)를 참조한다.
