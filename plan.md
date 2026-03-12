# Flaude - Founder for Claude Code

> 세일즈/마케팅 에이전트를 만들고, 팀 채팅에서 부른다.

---

## 1. 본질

Flaude는 두 가지만 한다:

1. **에이전트를 뾰족하게 설계한다** (Tauri 데스크톱 앱)
2. **팀 채팅에서 부른다** (Discord / Slack 봇)

채팅은 Discord/Slack이 한다. 모바일도. Push 알림도.
Flaude는 에이전트를 만들고 실행하는 것만 한다.

**세일즈/마케팅에 특화.** 리서치 → 콜드메일 → 미팅 → 팔로업까지.

```
Flaude 앱 (Tauri):             팀 채팅 (Discord / Slack):
━━━━━━━━━━━━━━━━              ━━━━━━━━━━━━━━━━━━━━━━━━━
에이전트 Hire/Fire              /ask 수현 삼성SDS 조사해줘
에이전트 프로필 편집             결과 수신
Claude Code Max 관리            팀원끼리 대화
gws 연결                       모바일 알림
봇 연결 (Discord/Slack)         스레드, 채널 관리
```

### 전제 조건

- 팀 전원 Claude Code Max 구독 필수 ($100-200/mo per person)
- 에이전트 실행 = 명령한 사람의 맥, 명령한 사람의 Claude Code Max
- API 비용 없음. 정액제.
- **Claude Code CLI를 subprocess로 호출** (Agent SDK 아님 — SDK는 API 키 필요)

### 에이전트를 "사람처럼" 만드는 이유

재미 요소가 아니다. **에이전트의 효능을 극대화하기 위한 설계**다.

```
"리서처 한 명 뽑아줘" 라고 말하는 순간, 파운더는 이런 것을 정의하고 있다:

  - 역할 (Role):        시장 조사 전문가
  - 범위 (Scope):       웹 검색 + 보고서 작성만. 이메일 발송은 안 함
  - 성격 (Tone):        꼼꼼하고 데이터 중심
  - 도구 (Tools):       WebSearch, Drive
  - 한계 (Boundary):    조사만 하고, 영업은 세일즈 에이전트에게 넘김

이것이 곧 AgentDefinition이다.
```

사람을 만드는 것이 아니다.
**각 목적에 맞게 뾰족하게 설계된 에이전트를 만드는 것**이다.

```
나쁜 에이전트:  "뭐든 다 할 수 있는 만능 AI"
              → 프롬프트가 모호, 툴이 과다, 결과가 산만

좋은 에이전트:  "시장 조사만 하는 리서처 수현"
              → 프롬프트가 뾰족, 툴이 최소, 결과가 정확

Hire = 뾰족한 에이전트를 설계하는 행위
Fire = 설계가 잘못된 에이전트를 폐기하는 행위
```

---

## 2. 아키텍처

```
┌──────────────────────────┐  ┌──────────────────────────┐
│  파운더 맥                │  │  팀원 A 맥               │
│  Flaude.app (Tauri)      │  │  Flaude.app (Tauri)      │
│                          │  │                          │
│  ┌────────────────────┐  │  │  ┌────────────────────┐  │
│  │ 에이전트 관리 UI    │  │  │  │ 에이전트 관리 UI    │  │
│  │ Hire/Fire/Edit     │  │  │  │ (권한 있는 것만)    │  │
│  └────────┬───────────┘  │  │  └────────┬───────────┘  │
│           │              │  │           │              │
│  ┌────────▼───────────┐  │  │  ┌────────▼───────────┐  │
│  │ Agent Runner       │  │  │  │ Agent Runner       │  │
│  │ Rust subprocess    │  │  │  │ Rust subprocess    │  │
│  │ → claude CLI       │  │  │  │ → claude CLI       │  │
│  │ → gws CLI          │  │  │  │ → gws CLI          │  │
│  └────────┬───────────┘  │  │  └────────┬───────────┘  │
│           │              │  │           │              │
│  ┌────────▼───────────┐  │  │  ┌────────▼───────────┐  │
│  │ WebSocket Client   │  │  │  │ WebSocket Client   │  │
│  └────────────────────┘  │  │  └────────────────────┘  │
└────────────┬─────────────┘  └────────────┬─────────────┘
             │ wss://                       │ wss://
             ▼                              ▼
┌──────────────────────────────────────────────────────────┐
│  flaude.com (서버)                                        │
│                                                          │
│  ┌──────────────────┐  ┌────────────────────────────┐    │
│  │ WebSocket Hub    │  │ Bot Gateway                │    │
│  │ 사용자별 연결 관리 │  │                            │    │
│  │ 태스크 라우팅     │  │  Discord Bot ◄── Discord   │    │
│  │ 오프라인 큐      │  │  Slack Bot   ◄── Slack     │    │
│  └────────┬─────────┘  └──────────┬─────────────────┘    │
│           │                       │                      │
│           └───────────┬───────────┘                      │
│                       │                                  │
│  ┌────────────────────▼──────────────────────────────┐   │
│  │ Task Router                                        │   │
│  │ 슬래시 커맨드 수신 → 명령한 사람의 맥으로 라우팅     │   │
│  │ 결과 수신 → 해당 채널/스레드에 응답                  │   │
│  └────────────────────────────────────────────────────┘   │
│                                                          │
│  Auth / 에이전트 정의 동기화 / .dmg 다운로드              │
└──────────────────────────────────────────────────────────┘
```

### 사용자 매핑 (Discord/Slack ↔ Flaude)

셋업 위자드에서 Discord/Slack 계정을 Flaude 계정과 연동한다.

```sql
-- 서버 DB
CREATE TABLE user_platform_links (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    platform        TEXT NOT NULL,     -- 'discord' or 'slack'
    platform_user_id TEXT NOT NULL,    -- Discord user_id or Slack user_id
    platform_team_id TEXT,            -- Slack workspace_id
    linked_at       TIMESTAMPTZ,
    UNIQUE(platform, platform_user_id)
);
```

