export type Lang = "ko" | "en";

const translations = {
  // Nav
  "nav.members": { ko: "팀원", en: "Members" },
  "nav.teams": { ko: "팀", en: "Teams" },
  "nav.clients": { ko: "고객관리", en: "Clients" },
  "nav.settings": { ko: "설정", en: "Settings" },

  // Members (agents)
  "member.title": { ko: "팀원", en: "Members" },
  "member.create": { ko: "팀원 만들기", en: "New Member" },
  "member.edit": { ko: "팀원 수정", en: "Edit Member" },
  "member.name": { ko: "이름", en: "Name" },
  "member.role": { ko: "역할", en: "Role" },
  "member.instructions": { ko: "지시사항", en: "Instructions" },
  "member.tools": { ko: "사용 도구", en: "Allowed Tools" },
  "member.notAllowed": { ko: "금지 도구", en: "Disallowed Tools" },
  "member.skills": { ko: "스킬", en: "Skills" },
  "member.fire": { ko: "해고", en: "Fire" },
  "member.rehire": { ko: "복직", en: "Rehire" },
  "member.delete": { ko: "삭제", en: "Delete" },
  "member.fired": { ko: "해고됨", en: "Fired" },
  "member.active": { ko: "활동 중", en: "Active" },
  "member.run": { ko: "실행", en: "Run" },
  "member.running": { ko: "실행 중...", en: "Running..." },
  "member.prompt": { ko: "메시지 입력...", en: "Enter message..." },
  "member.save": { ko: "저장", en: "Save" },
  "member.cancel": { ko: "취소", en: "Cancel" },
  "member.discordChannels": { ko: "Discord 채널", en: "Discord Channels" },
  "member.discordChannelsHint": {
    ko: "채널 ID, 쉼표로 구분. 이 채널의 모든 메시지에 자동 응답",
    en: "Channel IDs, comma-separated. Auto-responds to all messages in these channels",
  },
  "member.noMembers": { ko: "아직 팀원이 없습니다", en: "No members yet" },
  "member.createFirst": { ko: "첫 팀원을 만들어보세요!", en: "Create your first member!" },

  // AI prompt generation
  "ai.generate": { ko: "AI로 생성", en: "AI Generate" },
  "ai.generateHint": { ko: "어떤 팀원인지 한 줄로 설명", en: "Describe the member in one line" },
  "ai.generating": { ko: "생성 중...", en: "Generating..." },

  // Teams
  "team.title": { ko: "팀", en: "Teams" },
  "team.create": { ko: "팀 만들기", en: "New Team" },
  "team.name": { ko: "팀 이름", en: "Team Name" },
  "team.members": { ko: "팀원", en: "Members" },
  "team.run": { ko: "팀 실행", en: "Run Team" },
  "team.sequential": { ko: "순차", en: "Sequential" },
  "team.parallel": { ko: "병렬", en: "Parallel" },
  "team.lead": { ko: "리드", en: "Lead" },

  // Clients
  "client.title": { ko: "고객관리", en: "Clients" },
  "client.create": { ko: "클라이언트 추가", en: "New Client" },
  "client.company": { ko: "회사", en: "Company" },
  "client.contact": { ko: "담당자", en: "Contact" },
  "client.email": { ko: "이메일", en: "Email" },
  "client.phone": { ko: "전화", en: "Phone" },
  "client.department": { ko: "부서", en: "Department" },
  "client.notes": { ko: "메모", en: "Notes" },
  "client.status": { ko: "상태", en: "Status" },
  "client.assignedAgent": { ko: "담당 팀원", en: "Assigned Member" },
  "client.history": { ko: "히스토리", en: "History" },
  "client.runOn": { ko: "팀원 실행", en: "Run Member" },

  // Client statuses
  "status.new": { ko: "신규", en: "New" },
  "status.researching": { ko: "리서치 중", en: "Researching" },
  "status.contacted": { ko: "연락함", en: "Contacted" },
  "status.meeting": { ko: "미팅", en: "Meeting" },
  "status.closed": { ko: "완료", en: "Closed" },

  // Settings
  "settings.title": { ko: "설정", en: "Settings" },
  "settings.server": { ko: "서버", en: "Server" },
  "settings.connected": { ko: "연결됨", en: "Connected" },
  "settings.disconnected": { ko: "연결 끊김", en: "Disconnected" },
  "settings.integrations": { ko: "연동 서비스", en: "Integrations" },
  "settings.setupAll": { ko: "전체 설치", en: "Setup All" },
  "settings.settingUp": { ko: "설치 중...", en: "Setting up..." },
  "settings.install": { ko: "설치", en: "Install" },
  "settings.connect": { ko: "연결", en: "Connect" },
  "settings.ready": { ko: "완료", en: "Ready" },
  "settings.addToServer": { ko: "서버에 추가", en: "Add to Server" },
  "settings.language": { ko: "언어", en: "Language" },
  "settings.skillLibrary": { ko: "스킬 라이브러리", en: "Skill Library" },
  "settings.skillCount": {
    ko: (n: number) => `팀원에게 붙일 수 있는 스킬 ${n}개가 등록되어 있습니다.`,
    en: (n: number) => `${n} skills available to assign to members.`,
  },

  // Discord guide
  "discord.guide1": { ko: "서버에 추가 클릭 → Discord 서버 선택 → 승인", en: "Click Add to Server → Select Discord server → Authorize" },
  "discord.guide2": { ko: "팀원 탭 → 팀원 편집 → Discord Channels에 채널 ID 입력", en: "Members tab → Edit member → Enter channel IDs in Discord Channels" },
  "discord.guide3": {
    ko: "채널 ID: Discord에서 채널 우클릭 → ID 복사 (개발자 모드 필요)",
    en: "Channel ID: Right-click channel in Discord → Copy ID (Developer Mode required)",
  },

  // Setup Wizard
  "wizard.welcome": { ko: "Flaude에 오신 걸 환영합니다", en: "Welcome to Flaude" },
  "wizard.subtitle": { ko: "에이전트를 팀원처럼 고용하고 관리하세요", en: "Hire and manage AI agents like team members" },
  "wizard.step": { ko: (n: number, total: number) => `${n} / ${total}`, en: (n: number, total: number) => `${n} / ${total}` },
  "wizard.next": { ko: "다음", en: "Next" },
  "wizard.back": { ko: "이전", en: "Back" },
  "wizard.skip": { ko: "건너뛰기", en: "Skip" },
  "wizard.done": { ko: "시작하기", en: "Get Started" },
  "wizard.claudeTitle": { ko: "Claude Code 확인", en: "Claude Code Check" },
  "wizard.claudeDesc": { ko: "Claude Code CLI가 설치되어 있어야 합니다.\nClaude Code Max 구독이 필요합니다.", en: "Claude Code CLI must be installed.\nClaude Code Max subscription required." },
  "wizard.claudeChecking": { ko: "확인 중...", en: "Checking..." },
  "wizard.claudeOk": { ko: "Claude Code 설치됨", en: "Claude Code installed" },
  "wizard.claudeNotFound": { ko: "Claude Code를 찾을 수 없습니다", en: "Claude Code not found" },
  "wizard.gwsTitle": { ko: "Google Workspace 연결", en: "Google Workspace Setup" },
  "wizard.gwsDesc": { ko: "Gmail, Calendar, Drive를 에이전트가 사용할 수 있게 합니다.", en: "Let agents access Gmail, Calendar, and Drive." },
  "wizard.chatTitle": { ko: "팀 채팅 연결", en: "Team Chat Setup" },
  "wizard.chatDesc": { ko: "Discord 또는 Slack에서 에이전트를 호출할 수 있습니다.", en: "Call your agents from Discord or Slack." },

  // Templates
  "template.title": { ko: "템플릿으로 시작", en: "Start from Template" },
  "template.custom": { ko: "직접 만들기", en: "Custom" },
  "template.use": { ko: "사용", en: "Use" },

  // Hire flow
  "hire.howToCreate": { ko: "어떻게 만들까요?", en: "How would you like to create?" },
  "hire.fromTemplate": { ko: "템플릿으로", en: "From Template" },
  "hire.templateDesc": {
    ko: (n: number) => `검증된 ${n}개 에이전트 프리셋.`,
    en: (n: number) => `${n} proven agent presets.`,
  },
  "hire.fromScratch": { ko: "직접 만들기", en: "From Scratch" },
  "hire.scratchDesc": { ko: "역할, 지시사항, 도구를 직접 설정.", en: "Set up role, instructions, and tools manually." },
  "hire.chooseTemplate": { ko: "템플릿 선택", en: "Choose a Template" },
  "hire.editMember": { ko: "팀원 수정", en: "Edit Member" },
  "hire.hireMember": { ko: "팀원 채용", en: "Hire Member" },
  "hire.changeMode": { ko: "다른 방법으로", en: "Change mode" },
  "hire.hire": { ko: "채용", en: "Hire" },
  "hire.skillBrowserShow": { ko: "스킬 라이브러리 보기", en: "Browse Skill Library" },
  "hire.skillBrowserHide": { ko: "스킬 닫기", en: "Hide Skills" },
  "hire.aiPlaceholder": { ko: "어떤 팀원을 만들까요? (예: 블로그 글을 써주는 팀원)", en: "Describe the member (e.g. writes blog posts)" },
  "hire.aiHint": { ko: "이름/역할 + 설명을 입력하면 AI가 지시사항을 작성합니다.", en: "Enter name/role + description and AI will write the instructions." },
  "hire.instructionPlaceholder": { ko: "직접 작성하거나, AI로 자동 생성하세요.", en: "Write manually or generate with AI." },
  "hire.channelHint": { ko: "채널 ID, 쉼표로 구분", en: "Channel IDs, comma-separated" },
  "hire.channelPlaceholder": { ko: "예: 1234567890, 9876543210", en: "e.g. 1234567890, 9876543210" },

  // Agent chat
  "chat.thinking": { ko: "생각하는 중...", en: "Thinking..." },
  "chat.send": { ko: "보내기", en: "Send" },
  "chat.newChat": { ko: "새 대화", en: "New Chat" },
  "chat.messageAgent": {
    ko: (name: string) => `${name}에게 메시지...`,
    en: (name: string) => `Message ${name}...`,
  },
  "chat.messageTeam": {
    ko: (name: string) => `${name}에 메시지...`,
    en: (name: string) => `Message ${name}...`,
  },
  "chat.teamRunning": { ko: "팀 실행 중...", en: "Team running..." },

  // Teams page
  "team.subtitle": { ko: "리드가 팀을 조율하고, 팀원이 실행합니다.", en: "Lead coordinates, members execute." },
  "team.newTeam": { ko: "새 팀", en: "New Team" },
  "team.noTeams": { ko: "아직 팀이 없습니다.", en: "No teams yet." },
  "team.executionMode": { ko: "실행 방식", en: "Execution Mode" },
  "team.seqDesc": { ko: "순차 (A → B → C)", en: "Sequential (A → B → C)" },
  "team.parDesc": { ko: "병렬 (A + B + C)", en: "Parallel (A + B + C)" },
  "team.memberHint": { ko: "클릭하면 추가, 한 번 더 클릭하면 리드", en: "Click to add, click again for Lead" },
  "team.hireFirst": { ko: "팀원을 먼저 채용하세요.", en: "Hire members first." },

  // Clients page
  "client.noClients": { ko: "아직 고객이 없습니다.", en: "No clients yet." },
  "client.noMatch": { ko: "검색 결과 없음.", en: "No results." },
  "client.search": { ko: "검색...", en: "Search..." },
  "client.details": { ko: "상세 정보", en: "Details" },
  "client.noHistory": { ko: "기록 없음.", en: "No history yet." },
  "client.assignAgent": { ko: "담당 배정", en: "Assign Member" },
  "client.none": { ko: "없음", en: "None" },
  "client.created": { ko: "등록일", en: "Created" },
  "client.add": { ko: "추가", en: "Add" },
  "client.all": { ko: "전체", en: "All" },
  "client.run": {
    ko: (name: string) => `${name} 실행`,
    en: (name: string) => `Run ${name}`,
  },
  "client.unnamed": { ko: "이름 없음", en: "Unnamed" },
  "client.confirmDelete": {
    ko: (name: string) => `${name}을(를) 삭제할까요?`,
    en: (name: string) => `Delete ${name}?`,
  },

  // Empty states
  "empty.members": { ko: "아직 팀원이 없습니다.\n첫 팀원을 채용해보세요!", en: "No members yet.\nHire your first member!" },
  "empty.dismiss": { ko: "닫기", en: "Dismiss" },

  // Sidebar
  "sidebar.server": { ko: "서버", en: "Server" },
  "sidebar.integrations": { ko: "연동", en: "Integrations" },

  // Loading
  "loading": { ko: "불러오는 중...", en: "Loading..." },

  // Confirm
  "confirm.delete": {
    ko: (name: string) => `${name}을(를) 삭제할까요?`,
    en: (name: string) => `Delete ${name}?`,
  },
  "confirm.fire": {
    ko: (name: string) => `${name}을(를) 해고할까요?`,
    en: (name: string) => `Fire ${name}?`,
  },

  // Common
  "common.on": { ko: "ON", en: "ON" },
  "common.off": { ko: "OFF", en: "OFF" },
  "common.clear": { ko: "지우기", en: "Clear" },
  "common.setupLog": { ko: "설치 로그", en: "Setup Log" },
  "common.checking": { ko: "확인 중...", en: "checking..." },
  "common.notInstalled": { ko: "미설치", en: "Not installed" },
  "common.needsAuth": { ko: "인증 필요", en: "Needs Auth" },
  "common.error": { ko: "오류", en: "Error" },
  "common.create": { ko: "만들기", en: "Create" },
  "common.save": { ko: "저장", en: "Save" },
  "common.delete": { ko: "삭제", en: "Delete" },
  "common.selected": {
    ko: (n: number) => `${n}개 선택됨`,
    en: (n: number) => `${n} selected`,
  },

  // Workspace
  "workspace.title": { ko: "워크스페이스", en: "Workspace" },
  "workspace.switch": { ko: "워크스페이스 전환", en: "Switch Workspace" },
  "workspace.create": { ko: "새 워크스페이스", en: "New Workspace" },
  "workspace.name": { ko: "이름", en: "Name" },
  "workspace.users": { ko: "사용자 관리", en: "Users" },
  "workspace.invites": { ko: "초대", en: "Invites" },
  "workspace.invite": { ko: "사용자 초대", en: "Invite User" },
  "workspace.inviteEmail": { ko: "이메일 주소", en: "Email address" },
  "workspace.inviteSend": { ko: "초대", en: "Invite" },
  "workspace.inviteCancel": { ko: "취소", en: "Cancel" },
  "workspace.invitePending": { ko: "초대 대기", en: "Pending Invites" },
  "workspace.roleOwner": { ko: "소유자", en: "Owner" },
  "workspace.roleAdmin": { ko: "관리자", en: "Admin" },
  "workspace.roleMember": { ko: "일반", en: "Member" },
  "workspace.removeUser": { ko: "사용자 제거", en: "Remove User" },
  "workspace.settings": { ko: "워크스페이스 설정", en: "Workspace Settings" },
  "workspace.usersHint": { ko: "이 워크스페이스에 접속할 수 있는 계정입니다.", en: "Accounts with access to this workspace." },

  // Auth
  "auth.logout": { ko: "로그아웃", en: "Logout" },
  "auth.loginLoading": { ko: "브라우저에서 로그인 중...", en: "Signing in via browser..." },
  "auth.loginGoogle": { ko: "Google로 로그인", en: "Sign in with Google" },
  "common.edit": { ko: "수정", en: "Edit" },

  // Staff (human team members)
  "staff.title": { ko: "구성원", en: "Staff" },
  "staff.add": { ko: "구성원 추가", en: "Add Staff" },
  "staff.name": { ko: "이름", en: "Name" },
  "staff.role": { ko: "역할", en: "Role" },
  "staff.email": { ko: "이메일", en: "Email" },
  "staff.phone": { ko: "전화", en: "Phone" },
  "staff.notes": { ko: "메모", en: "Notes" },
  "staff.empty": { ko: "등록된 구성원이 없습니다.", en: "No staff members yet." },
  "staff.hint": { ko: "실제 팀 구성원 정보를 등록하면 에이전트가 이메일 발송 등에 활용합니다.", en: "Register real team members so agents can send emails on their behalf." },
  "staff.confirmDelete": {
    ko: (name: string) => `${name}을(를) 삭제할까요?`,
    en: (name: string) => `Delete ${name}?`,
  },
} as const;

type TransKey = keyof typeof translations;

export function createT(lang: Lang) {
  return function t(key: TransKey, ...args: any[]): string {
    const entry = translations[key];
    if (!entry) return key;
    const val = entry[lang] ?? entry["en"];
    if (typeof val === "function") return (val as Function)(...args);
    return val as string;
  };
}
