# 숨맵 운영·복구 인계

2026-09-19. 공개 베타 / Vercel Hobby / TMAP Free.

## 공개 주소와 배포

- 제출·체험 주소: https://soommap-review-yeongjis-projects-f12fc56b.vercel.app/
- A안 통합 앱 코드: `2a3c083`, 라이선스·안내 포함 배포 코드: `60b2eb8`. 개발 브랜치 `feat/editorial-experience`, 기본 브랜치에도 완료 코드를 반영한다.
- 검증한 불변 배포: https://soommap-jpqn03x17-yeongjis-projects-f12fc56b.vercel.app/
- 배포 ID: `dpl_3a4wXHYbE5P4EZq7U5RFT1bFT3A4`, Preview READY.
- 이전 기능판 복구 주소: https://soommap-oeg7srice-yeongjis-projects-f12fc56b.vercel.app/

공개 체험 URL은 로그인 없이 HTTP 200이며 로컬 개발 서버와 무관하게 동작한다. ‘Production 배포’라고 부르지 않는다. 별도 Production 키/환경을 새로 만들지 않았다. Preview의 이미 검증한 연결을 재사용한다. 계정 플랜·유료 기능을 변경하지 않았다.

## 예산/환경

키는 로컬 `.env.local`과 Vercel Preview 환경변수에만 있다. 이름/설정 방법은 `.env.example`과 환경 문서를 참고한다. 값은 문서에 기록하지 않는다.

- OpenAI 모델 `gpt-5.6-terra`, 총 $20. 9/19 실제 통합 1흐름 2회 후 보수적 원장 $0.099849, usage 누적 추정 $0.050465. 이번 증가 $0.009624. 초기 보수 예약액 때문에 두 값이 다르다.
- TMAP `free`: 9/19 최종 통합 5건/10건, 실제 요금 0원. 내부 누적 예약 17원은 실제 청구액이 아니다. 5곳 새 비교를 한 번 더 할 수 있는 잔량이며 다른 사용으로 달라질 수 있다.
- 예산·빈도·중복·TTL은 기존 Upstash Free Redis에서 제어한다. 원장을 초기화/삭제하지 않는다. Redis 오류 시 호출을 막고 수동 비교로 안내한다.
- 비용 읽기: `node --conditions=react-server scripts/ai-budget.mjs`, `node --conditions=react-server scripts/transit-budget.mjs status`.
- 유료 전환/다른 모델 fallback/추가 AI 서비스 금지. 종량제에 관한 이전 승인은 최신 ‘Free 유지’ 결정으로 중단됐다.

## 수정·재배포

표준 `npm run check`, `npm test`, `npm run build`를 사용한다. fixture를 실제 배포에 주입하지 않는다. `.local`, `.env*`, tests는 배포 제외다. 설치된 Vercel CLI로 Preview 배포 후 헬스/홈을 확인하고 alias를 새 불변 URL에 연결한다. 환경변수 변경만으로 기존 배포가 바뀌지 않으므로 필요한 경우 새 Preview를 배포한다.

```sh
vercel deploy --yes
vercel alias set <새-불변-Preview-주소> soommap-review-yeongjis-projects-f12fc56b.vercel.app
```

복구는 alias를 위의 이전 정상 불변 배포 주소로 되돌린다. 같은 alias를 유지하면 사용자의 브라우저 저장 origin을 유지한다. 저장 스키마를 바꾸지 않았다. 과거 예측·이동시간을 최신 정보로 복원하지 않는다.

## 유지 기간과 남은 검수

심사 기간 2026-09-21~10-17 동안 공개 주소·환경변수·무료 서비스 계정을 유지해야 한다. 상시 프로세스나 예약 작업은 사용하지 않는다. 자동 감시/알림은 별도 요청이 없어 설정하지 않았다. 무료 공급자 한도와 장애로 자동 기능이 일시 중단될 수 있다.

실제 기기 GPS 권한 거절, 카카오 앱 설치/미설치, PWA 설치와 첫 사용자 관찰은 미완료다. 네이버 앱 연결은 사용자가 성공 확인한 기록을 재사용한다. 최종 추천은 실제 방문 시 현장 상태나 운행을 보장하지 않는다.

원티드 최종 제출 버튼은 누르지 않는다. 현재 임시저장은 심사 제출 완료가 아니며 마감 전에 사용자 확인이 필요하다. 이미지 첨부가 남으면 최종 진행 기록에 명시한다.

## 원티드 현재 상태

제목·문제·429자 AI 활용 설명·공개 URL과 Next.js/React/ChatGPT/Vercel 태그를 임시저장하고 새로고침으로 보존을 확인했다. 최종 제출은 미실행. 대표 이미지와 실제 스크린샷 4장은 로컬에 완성했지만 Chrome 확장 파일 접근 제한으로 첨부하지 못했다. 일반 파일 선택창 대안은 Mac 잠금으로 중단되어 사용자 잠금 해제 또는 확장 파일 접근 설정 응답을 기다린다. 설정 승인으로 추정해 보안 설정을 바꾸지 않았다. 이미지 없이 제출 준비 완료라고 주장하지 않는다.
