# 3단계 AI 실행·예산 제어

2026-09-17. 기본 모델 `gpt-5.6-terra`, OpenAI Responses API, Structured Outputs. 호스팅은 기존 Vercel Hobby, 표준 Next.js Route Handler를 유지한다.

## 저장소 선택

초기 기획의 Supabase는 최신 공공 데이터 저장을 위한 제안이었고 실제 계정 연결·스키마·저장 코드가 없다. 현재 서울 데이터는 1단계에서 검증한 Next 공용 캐시를 사용한다. 이번 단계에서 Supabase와 Upstash를 동시에 도입하지 않는다.

| 요구 | Supabase PostgreSQL | Upstash Redis Free |
| --- | --- | --- |
| 비용 예약·정산 | 원장 테이블, 트랜잭션/행 잠금 RPC, 권한 설정 | Redis hash와 atomic Lua EVAL |
| 사용자·IP 제한 | 카운터 테이블/RPC, 만료 행 정리 | 만료되는 키와 같은 EVAL |
| 중복·짧은 결과 캐시 | 상태/결과 테이블, 만료 조건과 삭제 관리 | SET NX EX 잠금과 5분 TTL |
| 현재 서비스 연결 | 새 계정·스키마·RPC 배포 필요 | 새 무료 DB, REST 환경변수 2개 |

현재 구현 범위에서는 Redis의 TTL과 원자 연산이 더 작고 상시 작업이 필요 없다. 따라서 사용자가 승인한 **Upstash Free 한 곳**에서 네 요구를 함께 처리한다. Supabase는 실제로 장기 저장/인증이 필요한 후속 범위에서 다시 판단한다. 이미 Supabase가 운영 중인 서비스라면 같은 RPC로 통합하는 선택도 가능하다.

