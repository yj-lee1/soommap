# 숨맵 · soommap

내 조건을 지키며 덜 붐비는 외출 계획을 찾고 조정하는 웹 서비스.

현재 **0단계: 개발 환경·실제 연동·검수 배포 확인 완료, 사용자 검수 대기**입니다. 실제 공원 데이터나 AI 추천을 제공하는 완성 서비스가 아닙니다.

- [0단계 검수 보고·공개 URL](docs/reviews/stage-0.md)
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
npm run build
```

각 단계의 자체 확인을 마친 뒤 사용자 검수를 받고 다음 단계로 진행합니다.
