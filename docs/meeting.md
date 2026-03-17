# Meeting Assistant (회의 비서) 기획

## 개요
회의 녹음 → 자동 전사 → 에이전트 처리 파이프라인.
로컬에서 whisper.cpp로 전사하여 프라이버시 보장.

---

## 핵심 컨셉

### 회의는 "기능", 에이전트는 "도구"
- 회의 비서라는 별도 에이전트를 만들지 **않음**
- 회의 탭은 독립 기능으로 존재 (녹음 → 전사 → 저장)
- 전사 후 기존 에이전트 아무나 선택해서 처리
  - Min한테 요약, Ria한테 제안서, sales팀 전체에 분석

### 옵트인 활성화
- 설정에서 "회의 기록" 켜야 사이드바에 "회의" 탭 노출
- 켤 때 의존성 설치 가이드 표시
- 기본 OFF → 필요한 사용자만 설치

### 글로벌 단축키: 녹음 토글
- **Cmd+Shift+R** (기본값, 설정에서 변경 가능)
- 1번 누르면 녹음 시작, 다시 누르면 녹음 중지 → 자동 전사
- 어떤 화면에 있든 동작 (Tauri global-shortcut 플러그인)
- 참고: fn+Space는 macOS Dictation/입력소스 전환과 충돌하여 사용 불가

---

## 사용 흐름

### 기본 흐름
```
1. 설정 → "회의 기록" ON → 의존성 설치 (whisper-cpp, ffmpeg, BlackHole)
2. 구글 미트 접속
3. Cmd+Shift+R → 녹음 시작 (시스템 트레이/사이드바에 빨간 점 표시)
4. 회의 진행
5. Cmd+Shift+R → 녹음 중지 → 자동 전사 시작
6. 회의 탭에서 전사본 확인 (필요하면 수동 편집)
7. 에이전트/팀 선택 → 처리 유형 선택 → 결과 확인
```

### 파일 업로드/임포트 흐름
```
1. 회의 탭 → [파일 업로드] 또는 [전사본 임포트]
2-a. 오디오 파일(mp3/m4a/wav) → whisper.cpp 전사
2-b. 자막 파일(.vtt/.srt) 또는 텍스트 → 직접 임포트 (전사 불필요)
3. 에이전트 처리
```

---

## UX 설계

### 네비게이션 (회의 기록 활성화 시)
```
사이드바: [멤버] [팀] [고객] [회의] ← 설정에서 ON 시에만 노출
                                [설정]
```

### 녹음 상태 (글로벌 — 어느 페이지든 표시)
```
┌─────────────┐
│  Flaude     │
│  ● 00:32:15 │  ← 빨간 점 + 경과 시간
│  Cmd+Shift+R│  ← 중지 힌트
├─────────────┤
│  멤버       │
│  팀         │
│  ...        │
```

### 회의 페이지
```
┌──────────────────────────────────────────────────────┐
│  회의                  [● 녹음 시작] [업로드] [임포트]  │
├──────────────┬───────────────────────────────────────┤
│  목록         │  상세                                  │
│              │                                       │
│  3/12 14:00  │  3월 기획 회의                          │
│  기획 회의  ✅│  2026-03-12 14:00 · 32분 · small 모델  │
│              │  참석: 김부장, 이대리                    │
│  3/10 11:00  │  고객: 삼성SDS                          │
│  고객 미팅  ✅│                                       │
│              │  ── 전사본 ── [편집] [복사]              │
│  3/8 15:00   │  [00:00] 오늘 안건은 신규 프로젝트...    │
│  내부 회의  ⏳│  [00:15] 네, 저는 일정 관련해서...      │
│              │  [00:32] 그러면 다음 주까지...           │
│              │                                       │
│              │  ── 에이전트 처리 ──                    │
│              │  대상: [Min ▼] 또는 [sales팀 ▼]         │
│              │  [요약] [액션아이템] [팔로업메일] [제안서] │
│              │  [처리 시작]                            │
│              │                                       │
│              │  ── 결과 ──                            │
│              │  ▸ Min의 요약 (3/12 14:35)              │
│              │  ▸ Ria의 제안서 (3/12 14:40)            │
└──────────────┴───────────────────────────────────────┘
```