```
연동 흐름 (셋업 위자드 Step 5):
  1. Flaude 앱에서 [Discord 연결] 클릭
  2. Discord OAuth → Discord user_id 획득
  3. user_platform_links에 저장: { user_id: 1, platform: "discord", platform_user_id: "123456789" }

슬래시 커맨드 수신 시:
  /ask 수현 조사해줘  ← Discord user_id: 123456789
  → user_platform_links에서 조회 → Flaude user_id: 1
  → WebSocket Hub에서 user_id: 1의 연결 찾기 → 해당 맥으로 라우팅
  → 미연동 유저가 /ask 시 → "먼저 Flaude 앱에서 계정을 연결하세요"
```

### 봇 라우팅 흐름

```
1. 팀원이 Discord/Slack에서 슬래시 커맨드 입력
   예: /ask 수현 삼성SDS 조사해줘

2. Discord/Slack → flaude.com 서버의 Bot Gateway가 수신

3. Task Router가 명령한 사람 식별
   → platform_user_id로 user_platform_links 조회
   → Flaude user_id 확인
   → 해당 사용자의 WebSocket 연결 찾기

4. WebSocket으로 해당 사용자의 Tauri 앱에 태스크 전달
   → { agent: "수현", prompt: "삼성SDS 조사해줘", thread_id: "..." }

5. 사용자 맥의 Agent Runner가 실행
   → Claude Code CLI (Max 구독)

6. 결과를 WebSocket → flaude.com → Bot Gateway → Discord/Slack 채널에 올림

오프라인 처리:
  → 사용자 맥이 꺼져있으면 Task Queue에 저장 (TTL: 1시간)
  → 1시간 내 맥 켜지면 → WebSocket 재연결 → 큐 소진
  → 1시간 초과 시 → 만료 → 채팅에 "시간 초과. 다시 요청하세요" 응답
```

### 에이전트 실행 원칙

```
에이전트 정의 = 서버에 공유 (팀 전체가 같은 "수현"을 씀)
실행 = 명령한 사람의 맥, 명령한 사람의 Claude Code Max
인증 = 명령한 사람의 gws (내 Gmail로 발송, 내 Drive에 저장)

에이전트 = 명령한 사람의 손과 발
내가 접근 못하는 Drive 폴더 → 에이전트도 못함
별도 권한 시스템 불필요. gws가 명령한 사람의 인증으로 실행되므로 Google이 알아서 거부.
```

### 에이전트 권한

| | 설명 |
|---|---|
| **Hire/Fire/Edit** | owner(만든 사람) 또는 관리자만 |
| **명령** | 채팅에서 슬래시 커맨드로 누구나 |
| **실행 위치** | 명령한 사람의 맥 |
| **인증** | 명령한 사람의 Claude Code Max + gws |
| **맥 꺼져있으면** | 서버 Task Queue에 쌓임, 켜지면 실행 |

Enterprise (V2): Mac Mini 중앙 실행 + 공유 Google 계정

### 세션 관리 (에이전트 기억)

Claude Code CLI의 `--session-id`와 `--resume` 플래그로 대화 컨텍스트를 유지한다.

```
/ask 수현 삼성SDS 조사해줘           → 새 세션: claude -p "..." --session-id 생성
/ask 수현 아까 경쟁사 부분 더 자세히  → claude --resume [session_id] → 이전 맥락 유지
/ask 수현 LG CNS도 조사해줘          → 새 세션 (다른 작업)
```

스레드 = 세션 단위로 매핑. 새 명령 → 새 스레드 + 새 세션.
같은 스레드에서 후속 질문 → resume로 컨텍스트 유지.

### 에이전트 간 컨텍스트 공유

에이전트는 각각 독립 세션이므로, 다른 에이전트의 결과를 자동으로 알 수 없다.
컨텍스트 전달은 **프롬프트 주입**으로 해결한다.

```
개별 호출 (같은 스레드에서):
  파운더: "/ask 수현 삼성SDS 조사해줘"
  → 수현 실행 → 결과를 스레드에 올림 + 서버에 저장

  파운더: "/ask 민준 이 보고서로 메일 보내"  (같은 스레드에서)
  → Task Router가 같은 스레드의 이전 에이전트 결과를 감지
  → 민준 프롬프트에 자동 주입:
    "이전 컨텍스트: [수현의 조사 결과 전문]
     사용자 요청: 이 보고서로 메일 보내"
  → 민준은 수현의 결과를 알고 작업 가능

팀 호출:
  파운더: "/ask 영업팀 삼성SDS 조사하고 콜드메일 보내줘"
  → Orchestrator가 수현 실행 → stdout 결과 획득
  → 수현 결과를 민준 프롬프트에 직접 주입
  → 민준 실행 → 최종 결과

에이전트 간 직접 통신 없음. 프롬프트 주입 + Drive 링크가 컨텍스트.
```

### 슬래시 커맨드

@멘션은 Webhook 에이전트에게 불가능하므로, 슬래시 커맨드를 사용한다.
Discord/Slack 모두 슬래시 커맨드는 **3초 내 응답 필수** → 즉시 ACK 후 deferred response.

```
/ask 수현 삼성SDS 조사해줘
  → [3초 내] "수현에게 전달했습니다. 스레드에서 결과를 확인하세요."  (ACK)
  → [10분 후] 스레드에 조사 결과 올림  (deferred response via Webhook/Bot)
```

```
Discord / Slack 공통:

/ask [에이전트 or 팀] [명령]    에이전트 또는 팀에게 질문/지시
  예: /ask 수현 삼성SDS 조사해줘
  예: /ask 민준 김부장한테 콜드메일 보내
  예: /ask 영업팀 삼성SDS 조사하고 김부장한테 콜드메일까지 보내줘

/client [아무 정보]             클라이언트 등록/업데이트
  예: /client 삼성SDS 김부장 kim@samsung.com 010-1234-5678
  예: /client 네이버 이팀장 031-111-2222 클라우드팀 (컨퍼런스에서 만남)
  → 서버에서 claude-haiku-4-5로 경량 파싱 → 구조화 → Clients DB 저장
  → 이름, 회사, 이메일, 전화, 부서, 메모 등 자동 분류
  → 이미 있는 클라이언트면 정보 업데이트
  → (파싱은 가벼운 작업이므로 Haiku API 사용, 사용자 맥 불필요)

/agents                        현재 활성 에이전트 목록
/teams                         현재 팀 목록
/status [에이전트]              에이전트 실행 상태 확인
/history [에이전트]             최근 실행 내역
```

