# 0단계 환경 설정

현재 단계에서는 외부 API 인증과 배포 연결만 확인한다. 공원 데이터 목록·추천 엔진·제품 AI 해석은 다음 단계의 검수 범위다.

## 로컬 실행

Node.js 24와 npm을 사용한다. `npm ci`, `npm run dev`로 시작한다. 기본 로컬 주소는 `http://127.0.0.1:3000`이다. `npm run check`는 타입·린트, `npm run build`는 배포 빌드를 확인한다.

현재 Next.js 16.3.5의 React·접근성 검사 플러그인은 ESLint 10과 호환되지 않아 ESLint 9.39.5를 고정한다. 설치 시 지원 종료 안내가 발생할 수 있다. 이는 개발 검사 도구의 제약이며, 추후 Next.js 검사 플러그인의 호환 버전이 나오면 함께 올린다.

## GitHub 연결

`origin`의 fetch 주소는 사용자가 지정한 SSH 주소다. 현재 기본 SSH 인증 계정에는 쓰기 권한이 없어, push 주소는 같은 저장소의 HTTPS로 설정했다. 이미 활성화된 GitHub CLI 계정 `yj-lee1`을 사용하며 전역 인증 설정이나 계정 권한은 바꾸지 않았다.

필요한 경우 다음처럼 기존 GitHub CLI 인증을 해당 push에만 사용한다. 토큰을 URL이나 파일에 쓰지 않는다.

```sh
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin codex/soommap-build
```

## 비밀값 입력

`.env.example`을 참고해 프로젝트 루트의 `.env.local`에 값을 입력한다. `.env.local`은 Git에서 제외한다. 키를 채팅·스크린샷·문서에 적지 않는다.

| 이름 | 용도 | 현재 상태 |
|---|---|---|
| `SEOUL_API_KEY` | 서울 열린데이터광장 인증 | 설정 완료, 실제 한강 응답 확인 |
| `SEOUL_API_BASE_URL` | 서울 API 주소 | 기본 `http://openapi.seoul.go.kr:8088` |
| `AI_PROVIDER` | 제품 AI 공급자 | `openai` 승인 |
| `AI_MODEL` | 공급자에서 사용할 모델 | `gpt-5.6-terra` 승인·접근 확인 |
| `AI_API_KEY` | 선택한 공급자의 서버 인증 | 사용자 설정 완료 |
| `AI_BUDGET_USD` | 개발·검수 전체 승인 예산 | `20`, 공급자의 자동 차단 설정은 아님 |
| `SETUP_CHECK_TOKEN` | 임시 연동 검사 인증 | 로컬 생성 완료, 서버에만 전달 |

2026-09-17 사용자가 OpenAI API, `gpt-5.6-terra`, 개발·검수 총 $20을 승인했다. `npm run check:ai`는 고정된 작은 요청 1건만 실행한다. 출력은 최대 512토큰, 외부 도구 없음, 재시도 없음, `store: false`다. `.local/ai-setup-check.json`에 먼저 $0.05를 예약하며 파일이 존재하면 추가 호출하지 않는다. 실패·타임아웃 시에도 예약을 유지한다. 파일을 삭제해 예산 기록을 초기화하지 않는다.

첫 검사: 입력 112토큰·출력 28토큰, 구조화 결과 검증 성공. 보수적 추정 비용 $0.000616. 공식 기본 단가는 100만 토큰당 입력 $2·출력 $12이며 추정에는 입력 캐시 쓰기 단가 $2.50까지 반영했다. 실제 청구액은 공급자 사용량에서 확정한다. [공식 모델·가격](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs)

공개된 유료 생성 경로는 아직 없다. 3단계에서 공개 AI를 연결하기 전에 개발 검사 예약액 $0.05를 이월하고, 여러 서버 인스턴스에서 공유하는 영속 예산 기록·호출 전 예약·요청별 상한을 구현한다. 로컬 파일이나 환경변수만으로 공개 서비스의 합산 $20이 강제된다고 간주하지 않는다. 별도 승인 전 한도를 늘리거나 모델을 바꾸지 않는다.