### 설정 — 회의 기록 섹션
```
회의 기록 [ON/OFF 토글]
─────────────────────────────
의존성 설치
├ whisper-cpp:  ✅ 설치됨
├ ffmpeg:       ✅ 설치됨
├ BlackHole:    ❌ 미설치  [설치]
│   ⚠ 설치 후 "오디오 MIDI 설정"에서 다중 출력 장치 생성 필요
│   [설정 가이드 보기]

음성 모델
├ small (490MB) ✅ 다운로드됨  [사용 중]
├ base (140MB)  ✅ 다운로드됨
├ medium (1.5GB) [다운로드]
├ large (2.9GB)  [다운로드] ⚠ 느림

오디오 소스
├ ● 시스템 오디오 (BlackHole) — 화상회의용
├ ○ 마이크 — 대면 회의용
├ ○ 사용자 지정 장치

녹음 설정
├ 단축키: [Cmd+Shift+R] [변경]
├ 최대 녹음 시간: [2시간 ▼]
├ 무음 5분 시 알림: [ON]
├ 전사 완료 후 오디오 삭제: [ON]
├ 기본 언어: [한국어 ▼]
```

---

## 기술 스택

### 녹음
- **BlackHole 2ch** — 시스템 오디오 캡처 (화상회의용)
- **마이크 입력** — 대면 회의용 (BlackHole 불필요)
- **ffmpeg** — 오디오 캡처 → WAV 16kHz 모노 저장
- **Tauri global-shortcut** — Cmd+Shift+R 토글
- 녹음 시작 시 macOS "방해 금지 모드" 활성화 권장 안내

### 전사
- **whisper.cpp** — 로컬 음성 인식
- 권장 모델: **small** (490MB, 한국어 정확도 우수)
- JSON 출력 (`-oj`) → 타임스탬프 + 텍스트 세그먼트
- 긴 전사본(10,000자+) → 자동 청크 분할 후 순차 처리

### 임포트
- 오디오 파일: mp3, m4a, wav → whisper.cpp 전사
- 자막 파일: .vtt, .srt → 파싱 후 직접 저장 (전사 불필요)
- 텍스트 파일: .txt → 그대로 저장

### 에이전트 처리
- 기존 `run_claude()` 오케스트레이터 활용
- 처리 유형별 프롬프트 템플릿
- 화자 미분리 시: 참석자 목록과 함께 Claude에게 화자 추정 요청

### 파일 관리
- 저장 경로: `~/Documents/Flaude/recordings/`
- 전사 완료 후 오디오 자동 삭제 (기본 ON, 설정 가능)
- 수동 보관 원하면 OFF으로 변경

---

## 데이터 모델

### Meeting
- workspace (FK)
- title
- meeting_date (datetime)
- duration_seconds
- participants (JSON array) — ["김부장", "이대리"]
- client (FK, nullable) — 고객 미팅이면 연결
- audio_filename — 로컬 파일 경로
- whisper_model (default: "small")
- audio_source — "system" / "mic" / "upload" / "import"
- status: recording / uploaded / transcribing / completed / failed
- notes
- created_by (FK User)

### MeetingTranscript
- meeting (OneToOne)
- full_text — 전체 텍스트
- segments (JSON) — [{start, end, text}, ...]
- language (default: "ko")