### 팀 (에이전트 그룹)

개별 에이전트를 조합해서 "팀"을 만들 수 있다.
팀에게 `/ask`하면, 에이전트들이 순차 또는 병렬로 협업한다.

```
Flaude 앱에서 팀 구성:

  팀 이름:     영업팀
  멤버:        수현 (리서처) → 민준 (세일즈)
  실행 순서:   순차 (수현 결과를 민준이 이어받음)

사용:
  /ask 영업팀 삼성SDS 조사하고 김부장한테 콜드메일까지 보내줘

실행 흐름:
  1. 수현이 삼성SDS 조사 (WebSearch → Drive 보고서)
  2. 수현 완료 → 결과를 스레드에 올림
  3. 민준이 수현의 보고서를 읽고 콜드메일 작성 → gws gmail send
  4. 민준 완료 → 최종 결과를 스레드에 올림

내부 구현: Rust Orchestrator
  → 팀 정의를 읽고 Claude Code CLI subprocess를 순차/병렬 실행
  → 앞 에이전트 stdout → 뒤 에이전트 prompt에 주입
  → 에이전트 간 컨텍스트는 채팅 스레드 + Drive 링크로 전달
```

팀 구성 예시:

```
[영업팀]       수현(조사) → 민준(콜드메일)          순차
[콘텐츠팀]     수현(조사) → 마케터(글 작성)         순차
[풀스택영업]   수현(조사) → 민준(메일) → 민준(미팅)  순차
[리서치팀]     수현(시장) + 지원(경쟁사)            병렬
```

### 봇 구현 (Discord + Slack)

봇 하나가 모든 에이전트를 대리한다. Webhook으로 에이전트별 이름/아바타 전환.

```
Discord:
  봇 계정: Flaude Bot (1개, flaude.com 서버에서 실행)
  슬래시 커맨드 수신 → Task Router → WebSocket → 사용자 맥
  결과 전송: Webhook (채널별)
    → webhook.send(content="조사 완료", username="수현", avatar_url="수현아바타")

Slack:
  Slack App: Flaude (1개, flaude.com 서버에서 실행)
  슬래시 커맨드 수신 → Task Router → WebSocket → 사용자 맥
  결과 전송: Bot Token + chat.postMessage
    → Slack은 username/icon 커스텀 deprecated
    → 메시지 prefix로 에이전트 구분: "[수현] 조사 완료했습니다"
    → Bot 이름은 "Flaude" 고정, 에이전트 이름은 메시지 내 표시
```

### 동시 호출 처리

```
다른 사람이 같은 에이전트 호출:
  파운더: "/ask 수현 삼성SDS 조사해줘"  → 파운더 맥에서 실행 → 스레드 A
  팀원A: "/ask 수현 LG CNS 조사해줘"   → 팀원A 맥에서 실행 → 스레드 B
  → 각자 맥, 각자 Max → 충돌 없음 ✅

같은 사람이 여러 에이전트 동시 호출:
  파운더: "/ask 수현 삼성SDS 조사해줘"  → subprocess A
  파운더: "/ask 민준 LG CNS 메일 보내"  → subprocess B (동시)
  → Claude Code Max 동시 세션 제한에 걸릴 수 있음
  → 대응: Tauri Agent Runner가 큐잉 (FIFO, 한 번에 1개 실행)
  → 또는 Max 동시 제한 확인 후 2-3개 병렬 허용
```

### 보안

Discord/Slack 서버를 private으로 운영. 고객 정보가 오가므로:
- 서버 초대 링크 비공개
- 채널별 역할 권한 설정
- 민감 정보는 Drive 링크로 공유 (채팅에 직접 노출 최소화)
- WebSocket은 wss:// (TLS) + JWT 인증

### 서버 DB (PostgreSQL) — 팀 공유 데이터

```sql
-- 에이전트 정의 (팀 전체 공유)
CREATE TABLE agents (
    id              SERIAL PRIMARY KEY,
    team_id         INTEGER REFERENCES teams(id),
    name            TEXT NOT NULL,           -- "수현"
    role            TEXT NOT NULL,           -- "리서처"
    instructions    TEXT NOT NULL,           -- 핵심. 뾰족한 시스템 프롬프트
    tools           JSONB NOT NULL,          -- ["WebSearch", "WebFetch", ...]
    not_allowed     JSONB,                   -- ["Gmail", "Calendar"]
    channels        JSONB,                   -- 채널 제한 (선택)
    avatar_url      TEXT,
    status          TEXT DEFAULT 'active',   -- active / fired
    fired_reason    TEXT,
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ,
    fired_at        TIMESTAMPTZ
);

-- 에이전트 팀 (그룹)
CREATE TABLE agent_teams (
    id              SERIAL PRIMARY KEY,
    team_id         INTEGER REFERENCES teams(id),
    name            TEXT NOT NULL,           -- "영업팀"
    members         JSONB NOT NULL,          -- [{"agent": "수현", "order": 1}, {"agent": "민준", "order": 2}]
    execution_mode  TEXT DEFAULT 'sequential', -- sequential / parallel
    created_at      TIMESTAMPTZ
);

-- 클라이언트 (세일즈 파이프라인)
CREATE TABLE clients (
    id              SERIAL PRIMARY KEY,
    team_id         INTEGER REFERENCES teams(id),
    company         TEXT,
    contact_name    TEXT,
    email           TEXT,
    phone           TEXT,
    department      TEXT,
    notes           TEXT,
    status          TEXT DEFAULT 'new',      -- new / researching / contacted / meeting / closed
    assigned_agent  TEXT,                     -- 담당 에이전트
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
);

-- 클라이언트 히스토리 (에이전트 액션 타임라인)
CREATE TABLE client_history (
    id              SERIAL PRIMARY KEY,
    client_id       INTEGER REFERENCES clients(id),
    agent_name      TEXT NOT NULL,
    action          TEXT NOT NULL,            -- "시장 조사 완료", "콜드메일 발송"
    detail          TEXT,
    created_at      TIMESTAMPTZ
);
```

### 로컬 DB (SQLite) — 실행 데이터

