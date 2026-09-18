# 숨맵 · soommap

원래 계획을 가능한 한 유지하면서 덜 붐비는 한강 산책 대안을 찾는 AI 웹 서비스.

[공개 체험](https://soommap-review-yeongjis-projects-f12fc56b.vercel.app/) · [최종 경험 검수](docs/reviews/final-experience-review.md) · [제출 자료](docs/submission/wanted-draft.md)

## 사용자 흐름

자연어 계획 → 출발역/현재 위치 → 실제 이동시간과 도착·체류 혼잡 비교 → 장소·시간 고정 및 재추천 → 계획 확정 → 네이버지도/카카오맵 길찾기. 같은 브라우저에서 입력·출발지·선택 계획을 7일간 이어볼 수 있습니다.

현재 여의도·반포·뚝섬·망원·난지한강공원 5곳의 산책을 지원합니다. AI는 조건 구조화와 근거 설명을 담당하고 조건 검사·정렬·시각 정렬은 코드가 수행합니다. 공식 혼잡 단계는 보간하지 않습니다. 인구 범위만 ‘숨맵 추정’으로 구분하며, 예측 공백과 오래된 자료는 임의로 채우지 않습니다.

## 개발

Node.js 24와 npm을 사용합니다.

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
```

비밀값은 `.env.example`을 참고해 `.env.local`에 설정합니다. 키를 저장소·클라이언트·로그에 넣지 않습니다. `npm test`는 fixture/mock을 사용합니다. 실제 유료 API 시험은 별도 실행합니다.

표준 Next.js 구조이며 Vercel Hobby의 고정 공개 Preview를 사용합니다. Production에는 별도 키를 구성하지 않았습니다. OpenAI는 `gpt-5.6-terra`, 공유 atomic 예산 $20입니다. TMAP은 Free 하루 10건을 서비스 전체가 함께 사용하며 한도 도달 시 수동 시간대 비교를 제공합니다. 유료 전환하지 않았습니다.

## 문서

- [운영·복구 인계](docs/release-handoff.md)
- [도착·체류 정렬 정책](docs/temporal-alignment.md)
- [추천 규칙](docs/recommendation-engine.md)
- [AI 예산·중복·빈도 제어](docs/ai-runtime.md)
- [이동·길찾기 설계](docs/mobility-plan.md)
- [실행 계획](docs/soommap-execution-plan.md), [진행 기록](docs/soommap-progress.md)
- [환경 설정](docs/environment-setup.md)
- [Noto Serif KR 폰트 라이선스](public/licenses/NotoSerifKR-OFL.txt)

원티드 요청 범위는 임시저장까지이며 최종 제출은 하지 않습니다. 실제 휴대폰 전체 흐름·카카오 설치/미설치·첫 사용자 관찰은 별도 미완료 항목입니다.