### MeetingAgentResult
- meeting (FK)
- agent (FK)
- processing_type: summary / action_items / follow_up_email / proposal / custom
- result (text)
- execution_log (FK, nullable)

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/workspaces/{ws}/meetings` | 목록 |
| POST | `/workspaces/{ws}/meetings` | 생성 |
| GET/PUT/DELETE | `/meetings/{id}` | CRUD |
| POST | `/meetings/{id}/transcript` | 전사본 저장 |
| GET | `/meetings/{id}/transcript` | 전사본 조회 |
| PUT | `/meetings/{id}/transcript` | 전사본 수정 (수동 편집) |
| POST | `/meetings/{id}/process` | 에이전트 처리 |
| GET | `/meetings/{id}/results` | 처리 결과 목록 |

### 처리 유형별 프롬프트 템플릿
```python
MEETING_PROMPTS = {
    "summary": (
        "다음 회의 녹취록을 요약해주세요.\n"
        "주요 논의 사항, 결정 사항, 참석자별 발언 요점을 정리해주세요.\n"
        "참석자: {participants}\n\n"
        "녹취록:\n{transcript}"
    ),
    "action_items": (
        "다음 회의 녹취록에서 액션 아이템을 추출해주세요.\n"
        "담당자, 할 일, 기한을 표 형식으로 정리해주세요.\n"
        "참석자: {participants}\n\n"
        "녹취록:\n{transcript}"
    ),
    "follow_up_email": (
        "다음 회의 내용을 바탕으로 참석자들에게 보낼 팔로업 이메일을 작성해주세요.\n"
        "회의 요약, 결정사항, 다음 단계를 포함하세요.\n"
        "참석자: {participants}\n\n"
        "녹취록:\n{transcript}"
    ),
    "proposal": (
        "다음 회의에서 논의된 내용을 바탕으로 제안서 초안을 작성해주세요.\n"
        "참석자: {participants}\n\n"
        "녹취록:\n{transcript}"
    ),
}
```

---

## Tauri 커맨드

| 커맨드 | 설명 |
|--------|------|
| `start_recording(source, path)` | ffmpeg 녹음 시작 (source: "blackhole"/"mic") |
| `stop_recording()` | SIGINT → WAV 저장 |
| `get_recording_status()` | {status, path, elapsed_seconds} |
| `transcribe_audio(path, model, lang)` | whisper.cpp → JSON |
| `check_whisper_installed()` | 설치 여부 |
| `check_blackhole_installed()` | 설치 여부 |
| `check_ffmpeg_installed()` | 설치 여부 |
| `download_whisper_model(name)` | HuggingFace 다운로드 |
| `list_whisper_models()` | 설치된 모델 목록 |
| `install_blackhole()` | brew install blackhole-2ch |
| `install_whisper()` | brew install whisper-cpp |
| `install_ffmpeg()` | brew install ffmpeg |
| `parse_subtitle(path)` | .vtt/.srt 파싱 → JSON |

Tauri 플러그인 추가:
- `tauri-plugin-global-shortcut` — Cmd+Shift+R 단축키
- `tauri-plugin-dialog` — 파일 선택 다이얼로그

---

## 에러 처리 & 복구

### 앱 크래시 시 고아 ffmpeg 프로세스
- ffmpeg PID를 `/tmp/flaude_recording.pid`에 저장
- 앱 시작 시: PID 파일 존재하면 프로세스 확인 → 정리
- "이전 녹음이 비정상 종료되었습니다. 파일을 복구하시겠습니까?" 안내

### 전사 실패
- whisper.cpp 크래시 → status "failed" + 에러 메시지 저장
- "다시 전사" 버튼 제공
- 모델 변경 후 재시도 가능

### 긴 전사본 처리
- 10,000자 초과 시 자동 분할
- 각 청크를 순차 요약 → 최종 종합 요약
- 처리 중 프로그레스 표시

---

## 구현 우선순위

### MVP (Phase 1) — 파일 기반
1. Django 모델 + API (Meeting, Transcript, AgentResult)
2. Tauri: whisper 설치 확인 + 전사 커맨드
3. 프론트: 회의 탭 + 파일 업로드 + 전사 + 전사본 열람
4. 프론트: 에이전트 선택 → 처리 → 결과 표시
5. 설정: 옵트인 토글 + whisper 모델 다운로드
6. .vtt/.srt 임포트 지원

### Phase 2 — 실시간 녹음
7. Tauri: ffmpeg 녹음 start/stop + 오디오 소스 선택
8. Tauri: global-shortcut (Cmd+Shift+R)
9. 프론트: 글로벌 녹음 상태 바 (빨간 점 + 시간)
10. BlackHole 설치 가이드 + 다중 출력 장치 안내
11. 마이크 입력 모드
12. 최대 녹음 시간 + 무음 감지
13. 고아 프로세스 복구

### Phase 3 — 고급
14. 전사본 수동 편집 UI
15. 긴 전사본 청크 분할 처리
16. 화자 추정 (참석자 목록 기반 Claude 추정)
17. Discord `/meeting` 커맨드
18. 고객 파이프라인 자동 연동
19. 단축키 사용자 지정

---

## 수정 파일

| 파일 | 변경 |
|------|------|
| `server/agents/models.py` | Meeting, MeetingTranscript, MeetingAgentResult |
| `server/agents/api.py` | 스키마 + CRUD + process + transcript edit |
| `server/agents/migrations/` | 마이그레이션 |
| `app/src-tauri/src/lib.rs` | whisper + 녹음 + 설치 + 자막파싱 커맨드 |
| `app/src-tauri/Cargo.toml` | global-shortcut, dialog 플러그인 |
| `app/src/api.ts` | Meeting 타입 + API 함수 |
| `app/src/App.tsx` | Page, nav, 회의 페이지 UI, 녹음 바, 설정 섹션 |
| `app/src/i18n.ts` | 번역 키 |
| `server/.../run_discord_bot.py` | `/meeting` 커맨드 (Phase 3) |

---

## 열린 질문

- [ ] BlackHole 다중 출력 장치 자동 생성 가능한가? (CoreAudio API / AppleScript)
- [ ] Google Meet 전사본 파일 형식 확인 (SRT? VTT?)
- [ ] whisper.cpp small 모델 한국어 실사용 정확도 테스트 필요
- [ ] 녹음 동의 안내 문구 — 법적 고려사항
- [ ] Tauri global-shortcut이 macOS에서 앱 포커스 없이 동작하는지 확인