```sql
-- 에이전트 세션 매핑 (내 맥에서 실행한 것만)
CREATE TABLE agent_sessions (
    id              INTEGER PRIMARY KEY,
    agent_name      TEXT NOT NULL,
    thread_id       TEXT,              -- Discord thread_id or Slack thread_ts
    platform        TEXT NOT NULL,     -- 'discord' or 'slack'
    session_id      TEXT NOT NULL,     -- Claude Code CLI session_id
    created_at      DATETIME
);

-- 실행 로그 (내 맥에서 실행한 것만)
CREATE TABLE execution_logs (
    id              INTEGER PRIMARY KEY,
    agent_name      TEXT NOT NULL,
    message_id      TEXT,             -- Discord/Slack message ID
    platform        TEXT NOT NULL,    -- 'discord' or 'slack'
    prompt          TEXT,
    result          TEXT,
    status          TEXT,             -- running/completed/failed
    created_at      DATETIME,
    completed_at    DATETIME
);
```

---

## 3. Flaude 앱 (Tauri) — 에이전트 관리

채팅은 Discord/Slack이 한다. Flaude 앱은 **에이전트를 만들고 관리하는 대시보드**다.

### 백그라운드 상주 (메뉴바 앱)

Tauri 앱은 메뉴바에 상주한다. 슬랙처럼.

```
앱 열기   → 대시보드 보임 (에이전트 관리)
앱 닫기   → 메뉴바에 F 아이콘으로 상주
             WebSocket 연결 유지
             Claude Code 실행 대기
완전 종료 → 메뉴바 우클릭 → "Quit Flaude"
             이때만 WebSocket 해제 + 실행 중 에이전트 종료
```

맥 로그인 시 자동 시작 옵션 제공 (Launch at Login).

### 셋업 위자드 (첫 실행)

```
1. flaude.com → "Download for Mac" → Flaude.dmg 설치
2. 앱 열기
3. 셋업 위자드:

   Step 1: Flaude 로그인
   → flaude.com 계정

   Step 2: Claude Code 설치 확인
   → 설치됨 → 다음
   → 미설치 → [설치] 버튼 (원클릭, 앱이 내부에서 처리)

   Step 3: Claude Code Max 로그인
   → 앱 내에서 로그인 (사용자가 직접)

   Step 4: Google 연결 (선택)
   → [Google 연결] 버튼 → gws OAuth

   Step 5: 팀 채팅 연결
   → [Discord 연결] 또는 [Slack 연결] (택일 또는 둘 다)
   → 봇을 내 서버/워크스페이스에 추가

4. 끝. 에이전트 관리 대시보드가 뜬다.
```

### 대시보드 UI

```
┌──────────────────────────────────────────────────────────┐
│  F  Flaude                                        설정     │
├──────────────┬───────────────────────────────────────────┤
│              │                                           │
│  Agents      │  My Agents                   [+ Hire]     │
│  Teams       │                                           │
│  Clients     │                                           │
│  Settings    │  ┌─────────────────────────────────────┐  │
│              │  │                                      │  │
│              │  │  리서처 "수현"                    ON  │  │
│              │  │  Market Research                     │  │
│              │  │                                      │  │
│              │  │  Scope: 시장 조사, 보고서              │  │
│              │  │  Tools: 검색, Drive                    │  │
│              │  │  NOT:   Gmail, Calendar               │  │
│              │  │  Chat: Discord #sales, Slack #research│  │
│              │  │  Stats: 47 tasks | Avg 12min          │  │
│              │  │                                      │  │
│              │  │              [Edit]  [Fire]           │  │
│              │  └─────────────────────────────────────┘  │
│              │                                           │
│              │  ┌─────────────────────────────────────┐  │
│              │  │                                      │  │
│              │  │  세일즈 "민준"                    ON  │  │
│              │  │  Sales Outreach                      │  │
│              │  │                                      │  │
│              │  │  Scope: 콜드메일, 미팅 일정            │  │
│              │  │  Tools: Gmail, Calendar               │  │
│              │  │  NOT:   검색, Drive                   │  │
│              │  │  Chat: Discord #sales, Slack #sales   │  │
│              │  │  Stats: 23 tasks | Avg 5min           │  │
│              │  │                                      │  │
│              │  │              [Edit]  [Fire]           │  │
│              │  └─────────────────────────────────────┘  │
│              │                                           │
│  ────────    │  Fired                                    │
│              │  ┌─────────────────────────────────────┐  │
│  Connected:  │  │  세일즈 "지민"            [Re-hire]  │  │
│  Discord OK  │  │  사유: 퍼포먼스 부족 | 3/11 해고     │  │
│  Slack OK    │  └─────────────────────────────────────┘  │
│  Google OK   │                                           │
│  Claude OK   │                                           │
└──────────────┴───────────────────────────────────────────┘
```

### Clients 페이지 (세일즈 특화)

채팅에서 `/client`로 등록하거나, 앱에서 직접 추가.

```
/client 삼성SDS 김부장 kim@samsung.com 010-1234-5678
→ "삼성SDS 김부장님 등록했습니다"

/client 카카오 최대리 (지난주 컨퍼런스에서 만남, AI 도입 관심)
→ "카카오 최대리님 등록했습니다. 메모: 지난주 컨퍼런스에서 만남, AI 도입 관심"
```

```
┌──────────────────────────────────────────────────────────┐
│  Clients                                    [+ Add]       │
├──────────────────────────────────────────────────────────┤
│  ┌──────┬──────────┬────────────┬────────┬────────────┐  │
│  │ 회사  │ 담당자    │ 상태       │ 담당    │ 마지막 액션│  │
│  ├──────┼──────────┼────────────┼────────┼────────────┤  │
│  │삼성SDS│ 김부장   │ 조사중     │ 수현   │ 조사 진행중│  │
│  │LG CNS│ 박차장   │ 연락함     │ 민준   │ 메일 발송  │  │
│  │네이버 │ 이팀장   │ 미팅잡힘   │ 민준   │ 3/17 14시 │  │
│  │카카오 │ 최대리   │ 신규       │ —     │ 등록됨     │  │
│  └──────┴──────────┴────────────┴────────┴────────────┘  │
│                                                          │
│  클라이언트 클릭 시 상세:                                   │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 삼성SDS — 김부장                                   │    │
│  │ Email: kim@samsung.com                            │    │
│  │ Phone: 010-1234-5678                              │    │
│  │ 메모: 클라우드 전환 검토 중                          │    │
│  │ 히스토리:                                          │    │
│  │   3/11 수현 — 시장 조사 완료 [보고서]                │    │
│  │   3/11 민준 — 콜드메일 발송                         │    │
│  │   3/12 민준 — 답장 수신 "화요일 가능"                │    │
│  │   3/12 민준 — 3/17 14시 미팅 잡음                   │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## 4. 팀 채팅 — Discord & Slack

Discord/Slack이 채팅을 대체한다. 이미 있는 것을 다시 만들 필요 없다.

### 채팅에서의 경험 (Discord 예시)

```
#sales-outreach
───────────────────────────────────────────

