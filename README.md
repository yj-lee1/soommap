# 숨맵 · soommap

내 조건을 지키며 덜 붐비는 외출 계획을 찾고 조정하는 웹 서비스.

현재 **2단계 보완: 수동 조건·도착시각 정렬·체류 구간 평가**까지 구현했습니다. 시각 사이의 인구는 숨맵 추정으로 구분하며, 공식 혼잡 단계와 원시 근거를 보존합니다. 자연어 AI·교통 API·디자인은 이후 단계입니다.

- [2단계 검수 보고·공개 URL](docs/reviews/stage-2.md)
- [추천 규칙·지연 예측 정책](docs/recommendation-engine.md)
- [도착·체류 정렬 정책과 검증](docs/temporal-alignment.md)
- [데이터 구조·캐시·품질 정책](docs/data-foundation.md)
- [실행 계획](docs/soommap-execution-plan.md)
- [진행·검수 기록](docs/soommap-progress.md)
- [환경 설정](docs/environment-setup.md)
- [제품 기획](docs/soommap-hackathon-plan.md)

## 개발

Node.js 24와 npm을 사용합니다.

```sh
npm ci
npm run dev
```

비밀값은 `.env.example`을 참고해 `.env.local`에 설정합니다. 저장소에는 키를 올리지 않습니다.

```sh
npm run check
npm test
npm run build
```

각 단계의 자체 확인을 마친 뒤 사용자 검수를 받고 다음 단계로 진행합니다.

`npm test`는 고정 fixture와 모의 통신만 사용합니다. 실제 OpenAI 검사를 반복 실행하지 않습니다. Vercel Hobby의 Preview를 검수에 사용하며, Production 환경변수와 배포는 별도로 관리합니다.