검수 기본 호스팅은 사용자가 선택한 Vercel이다. 키는 Preview 서버 환경에만 전달하며 `NEXT_PUBLIC_` 접두사를 사용하지 않는다. `.vercel`·`.env*`·로컬 검사 기록은 Git과 배포 소스에서 제외한다. 최초 프로젝트 연결은 GitHub 자동 연결에 실패했으므로 검수 배포는 CLI를 사용한다. 최종 Production 배포와 `main` 변경은 이후 완성본 승인 범위다.

## 호스팅 이전

- 앱은 표준 Next.js Node 런타임, `Request`/`Response`, `fetch`만 사용한다. Vercel 전용 SDK·Gateway·KV·Blob·Cron 의존성은 없다.
- 서버 환경변수 읽기는 `src/lib/server/config.ts`, 외부 통신은 `src/lib/server/integrations/`로 분리했다. UI·도메인 타입이 환경변수나 공급자 인증을 직접 읽지 않는다.
- 다른 Node.js 24 호스팅에서는 `npm ci` → `npm run build` → `npm run start -- --port 3000`으로 실행한다. 실행 환경이 주는 `PORT`도 사용할 수 있다. 시작 서버는 컨테이너 외부에서 접근 가능하며 필요하면 `--hostname 127.0.0.1`로 제한한다.
- 같은 서버 환경변수를 대상 호스팅의 비밀값 설정에 넣고 `npm run check:setup -- https://검증한-배포주소 --probe`로 확인한다. 프록시의 HTTPS와 서울 공식 API의 8088 포트 송신을 허용해야 한다.
- 서울 공식 API는 현재 검사에서 HTTP 8088로 정상 응답했으며 HTTPS 두 주소는 연결 실패했다. 키 포함 요청 URL·원시 오류를 로그에 남기지 않는다. 임의의 제3자 프록시에 키를 전달하지 않는다.
- 영속 데이터·공유 캐시·예산 저장소는 아직 추가 전이다. 다음 단계에서 표준 외부 저장소 연결을 별도 어댑터로 구성하고 이전 절차를 갱신한다.

## 확인 범위

- `/api/health`는 웹 서버 자체의 응답만 확인한다. 서울 데이터·AI 인증이 성공했다는 의미가 아니다.
- `npm run check:setup`은 로컬 웹 서버와 인증된 설정 확인 경로를 검사한다. 배포 후에는 뒤에 검증한 HTTPS 배포 주소를 붙여 실행한다. 키 값은 출력하지 않고 설정 존재 여부만 확인하며, 외부 API를 호출하지 않는다.
- `/api/setup/status`는 `SETUP_CHECK_TOKEN` 인증이 있어야 접근할 수 있다. 최종 서비스 단계에서는 임시 검수 경로의 유지 필요성을 검토한다.
- `npm run check:setup -- --probe`는 인증된 `/api/setup/probe`로 서울 한강 응답과 OpenAI 모델 접근을 확인한다. 이 서버 경로는 유료 텍스트 생성 요청을 하지 않는다. AI 구조화 생성 검사는 위의 로컬 1회 스크립트로 별도 검증한다.
- 서울시 연결은 한강 장소의 실제 응답으로 확인한다. 공개 샘플 응답을 실제 한강 자료로 사용하지 않는다.
- AI 연결은 선택한 모델로 작은 구조화 응답 1건을 확인한다. 키·요청 URL의 비밀값을 출력하지 않는다.
- 검수 배포와 Git 커밋을 연결해 기록한다. 최종 공개·기본 브랜치 반영은 이후 완성본 승인에 따른다.

## 서울시 키가 아직 없다면

1. [서울 열린데이터광장](https://data.seoul.go.kr/)에 로그인한다.
2. 인증키 신청 메뉴에서 사용할 키를 발급받는다.
3. 프로젝트의 `.env.local` 파일에서 `SEOUL_API_KEY=` 뒤에 입력하고 저장한다.
4. 채팅에는 키 대신 ‘설정 완료’라고 알려준다. 이후 서버를 다시 시작하고 실제 한강 장소 응답을 검사한다.

서울시의 로그인 → 인증키 신청 → 서비스별 이용 방법 확인 절차를 따른다. [공식 Open API 안내](https://data.seoul.go.kr/together/notice/faqList.do?bbsCd=10002&ditcCd=FAQ02&seq=d47bc57aea53d6c6ab244c05a6eb2259)