승현                              10:30 AM
/ask 수현 삼성SDS 클라우드 사업 조사해줘

  수현 (BOT)                      10:31 AM
  조사 시작합니다. 예상 소요: 10분

  수현 (BOT)                      10:41 AM
  ━━━ 삼성SDS 시장 조사 보고서 ━━━

  매출: 13.8조 (2025)
  클라우드 사업 비중: 34%
  주요 경쟁사: NHN Cloud, Naver Cloud

  전체 보고서: [Drive 링크]

승현                              10:42 AM
/ask 민준 이거 기반으로 김부장한테 콜드메일 보내

  민준 (BOT)                      10:43 AM
  보고서 확인했습니다. 이메일 작성 중...

  민준 (BOT)                      10:45 AM
  김부장님께 이메일 발송 완료했습니다.

  제목: "클라우드 전환, 함께 고민해보실까요?"
```

### 채팅에서의 경험 (Slack 예시)

```
#sales
───────────────────────────────────────────

승현                              10:30 AM
/ask 수현 삼성SDS 클라우드 사업 조사해줘

  수현 (APP)                      10:31 AM
  조사 시작합니다. 예상 소요: 10분
  [스레드에서 결과 확인]
```

### Discord/Slack이 해결하는 것

| 문제 | 해결 |
|------|------|
| 채팅 서버 구축 | 불필요 |
| 모바일 앱 | Discord/Slack 앱 |
| Push 알림 | Discord/Slack 알림 |
| 팀원 초대 | 서버/워크스페이스 초대 |
| 채널 관리 | 네이티브 채널 |
| 권한 관리 | 역할/권한 |
| 스레드 | 네이티브 스레드 |
| 파일 공유 | 네이티브 첨부 |

### 플랫폼 비교

| | Discord | Slack |
|---|---|---|
| 타겟 | 개발자, 작은 팀 | 비즈니스, 기업 |
| 슬래시 커맨드 | 지원 | 지원 |
| Webhook 페르소나 | username + avatar_url | Bot identity |
| 무료 범위 | 충분 | 메시지 90일 제한 |
| 모바일 | 좋음 | 좋음 |

---

## 5. Google Workspace CLI (gws)

```bash
# 에이전트가 내부적으로 실행 (사용자는 안 봄):
gws gmail messages send --to "kim@samsung.com" --subject "미팅 제안" --body "..."
gws gmail messages list --query "is:unread"
gws calendar events create --summary "삼성SDS 미팅" --start "2026-03-15T14:00:00"
gws drive files list --query "name contains '보고서'"
```

| 에이전트 | gws 명령 | 용도 |
|---------|---------|------|
| 세일즈 | `gws gmail messages send` | 콜드메일 발송 |
| 세일즈 | `gws calendar events create` | 미팅 일정 생성 |
| 리서처 | `gws drive files create` | 보고서 저장 |
| 이메일봇 | `gws gmail messages list` | 수신 모니터링 |

---

## 6. Hire & Fire

### instructions가 전부다

에이전트의 품질 = instructions의 품질이다.
같은 도구, 같은 모델이라도 instructions가 다르면 완전히 다른 결과가 나온다.

```
나쁜 instructions:
  "시장 조사를 해주세요."
  → 뭘 조사? 어떤 형식? 어디에 저장? → 결과가 산만

좋은 instructions:
  "당신은 시장 조사 전문가입니다. 조사 대상 기업의 매출, 사업 구조,
   경쟁 환경을 체계적으로 분석합니다. 항상 수치와 출처를 포함하세요.
   조사 결과는 Drive에 보고서로 저장하고, 요약을 채팅에 올립니다.
   이메일 발송이나 일정 관리는 절대 하지 마세요."
  → 범위 명확, 출력 형식 명확, 경계 명확 → 결과가 뾰족
```

모든 에이전트는 **claude-opus-4-6** 모델을 사용한다.
모델이 동일하므로, 차별화는 오직 instructions에서 온다.

Hiring Agent(메타 에이전트)의 핵심 역할:
1. 파운더의 자연어 → 뾰족한 instructions 생성
2. 범위(하는 것)와 경계(안 하는 것)를 명확히 분리
3. 출력 형식과 저장 위치 명시
4. 파운더에게 미리보기 → 수정 → 확정

```
Hiring Agent 실행 방식:
  → 사용자 맥의 Claude Code CLI subprocess (다른 에이전트와 동일)
  → instructions는 Flaude 앱에 내장 (하드코딩)
  → 출력: JSON 형태의 AgentDefinition
  → 사용자가 확인 → 서버 API로 저장

  claude -p "시장 조사 잘하는 리서처 뽑아줘. 꼼꼼하게." \
    --model opus \
    --system-prompt "[Flaude 내장] 당신은 에이전트 설계 전문가입니다.
      사용자의 요청을 분석해서 AgentDefinition JSON을 생성하세요.
      반드시 포함: name, role, instructions, tools, not_allowed.
      instructions는 구체적이고 뾰족하게. 경계를 명확히." \
    --allowedTools ""
    → 도구 없음 (텍스트 생성만)
```

파운더가 직접 instructions를 편집할 수도 있다 (Edit 화면에서).

### Hire = 뾰족한 에이전트 설계

```
Flaude 앱에서:
파운더: "시장 조사 잘하는 리서처 뽑아줘. 꼼꼼하게 데이터 중심으로."