공식 근거: [Supabase Database Functions](https://supabase.com/docs/guides/database/functions), [Upstash REST API](https://upstash.com/docs/redis/features/restapi), [Redis Free 한도](https://upstash.com/pricing/redis). 확인 시 Free는 256MB/월 50만 명령. 결제수단·자동 유료 전환을 사용하지 않는다. 무료 한도 소진/장애는 AI를 중단하고 수동 조건 비교를 유지한다. 전용 DB의 eviction을 꺼서 원장이 자동 축출되지 않게 한다.

## 요청 흐름

1. 서명한 익명 세션 쿠키를 발급한다(HttpOnly, SameSite Strict, 배포에서는 Secure). 원문·좌표·IP는 쿠키에 없다.
2. 1~1,200자, 요청 본문 8KiB, 같은 origin, 구조·버전을 먼저 검증한다.
3. 세션과 요청 ID로 격리한 메모리 병합 및 Redis 결과 캐시/75초 잠금으로 동일 흐름의 중복 생성을 차단한다. 같은 ID에 다른 본문을 끼워 넣으면 거부한다.
4. 조건 해석 호출 전 `EVAL` 한 번에서 사용자/IP 제한, 흐름 호출 수, 예산을 검사하고 최대 예상액 $0.15를 예약한다.
5. 구조화 응답을 런타임 검증하고 기존 조건 모델로 변환한다. 명시하지 않은 장소 변경을 허용하지 않는다. 모호한 필수 조건은 확인 안내, 제안한 시간 범위·혼잡 선호는 화면에 표시한다.
6. 실제 서울 데이터와 기존 도착·체류 엔진으로 후보를 계산한다. AI가 후보·혼잡 판정을 만들지 않는다.
7. 추천이 있으면 선택적으로 두 번째 호출을 한다. AI는 검증된 사실 문장 ID를 1~3개 선택하며 코드가 해당 문장을 출력한다. 잘못된 ID/설명 실패는 계산 근거 문장으로 대체한다.
8. 결과는 세션별로 AES-256-GCM 암호화한 뒤 Redis에 5분 보관한다. 원문은 저장하지 않는다. 조건·설명은 짧은 결과 캐시에 포함될 수 있다. 원장에는 HMAC 식별자·토큰·금액만 남는다.

입력은 OpenAI로 전송됨을 화면에 알린다. 좌표는 해석 문맥에 포함하지 않는다. Redis 토큰/AI 키는 서버에서만 읽는다. Preview에만 설정하고 Production 변수는 별도로 관리한다. 공급자 상세 오류·원문·키를 로그로 출력하지 않는다.

## 한도와 실패 처리

- 전체 개발·검수 한도 $20, 선택적 설명 중단 경고 $18. 초과 모델 자동 대체 없음.
- 호출당 $0.15를 먼저 예약한다. 공급자 요청 전체 JSON 32KiB 이하, 출력 최대 2,048토큰(해석 1,200/설명 256). UTF-8 바이트 상한과 8,192토큰의 오버헤드 여유, input $2.5/M·output $12/M 보수적 단가에서 $0.15 아래로 제한한다.
- 공식 usage가 오면 `ceil(input_tokens × 2.5 + output_tokens × 12)` 마이크로달러로 정산한다. 입력은 캐시 쓰기 1.25배까지 포함한 상한 추정이므로 실제 청구와 차이가 있다. [모델 단가](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- 네트워크 오류·정산 오류·사용량 미확인은 예약액을 그대로 남긴다. 중복 정산은 한 번만 환급한다. 자동 재시도하지 않는다.
- 흐름당 해석 1회·설명 1회만 원장에서 승인한다. 단계별 요청 ID 중복 기록은 TTL 없이 보존해 짧은 캐시가 만료돼도 같은 흐름을 다시 과금하지 않는다.
- 익명 세션당 분당 6회/시간당 30회, IP당 분당 20회/시간당 100회, 전체 분당 60회(해석 시작 기준). 쿠키를 새로 만들어도 IP 제한이 적용된다. 공용 네트워크의 사람들은 IP 한도를 공유한다.
- IP는 Vercel이 덮어쓰는 `x-vercel-forwarded-for`만 신뢰한다. 다른 호스팅에서는 프록시가 덮어쓰는 `TRUSTED_CLIENT_IP_HEADER`를 지정한다. 없거나 유효하지 않으면 보수적으로 공용 unknown 버킷에 묶는다. 원본 IP는 저장하지 않는다. [Vercel 헤더](https://vercel.com/docs/headers/request-headers)
- Rate 키는 70초/3,700초, 캐시는 300초. 원장은 자동 만료/자동 초기화하지 않는다. 원장 없으면 실패 처리한다.
- 해석 타임아웃 20초, 설명 8초, Redis 연산 3초, 서버 함수 60초. 조건 버튼은 AI를 호출하지 않는다.

공개 서비스의 이 경로를 통과한 호출만 제어할 수 있다. 같은 API 키를 별도 프로그램에서 사용한 금액은 자동 감지할 수 없다. 운영자가 원장을 삭제·덮어쓰거나 서비스의 가격이 바뀌는 경우까지 보장하는 청구기관의 하드 캡은 아니다.

## 운영 명령

```sh
# 최초 한 번. 기존 원장이 있으면 값을 보존한다.
node --conditions=react-server scripts/ai-budget.mjs --initialize
# 현재 금액·예약 포함 합계·사용 토큰만 확인
node --conditions=react-server scripts/ai-budget.mjs
# 임시 키만 사용하는 실제 Redis 동시성 검사. OpenAI 호출 없음.
node --conditions=react-server scripts/test-ai-ledger.mjs
```

0단계 호출은 기존 추정 $0.000616(112 input/28 output)을 기록하고 안전 여유를 포함한 $0.05를 초기 committed로 둔다. 초기화는 서버 요청에서 수행하지 않는다. 원장 키 `soommap:{ai-dev-review-v1}:ledger`는 개발/검수 배포에서 공유하며 배포마다 초기화하지 않는다.