→ AgentDefinition 설계:
  이름:         수현
  역할:         리서처 (Market Research)
  instructions: "당신은 시장 조사 전문가입니다. 조사 대상 기업의 매출, 사업 구조,
                 경쟁 환경을 체계적으로 분석합니다. 항상 수치와 출처를 포함하세요.
                 조사 결과는 Drive에 보고서로 저장하고, 요약을 채팅에 올립니다.
                 이메일 발송이나 일정 관리는 절대 하지 마세요."
  도구:         WebSearch, WebFetch, Bash(gws drive), Read, Write
  안 하는 것:   이메일 발송, 일정 관리
  모델:         claude-opus-4-6 (전 에이전트 동일)

→ 서버에 저장 (팀 공유)
→ 아바타 자동 생성
→ Discord/Slack에 봇으로 등장
→ 채널 제한 설정 시 해당 채널에서만 호출 가능 (미설정 시 전체)
```

### 세일즈/마케팅 에이전트 템플릿

Hire 할 때 빈 캔버스가 아니라, 검증된 템플릿을 제공한다.

```
[리서처]     시장 조사, 경쟁사 분석, 산업 트렌드
[세일즈]     콜드메일 작성/발송, 미팅 일정 관리
[마케터]     콘텐츠 작성, SNS 포스팅, 뉴스레터
[CS]        고객 문의 초안 작성, FAQ 관리
[어시스턴트]  일정 관리, 회의록 정리, 리마인더
```

### Team = 에이전트 조합

```
Flaude 앱에서:
파운더: "수현이랑 민준 묶어서 영업팀 만들어줘. 조사 끝나면 바로 메일 보내게."

→ Team 생성:
  이름:       영업팀
  멤버:       수현 → 민준
  실행 방식:   순차 (수현 완료 후 민준)
  트리거:     수현 결과를 민준 프롬프트에 주입

→ /ask 영업팀 으로 호출 가능
```

### Fire = 잘못된 설계 폐기

```
Flaude 앱에서:
파운더: [Fire] 클릭 또는 "수현 해고해"

→ status: active → fired
→ 채팅 봇 비활성화
→ 히스토리/보고서는 보존
```

---

## 7. 기술 스택

### 핵심 기술 결정

**왜 Agent SDK가 아니라 Claude Code CLI인가?**

```
Claude Agent SDK (Python/TS):
  - API 키 필수 (ANTHROPIC_API_KEY)
  - 토큰당 과금
  - OAuth/Max 구독 사용 불가
  → "API 비용 없음" 전제가 깨짐 ❌

Claude Code CLI (subprocess):
  - Claude Code Max 구독으로 동작
  - 정액제, 추가 비용 없음
  - 세션 관리: --session-id, --resume
  - 도구 제한: --allowedTools
  - 모델 선택: --model claude-opus-4-6
  → 우리 아키텍처에 적합 ✅

실행 방식:
  Rust(Tauri) → spawn("claude", ["-p", prompt, "--model", "claude-opus-4-6",
                                  "--allowedTools", "WebSearch,Read,Write,Bash",
                                  "--session-id", session_id])
  → stdout으로 결과 수신 → WebSocket → flaude.com → Discord/Slack
```

**왜 Django sidecar가 불필요한가?**

```
기존: Tauri → Django sidecar(Python) → Agent SDK → Claude API
변경: Tauri → Rust subprocess → Claude Code CLI → Claude Code Max

Django가 하던 일:
  - Agent SDK 실행       → Rust가 CLI subprocess로 대체
  - 에이전트 정의 로드    → Rust가 서버 API에서 가져옴
  - 세션 관리            → CLI --session-id 플래그
  - gws 실행             → CLI가 Bash 도구로 직접 실행

Django가 여전히 필요한 곳: flaude.com 서버 (Auth, DB, Bot Gateway)
로컬에서는 불필요.
```

### 스택 테이블

| 레이어 | 기술 | 역할 |
|--------|------|------|
| **App Shell** | Tauri 2.0 (Rust) | 데스크톱 앱. ~3MB. Agent Runner 내장 |
| **App UI** | Vite + React + Tailwind + shadcn/ui | 에이전트 관리 대시보드 (static build) |
| **Agent Runner** | Rust → Claude Code CLI subprocess | 에이전트 실행. Max 구독 사용 |
| **Agent Runtime** | Claude Code Max (claude CLI) | --session-id, --allowedTools, --model |
| **WebSocket Client** | tokio-tungstenite (Rust) | Tauri ↔ flaude.com 실시간 통신 |
| **Google** | gws CLI | Gmail, Calendar, Drive (Claude Code Bash 도구로 실행) |
| **Server** | Django 5 + DRF | flaude.com. Auth, Bot Gateway, WebSocket Hub |
| **Discord Bot** | discord.py | flaude.com 서버에서 실행 |
| **Slack Bot** | Slack Bolt (Python) | flaude.com 서버에서 실행 |
| **Server WebSocket** | Django Channels + Redis | 서버 ↔ 다수 Tauri 앱 연결 관리 |
| **Server LLM** | Claude Haiku API | /client 파싱 등 경량 서버 작업 |
| **Local DB** | SQLite | 세션 매핑, 실행 로그 |
| **Server DB** | PostgreSQL | 에이전트 정의, 클라이언트, 사용자, 팀 |
| **Avatar** | DiceBear / Boring Avatars | 에이전트 프로필 + 봇 프사 |

### 에이전트 실행 상세

```
1. 사용자가 /ask 수현 삼성SDS 조사해줘
2. flaude.com Bot Gateway가 수신 → 3초 내 ACK 응답
3. Task Router → WebSocket → 사용자 Tauri 앱

4. Tauri (Rust) Agent Runner:
   a. 서버에서 에이전트 정의 로드 (캐시됨)
      → { name: "수현", instructions: "...", tools: [...] }

   b. Claude Code CLI subprocess 실행:

      claude -p "삼성SDS 조사해줘" \
        --model opus \
        --system-prompt "당신은 시장 조사 전문가입니다. 조사 대상 기업의..." \
        --allowedTools "WebSearch,WebFetch,Read,Write,Bash" \
        --session-id "550e8400-e29b-41d4-a716-446655440000" \
        --permission-mode bypassPermissions

      → --system-prompt: instructions 직접 전달 (CLAUDE.md 불필요)
      → --allowedTools: 에이전트별 도구 제한
      → --session-id: 세션 관리 (UUID)
      → --permission-mode bypassPermissions: 자동 실행 (권한 확인 없이)
      → -p: 완료 후 결과 텍스트 출력 (스트리밍 없음)

   c. 실행 완료 → stdout 결과 → WebSocket → flaude.com → Discord/Slack 스레드

5. 결과 완료 → execution_logs에 저장

후속 질문 (같은 스레드):
  claude -p "경쟁사 부분 더 자세히" \
    --resume "550e8400-e29b-41d4-a716-446655440000"
    → 이전 맥락 유지
```

### CLI 플래그 매핑

| AgentDefinition 필드 | Claude Code CLI 플래그 |
|---------------------|----------------------|
| instructions | `--system-prompt` |
| tools | `--allowedTools` |
| not_allowed | `--disallowedTools` |
| model | `--model opus` (전 에이전트 동일) |
| 세션 생성 | `--session-id [UUID]` |
| 세션 재개 | `--resume [session_id]` |
| 세션 포크 | `--fork-session --resume [session_id]` |
| 비대화형 실행 | `-p` (--print) |
| 결과만 출력 | `-p` (완료 후 텍스트 반환) |
| 자동 권한 | `--permission-mode bypassPermissions` |

### 팀 실행 (Orchestrator)

```
/ask 영업팀 삼성SDS 조사하고 콜드메일 보내줘

Rust Orchestrator:
  1. 영업팀 정의 로드: [수현(순서1), 민준(순서2)]

  2. 수현 실행:
     claude -p "삼성SDS 조사해줘" --model claude-opus-4-6 ...
     → 결과: "삼성SDS 보고서..." + Drive 링크
     → 스레드에 중간 결과 올림

  3. 민준 실행:
     claude -p "다음 보고서를 기반으로 김부장에게 콜드메일 보내줘: [수현 결과]" ...
     → 결과: "메일 발송 완료"
     → 스레드에 최종 결과 올림

순차 실행: 앞 에이전트 stdout → 뒤 에이전트 prompt에 주입
병렬 실행: 여러 subprocess 동시 실행 → 전부 완료 후 취합
```

### Slack 페르소나 제약 대응

```
Discord:
  Webhook으로 에이전트별 이름/아바타 전환 가능 ✅
  → username="수현", avatar_url="..."

Slack:
  username/icon_url 커스텀 deprecated ❌
  → 대안: 메시지 포맷으로 구분

  [수현 · 리서처]
  삼성SDS 시장 조사 보고서입니다.
  매출: 13.8조 (2025)...

  → Block Kit으로 에이전트 헤더 + 아바타 이미지 포함 가능
  → Slack Block Kit의 context block으로 에이전트 프로필 표시
```

---

## 8. 핵심 플로우: 세일즈 자동화

이것이 Flaude의 주력 유스케이스다.

```
Step 1: 에이전트 설계 (Flaude 앱)
  파운더: "리서처 한 명이랑 세일즈 한 명 뽑아줘"
  → 수현: 시장 조사 전문 (WebSearch, Drive만)
  → 민준: 영업 전문 (Gmail, Calendar만)

Step 2: 채팅에서 지시
  파운더: "/ask 수현 삼성SDS 조사해줘"
  → flaude.com 서버 → WebSocket → 파운더 맥
  → 수현: (WebSearch → 데이터 수집 → 보고서) "완료. [보고서]"

Step 3: 후속 지시
  파운더: "/ask 민준 이 보고서 기반으로 김부장한테 메일 보내"
  → 민준: (보고서 읽기 → 메일 작성 → gws gmail send) "발송 완료"

Step 4: 응답 처리
  민준: "김부장님 답장: '화요일 가능합니다'"
  파운더: "/ask 민준 화요일 2시에 잡아"
  → 민준: (gws calendar events create) "3/17 14시 미팅 잡음"

전부 Discord/Slack에서. 모바일에서도.
```

### 세일즈 파이프라인

```
[리드 발굴]  →  [조사]  →  [콜드메일]  →  [미팅]  →  [팔로업]
   수현         수현        민준         민준        민준

각 단계가 에이전트에게 매핑.
Clients 페이지에서 파이프라인 상태 한눈에.
```

---

## 9. 디자인 — Claude Code 감성

Flaude 앱 (에이전트 관리 대시보드):

```
Colors:
  Primary:     #D97706 (Warm Amber)
  Background:  #FAF9F6 (Off-White Cream)
  Surface:     #FFFFFF
  Text:        #1A1A1A
  Muted:       #6B7280
  Active:      #059669 (Green)
  Working:     #D97706 (Amber, 작업 중)
  Fired:       #DC2626 (Red)

Typography:
  Heading:     Libre Baskerville (Serif)
  Body:        Inter
  Mono:        JetBrains Mono

Fun:
  - 에이전트별 고유 아바타 (DiceBear → 봇 프사에도 적용)
  - Hire 시 "Welcome aboard!" 애니메이션
  - Fire 시 "수현이 짐을 싸고 있습니다..." 토스트
  - 에이전트 프로필에 성과 통계 (완료 건수, 평균 소요 시간)
```

---

## 10. 수익 모델 (후순위, 기술적 준비만)

초기에는 완전 무료. 유저가 붙으면 아래 게이트로 수익화.

### Flaude의 비용 구조

```
사용자가 부담하는 것:
  - Claude Code Max 구독 ($100-200/mo per person) → Anthropic에 직접 지불
  - Discord/Slack → 무료
  - Google Workspace → 이미 쓰고 있는 것

Flaude가 부담하는 것 (= 수익으로 커버해야 할 것):
  - flaude.com 서버 (Django, PostgreSQL, Redis)
  - WebSocket Hub (동시 접속 관리)
  - Discord/Slack Bot Gateway (상시 실행)
  - /client 파싱 Haiku API 호출 비용
  - .dmg 코드사인 / 배포
```

### 과금 게이트 (기술적으로 서버에서 제어)

```
서버가 제어하는 것:
  - 에이전트 정의 수 (agents 테이블 count)
  - 팀(그룹) 수 (agent_teams 테이블 count)
  - 클라이언트 수 (clients 테이블 count)
  - /client 파싱 횟수 (월별 Haiku API 호출 수)

과금 게이트로 쓸 수 없는 것:
  - 팀원 수 → 각자 Max 구독이고 WebSocket 하나 더일 뿐. 제한 이유 없음
  - Claude Code CLI 실행 횟수 → 사용자 맥에서 실행
  - gws 호출 횟수 → 사용자 맥에서 실행
```

### 플랜

```
Free        $0/mo   에이전트 3명, 클라이언트 20개
                    팀(그룹) 1개
                    /client 파싱 월 50회
                    팀원 무제한

Pro        $29/mo   에이전트 10명, 클라이언트 200개
                    팀(그룹) 5개
                    /client 파싱 무제한
                    세일즈 템플릿 전체

Business   $79/mo   에이전트 무제한, 클라이언트 무제한
                    팀(그룹) 무제한
                    우선 지원
```

### 기술 구현

```sql
-- 서버 DB에 플랜 제한 테이블
CREATE TABLE team_plans (
    id              SERIAL PRIMARY KEY,
    team_id         INTEGER REFERENCES teams(id) UNIQUE,
    plan            TEXT DEFAULT 'free',    -- free / pro / business
    max_agents      INTEGER DEFAULT 3,
    max_clients     INTEGER DEFAULT 20,
    max_agent_teams INTEGER DEFAULT 1,
    client_parses_used INTEGER DEFAULT 0,   -- 월별 리셋
    client_parses_limit INTEGER DEFAULT 50,
    billing_cycle_start TIMESTAMPTZ,
    created_at      TIMESTAMPTZ
);
```

```
제한 체크 위치:

  에이전트 Hire 시:
    → Tauri 앱 → POST /api/agents/ → 서버가 count 확인
    → 초과 시 402 반환 → "업그레이드가 필요합니다"

  /client 파싱 시:
    → Bot Gateway → Haiku API 호출 전 client_parses_used 확인
    → 초과 시 "이번 달 파싱 한도 초과" 응답

  /ask 실행 시:
    → 제한 없음. 로컬 실행이므로 서버가 막을 수 없고, 막을 이유도 없음.
    → Claude Code Max 비용은 사용자가 이미 내고 있음.
```

### 과금 트리거 (자연스러운 전환 시점)

```
Free 유저가 Pro로 넘어가는 순간:
  "에이전트 4번째 만들려는데" → 업그레이드
  "클라이언트 21번째 등록하려는데" → 업그레이드

핵심: /ask 실행은 절대 막지 않음.
      이미 만들어진 에이전트는 무료든 유료든 동일하게 동작.
      과금은 "더 만들고 싶을 때"만 발생.
```

---

## 11. MVP 로드맵

### Phase 1: 기반 (2주)
- [ ] Tauri 2.0 + Vite + React 프로젝트 셋업
- [ ] Rust Agent Runner (Claude Code CLI subprocess)
- [ ] 에이전트 1개 생성 → Claude Code로 실행
- [ ] flaude.com 서버 + WebSocket Hub

### Phase 2: 봇 연동 (2주)
- [ ] Discord Bot (서버 사이드) + 슬래시 커맨드
- [ ] Slack Bot (서버 사이드) + 슬래시 커맨드
- [ ] WebSocket 라우팅: 봇 → 서버 → 사용자 맥
- [ ] Webhook 페르소나 (에이전트별 이름/아바타)

### Phase 3: Hire/Fire (2주)
- [ ] 자연어로 에이전트 Hire (AgentDefinition 동적 생성)
- [ ] 세일즈/마케팅 에이전트 템플릿
- [ ] Fire / Re-hire
- [ ] 에이전트 프로필 카드 (아바타, scope, NOT allowed)

### Phase 4: gws + Clients (2주)
- [ ] gws 내장 + OAuth 셋업 위자드
- [ ] Gmail 발송, Calendar 일정 생성
- [ ] Clients 관리 페이지 (세일즈 파이프라인)

### Phase 5: 팀 공유 (2주)
- [ ] 에이전트 정의 동기화 (서버)
- [ ] 팀원이 같은 에이전트를 채팅에서 사용
- [ ] 에이전트 실행 = 명령한 사람의 맥에서

### Phase 6: 배포 (1주)
- [ ] Flaude.dmg 빌드 + 코드사인
- [ ] flaude.com 랜딩 + 다운로드
- [ ] 온보딩 셋업 위자드

---

## 12. 리스크

| 리스크 | 심각도 | 대응 |
|--------|--------|------|
| 맥 꺼지면 내가 호출한 에이전트 멈춤 | 의도된 제약 | V2: Mac Mini 상시 실행 |
| Claude Code Max Rate Limit | 중 | 에이전트 큐잉. Max 동시 요청 수 확인 필요 |
| Claude Code CLI 버전/API 변경 | 중 | CLI 버전 고정. 업데이트 시 호환성 테스트 |
| gws 인증 토큰 만료 | 낮 | 앱 내 자동 갱신 |
| Discord/Slack API Rate Limit | 낮 | 메시지 큐잉 |
| 슬래시 커맨드 3초 제한 | 낮 | 즉시 ACK → deferred response 패턴 |
| WebSocket 끊김 | 중 | 자동 재연결 + 오프라인 큐 |
| 서버 단일 장애점 | 중 | 서버 다운 시 채팅 명령 불가. 앱 직접 실행은 가능 |
| Slack 페르소나 전환 불가 | 낮 | Block Kit으로 에이전트 헤더 표시 |
| /client 서버 파싱 비용 | 낮 | Haiku API 사용 (건당 ~$0.001 이하) |
| Claude Code Max 동시 세션 제한 | 중 | Agent Runner에서 FIFO 큐잉. 동시 제한 수 확인 필요 |
| gws CLI + Claude Code 연동 | 낮 | gws 자체는 검증됨. Claude Code가 Bash로 gws를 잘 실행하는지만 확인 |

---

## 13. 한 줄 요약

> **Flaude 앱에서 세일즈/마케팅 에이전트를 만들고, Discord/Slack에서 슬래시 커맨드로 부른다.**
