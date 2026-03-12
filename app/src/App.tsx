import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import {
  type Agent,
  type AgentTeam,
  type AgentMemory,
  type Client,
  type ClientHistory,
  type TimelineEntry,
  type Staff,
  type Schedule,
  type Approval,
  type WorkspaceMember,
  type WorkspaceInvite,
  getWorkspaces,
  createWorkspace,
  getWorkspaceMembers,
  getWorkspaceInvites,
  createWorkspaceInvite,
  cancelInvite,
  removeWorkspaceMember,
  updateMemberRole,
  getAgents,
  createAgent,
  updateAgent,
  fireAgent as apiFireAgent,
  rehireAgent as apiRehireAgent,
  deleteAgent as apiDeleteAgent,
  getAgentMemories,
  createAgentMemory,
  deleteAgentMemory,
  getAgentTeams,
  createAgentTeam,
  deleteAgentTeam,
  runAgentTeam,
  getClients,
  createClient,
  updateClient,
  deleteClient,
  getClientHistory,
  getClientTimeline,
  createClientHistory,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  getSchedules,
  createSchedule,
  deleteSchedule,
  getPendingApprovals,
  decideApproval,
  authGoogleStart,
  authGooglePoll,
  setAuthToken,
  getAuthToken,
} from "./api";
import {
  SKILL_LIBRARY,
  SKILL_CATEGORIES,
  INTEGRATIONS,
  BUILT_IN_TOOLS,
  mergeSkills,
  toolLabel,
  cronLabel,
  SCHEDULE_PRESETS,
  type Skill,
} from "./skills";
import { createT, type Lang } from "./i18n";
import { AGENT_TEMPLATES, type AgentTemplate } from "./templates";

// CLIENT_STATUSES labels are resolved via i18n in the component

// Moved to inside App component to be reactive to enabledIntegrations

type Page = "agents" | "teams" | "clients" | "settings";

// ── Integration Logos (inline SVG) ──────────────────

function IntegrationLogo({ id, size = 20 }: { id: string; size?: number }) {
  const s = size;
  switch (id) {
    case "gws":
      // Google "G" logo colors
      return (
        <svg width={s} height={s} viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
      );
    case "discord":
      return (
        <svg width={s} height={s} viewBox="0 0 71 55">
          <path d="M60.1 4.9A58.5 58.5 0 0 0 45.4.2a.2.2 0 0 0-.2.1 40.8 40.8 0 0 0-1.8 3.7 53.9 53.9 0 0 0-16.2 0A37.3 37.3 0 0 0 25.4.3a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.6 4.9a.2.2 0 0 0-.1.1C1.5 18.7-.9 32.2.3 45.5v.1a58.7 58.7 0 0 0 17.7 9a.2.2 0 0 0 .3-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.6 38.6 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.6 1.1-.9a.2.2 0 0 1 .2 0c11.6 5.3 24.1 5.3 35.5 0a.2.2 0 0 1 .2 0l1.1.9a.2.2 0 0 1 0 .4c-1.8 1-3.6 1.9-5.5 2.6a.2.2 0 0 0-.1.3 47.2 47.2 0 0 0 3.6 5.9.2.2 0 0 0 .3.1A58.5 58.5 0 0 0 70.7 45.6v-.1c1.4-15-2.3-28.4-9.8-40.1a.2.2 0 0 0-.8-.5zM23.7 37.3c-3.5 0-6.3-3.2-6.3-7.1 0-3.9 2.8-7.1 6.3-7.1 3.6 0 6.4 3.2 6.3 7.1 0 3.9-2.8 7.1-6.3 7.1zm23.3 0c-3.5 0-6.3-3.2-6.3-7.1 0-3.9 2.8-7.1 6.3-7.1 3.6 0 6.4 3.2 6.3 7.1 0 3.9-2.7 7.1-6.3 7.1z" fill="#5865F2"/>
        </svg>
      );
    case "slack":
      return (
        <svg width={s} height={s} viewBox="0 0 54 54">
          <path d="M19.7.2a5.4 5.4 0 0 0-5.4 5.4v13.5a5.4 5.4 0 1 0 10.8 0V5.6A5.4 5.4 0 0 0 19.7.2z" fill="#36C5F0"/>
          <path d="M5.4 19.1a5.4 5.4 0 1 0 0 10.8h13.5a5.4 5.4 0 1 0 0-10.8H5.4z" fill="#2EB67D"/>
          <path d="M34.3 53.8a5.4 5.4 0 0 0 5.4-5.4V34.9a5.4 5.4 0 0 0-10.8 0v13.5a5.4 5.4 0 0 0 5.4 5.4z" fill="#ECB22E"/>
          <path d="M48.6 34.9a5.4 5.4 0 1 0 0-10.8H34.3a5.4 5.4 0 1 0 0 10.8h14.3z" fill="#E01E5A"/>
          <path d="M0 34.3a5.4 5.4 0 0 0 5.4 5.4h.6a5.4 5.4 0 0 0 0-10.8h-.6A5.4 5.4 0 0 0 0 34.3z" fill="#36C5F0"/>
          <path d="M19.7 48.6v.6a5.4 5.4 0 1 0 10.8 0v-.6a5.4 5.4 0 0 0-10.8 0z" fill="#2EB67D"/>
          <path d="M54 19.7a5.4 5.4 0 0 0-5.4-5.4h-.6a5.4 5.4 0 0 0 0 10.8h.6A5.4 5.4 0 0 0 54 19.7z" fill="#ECB22E"/>
          <path d="M34.3 0a5.4 5.4 0 0 0-5.4 5.4v.6a5.4 5.4 0 0 0 10.8 0v-.6A5.4 5.4 0 0 0 34.3 0z" fill="#E01E5A"/>
        </svg>
      );
    case "github":
      return (
        <svg width={s} height={s} viewBox="0 0 98 96">
          <path fillRule="evenodd" clipRule="evenodd" d="M48.9 0C21.8 0 0 22 0 49.2 0 71 14 89.4 33.4 95.9c2.4.5 3.3-1.1 3.3-2.4 0-1.1 0-4.9-.1-8.9-13.6 3-16.4-5.8-16.4-5.8-2.2-5.7-5.4-7.2-5.4-7.2-4.4-3 .3-3 .3-3 4.9.3 7.5 5 7.5 5 4.3 7.5 11.3 5.3 14.1 4.1.4-3.2 1.7-5.3 3.1-6.5-10.8-1.2-22.2-5.4-22.2-24.3 0-5.4 1.9-9.8 5-13.2-.5-1.2-2.2-6.3.5-13 0 0 4.1-1.3 13.4 5a46.5 46.5 0 0 1 24.4 0C70 17.3 74 18.6 74 18.6c2.6 6.7 1 11.8.5 13 3.1 3.4 5 7.8 5 13.2 0 18.9-11.5 23.1-22.3 24.3 1.8 1.5 3.3 4.5 3.3 9.1 0 6.6-.1 11.9-.1 13.5 0 1.3.9 2.9 3.4 2.4 19.4-6.5 33.4-24.9 33.4-46.7C97.8 22 76 0 48.9 0z" fill="#24292f"/>
        </svg>
      );
    default:
      return <span className="text-[10px] font-bold text-[#6B7280]">{id.toUpperCase()}</span>;
  }
}

// ── Tag Selector ────────────────────────────────────

function TagSelector({
  label,
  hint,
  available,
  selected,
  onChange,
  lang,
}: {
  label: string;
  hint?: string;
  available: string[];
  selected: string[];
  onChange: (t: string[]) => void;
  lang: "ko" | "en";
}) {
  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  return (
    <div>
      <label className="text-xs font-medium text-[#6B7280] block mb-1">{label}</label>
      {hint && <p className="text-[10px] text-[#9CA3AF] mb-1.5">{hint}</p>}
      <div className="flex flex-wrap gap-1">
        {available.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`px-2 py-0.5 text-[11px] rounded-full border transition ${
              selected.includes(tag)
                ? "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/30"
                : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
            }`}
          >
            {toolLabel(tag, lang)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Skill Card ──────────────────────────────────────

function SkillCard({
  skill,
  selected,
  onToggle,
  lang,
}: {
  skill: Skill;
  selected: boolean;
  onToggle: () => void;
  lang: "ko" | "en";
}) {
  return (
    <button
      onClick={onToggle}
      className={`p-3 rounded-lg border text-left transition w-full ${
        selected
          ? "border-[#D97706] bg-[#D97706]/5"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 rounded bg-gray-100 text-[10px] font-bold text-gray-500 flex items-center justify-center flex-shrink-0 mt-0.5">{skill.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{skill.name}</span>
            {selected && (
              <span className="text-[10px] bg-[#D97706] text-white px-1.5 rounded-full">ON</span>
            )}
          </div>
          <p className="text-[11px] text-[#6B7280] mt-0.5 line-clamp-2">{skill.description}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {skill.tools.slice(0, 4).map((t) => (
              <span key={t} className="px-1 py-0.5 text-[9px] bg-[#F5F0E8] text-[#8B7355] rounded">
                {toolLabel(t, lang)}
              </span>
            ))}
            {skill.tools.length > 4 && (
              <span className="text-[9px] text-[#6B7280]">+{skill.tools.length - 4}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Main App ────────────────────────────────────────

function App() {
  const [lang, setLang] = useState<Lang>(() =>
    (localStorage.getItem("flaude_lang") as Lang) || "ko"
  );
  const t = createT(lang);

  // Auth state
  const [authUser, setAuthUser] = useState<{ email: string; name: string } | null>(() => {
    try { const s = localStorage.getItem("flaude_user"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getAuthToken());
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      setLoginError("");
      setLoginLoading(true);
      const { url, state } = await authGoogleStart();

      // Open Google login in system browser
      try {
        await openUrl(url);
      } catch {
        window.open(url, "_blank"); // fallback
      }

      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const result = await authGooglePoll(state);
          if (result.status === "ok" && result.token) {
            clearInterval(poll);
            setAuthToken(result.token);
            const user = { email: result.email!, name: result.name! };
            setAuthUser(user);
            localStorage.setItem("flaude_user", JSON.stringify(user));
            setIsLoggedIn(true);
            setLoginLoading(false);
            // Bring app window to front
            try { await getCurrentWindow().setFocus(); } catch {}
          }
        } catch {
          // Keep polling
        }
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => { clearInterval(poll); setLoginLoading(false); }, 300000);
    } catch (e) {
      setLoginError(`${e}`);
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthToken(null);
    setAuthUser(null);
    localStorage.removeItem("flaude_user");
    setIsLoggedIn(false);
  };

  const CLIENT_STATUSES = [
    { key: "new", label: t("status.new") },
    { key: "researching", label: t("status.researching") },
    { key: "contacted", label: t("status.contacted") },
    { key: "meeting", label: t("status.meeting") },
    { key: "closed", label: t("status.closed") },
  ];

  const [workspaceId, setWorkspaceId] = useState<number | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentTeams, setAgentTeams] = useState<AgentTeam[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [currentPage, setCurrentPage] = useState<Page>("agents");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [prompt, setPrompt] = useState("");
  const [runningAgents, setRunningAgents] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Agent form
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [hireMode, setHireMode] = useState<"choose" | "template" | "custom" | "edit">("choose");
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null);
  const [agentFormName, setAgentFormName] = useState("");
  const [agentFormRole, setAgentFormRole] = useState("");
  const [agentFormInstructions, setAgentFormInstructions] = useState("");
  const [agentFormTools, setAgentFormTools] = useState<string[]>([]);
  const [agentFormNotAllowed, setAgentFormNotAllowed] = useState<string[]>([]);
  const [agentFormSkills, setAgentFormSkills] = useState<string[]>([]);
  const [agentFormChannels, setAgentFormChannels] = useState("");
  const [skillCategory, setSkillCategory] = useState("all");
  const [showSkillBrowser, setShowSkillBrowser] = useState(false);

  // Team form
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamFormName, setTeamFormName] = useState("");
  const [teamFormMode, setTeamFormMode] = useState<"sequential" | "parallel">("sequential");
  const [teamFormMembers, setTeamFormMembers] = useState<number[]>([]);
  const [teamFormLead, setTeamFormLead] = useState<number | null>(null);
  const [teamFormConditions, setTeamFormConditions] = useState<Record<number, string>>({});
  const [teamFormApprovals, setTeamFormApprovals] = useState<Record<number, boolean>>({});

  // Client
  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [clientForm, setClientForm] = useState({
    company: "",
    contact_name: "",
    email: "",
    phone: "",
    department: "",
    notes: "",
  });
  const [expandedClientId, setExpandedClientId] = useState<number | null>(null);
  const [clientHistoryMap, setClientHistoryMap] = useState<Record<number, ClientHistory[]>>({});
  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");

  // Staff (human team members)
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [staffForm, setStaffForm] = useState({ name: "", role: "", email: "", phone: "", notes: "" });

  // Workspace members & invites
  const [wsMembers, setWsMembers] = useState<WorkspaceMember[]>([]);
  const [wsInvites, setWsInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");

  // Settings — persist to localStorage
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("flaude_integrations");
      return saved ? JSON.parse(saved) : ["gws"];
    } catch { return ["gws"]; }
  });

  // Dynamic tools based on enabled integrations
  const ALL_TOOLS = useMemo(() => [
    ...BUILT_IN_TOOLS,
    ...INTEGRATIONS.filter((i) => enabledIntegrations.includes(i.id)).flatMap((i) => i.tools),
  ].filter((v, i, a) => a.indexOf(v) === i), [enabledIntegrations]);

  // Chat: per-agent message history + session (persisted)
  type ChatMsg = { role: "user" | "agent"; text: string };
  const [agentChats, setAgentChats] = useState<Record<number, ChatMsg[]>>(() => {
    try { return JSON.parse(localStorage.getItem("flaude_chats") || "{}"); } catch { return {}; }
  });
  const [agentSessions, setAgentSessions] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem("flaude_sessions") || "{}"); } catch { return {}; }
  });

  // Persist chats & sessions
  useEffect(() => { localStorage.setItem("flaude_chats", JSON.stringify(agentChats)); }, [agentChats]);
  useEffect(() => { localStorage.setItem("flaude_sessions", JSON.stringify(agentSessions)); }, [agentSessions]);

  // Team run — chat style
  const [teamPrompt, setTeamPrompt] = useState("");
  const [runningTeamId, setRunningTeamId] = useState<number | null>(null);
  type TeamChatMsg = { role: "user" | "agent"; agentName?: string; text: string };
  const [teamChats, setTeamChats] = useState<Record<number, TeamChatMsg[]>>(() => {
    try { return JSON.parse(localStorage.getItem("flaude_team_chats") || "{}"); } catch { return {}; }
  });
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  useEffect(() => { localStorage.setItem("flaude_team_chats", JSON.stringify(teamChats)); }, [teamChats]);

  // Integration setup
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, string>>({});
  const [setupLog, setSetupLog] = useState("");
  const [settingUp, setSettingUp] = useState<string | null>(null);

  // Agent Memory
  const [agentMemories, setAgentMemories] = useState<Record<number, AgentMemory[]>>({});
  const [showMemory, setShowMemory] = useState<number | null>(null);
  const [memoryForm, setMemoryForm] = useState({ key: "", content: "" });

  // Schedules
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "integrations" | "automation" | "team">("general");
  const [scheduleForm, setScheduleForm] = useState({
    name: "", agent_id: null as number | null, team_id: null as number | null,
    cron_expression: "", prompt: "", notification_channel: "",
  });

  // Approvals
  const [approvals, setApprovals] = useState<Approval[]>([]);

  // Client timeline
  const [clientTimelines, setClientTimelines] = useState<Record<number, TimelineEntry[]>>({});

  // Prompt generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptHint, setPromptHint] = useState("");

  // Setup wizard
  const [setupDone, setSetupDone] = useState(() => localStorage.getItem("flaude_setup_done") === "true");
  const [wizardStep, setWizardStep] = useState(0);
  const [claudeStatus, setClaudeStatus] = useState<"checking" | "ok" | "missing">("checking");
  const [gwsStatus, setGwsStatus] = useState<"checking" | "ok" | "missing">("checking");

  // Avatar helper — notionists style with warm pastel backgrounds
  const AVATAR_BG = ["F9C4AC","B8E0D2","D4C5F9","F9E2AE","A8D8EA","F5B7B1","C3E8BD","E8D5B7"];
  const avatarUrl = (name: string) => {
    const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const bg = AVATAR_BG[hash % AVATAR_BG.length];
    return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(name)}&backgroundColor=${bg}&backgroundType=solid`;
  };

  // Init
  useEffect(() => {
    (async () => {
      try {
        let workspaces = await getWorkspaces();
        let ws = workspaces.length === 0 ? await createWorkspace("My Workspace") : workspaces[0];
        setWorkspaceId(ws.id);
        const [a, at, c, s, wm, wi] = await Promise.all([
          getAgents(ws.id),
          getAgentTeams(ws.id),
          getClients(ws.id),
          getStaff(ws.id),
          getWorkspaceMembers(ws.id),
          getWorkspaceInvites(ws.id).catch(() => [] as WorkspaceInvite[]),
        ]);
        setAgents(a);
        setAgentTeams(at);
        setClients(c);
        setStaffList(s);
        setWsMembers(wm);
        setWsInvites(wi);
      } catch (e) {
        setError(`Server connection failed: ${e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Persist language
  useEffect(() => { localStorage.setItem("flaude_lang", lang); }, [lang]);

  // Persist integrations
  useEffect(() => {
    localStorage.setItem("flaude_integrations", JSON.stringify(enabledIntegrations));
  }, [enabledIntegrations]);

  // Check integration status when Settings page opens
  useEffect(() => {
    if (currentPage !== "settings") return;
    (async () => {
      const status: Record<string, string> = {};
      for (const integ of INTEGRATIONS) {
        try {
          const result = await invoke<string>("check_integration", { id: integ.id });
          status[integ.id] = result;
        } catch {
          status[integ.id] = "error";
        }
      }
      setIntegrationStatus(status);
      // Load schedules and approvals
      if (workspaceId) {
        try { setSchedules(await getSchedules(workspaceId)); } catch {}
      }
      try { setApprovals(await getPendingApprovals()); } catch {}
    })();
  }, [currentPage, workspaceId]);

  const refresh = async () => {
    if (!workspaceId) return;
    try {
      const [a, at, c, s, wm, wi] = await Promise.all([
        getAgents(workspaceId),
        getAgentTeams(workspaceId),
        getClients(workspaceId),
        getStaff(workspaceId),
        getWorkspaceMembers(workspaceId),
        getWorkspaceInvites(workspaceId).catch(() => [] as WorkspaceInvite[]),
      ]);
      setAgents(a);
      setAgentTeams(at);
      setClients(c);
      setStaffList(s);
      setWsMembers(wm);
      setWsInvites(wi);
    } catch (e) {
      console.error("Failed to refresh data:", e);
    }
  };

  const activeAgents = useMemo(() => agents.filter((a) => a.status === "active"), [agents]);
  const firedAgents = useMemo(() => agents.filter((a) => a.status === "fired"), [agents]);

  // ── Agent form ──

  const resetAgentForm = () => {
    setShowAgentForm(false);
    setHireMode("choose");
    setEditingAgentId(null);
    setAgentFormName("");
    setAgentFormRole("");
    setAgentFormInstructions("");
    setAgentFormTools([]);
    setAgentFormNotAllowed([]);
    setAgentFormSkills([]);
    setAgentFormChannels("");
    setShowSkillBrowser(false);
    setSkillCategory("all");
  };

  const openHireTemplate = () => {
    resetAgentForm();
    setShowAgentForm(true);
    setHireMode("template");
    setShowSkillBrowser(false);
  };

  const applyTemplate = (tpl: AgentTemplate) => {
    setAgentFormName(tpl.name);
    setAgentFormRole(tpl.role);
    setAgentFormInstructions(tpl.instructions);
    setAgentFormTools([...tpl.tools]);
    setAgentFormNotAllowed([...tpl.not_allowed]);
    setHireMode("custom"); // switch to form view with pre-filled data
  };

  const openHireCustom = () => {
    resetAgentForm();
    setShowAgentForm(true);
    setHireMode("custom");
    setShowSkillBrowser(false);
  };

  const openEditAgent = (agent: Agent) => {
    setEditingAgentId(agent.id);
    setAgentFormName(agent.name);
    setAgentFormRole(agent.role);
    setAgentFormInstructions(agent.instructions);
    setAgentFormTools([...agent.tools]);
    setAgentFormNotAllowed([...agent.not_allowed]);
    setAgentFormSkills([]);
    setAgentFormChannels((agent.channels || []).join(", "));
    setShowAgentForm(true);
    setHireMode("edit");
    setShowSkillBrowser(false);
  };

  const toggleSkill = (skillId: string) => {
    const next = agentFormSkills.includes(skillId)
      ? agentFormSkills.filter((s) => s !== skillId)
      : [...agentFormSkills, skillId];
    setAgentFormSkills(next);
    // Auto-merge skills into form
    const merged = mergeSkills(next);
    setAgentFormInstructions(merged.instructions);
    setAgentFormTools(merged.tools);
    setAgentFormNotAllowed(merged.not_allowed);
    // Auto-set role from first skill
    if (next.length > 0) {
      const first = SKILL_LIBRARY.find((s) => s.id === next[0]);
      if (first && !agentFormRole) setAgentFormRole(first.name);
    }
  };

  const handleSaveAgent = async () => {
    if (!workspaceId || !agentFormName.trim() || !agentFormRole.trim()) return;
    try {
      const channels = agentFormChannels
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const data = {
        name: agentFormName,
        role: agentFormRole,
        instructions: agentFormInstructions,
        tools: agentFormTools,
        not_allowed: agentFormNotAllowed,
        channels,
      };
      if (editingAgentId) {
        await updateAgent(editingAgentId, data);
      } else {
        await createAgent(workspaceId, data);
      }
      await refresh();
      resetAgentForm();
      setSelectedAgent(null);
    } catch (e) {
      setError(`${e}`);
    }
  };

  const handleFire = async (id: number) => {
    try {
      await apiFireAgent(id, "Performance issue");
      await refresh();
      setSelectedAgent(null);
    } catch (e) {
      setError(`${e}`);
    }
  };

  const handleRehire = async (id: number) => {
    try {
      await apiRehireAgent(id);
      await refresh();
    } catch (e) {
      setError(`${e}`);
    }
  };

  const parseAgentResponse = (raw: string): { session_id: string; result: string } => {
    try {
      return JSON.parse(raw);
    } catch {
      return { session_id: "", result: raw };
    }
  };

  // Build enhanced instructions with team context
  const buildInstructions = (agent: Agent): string => {
    const teammates = activeAgents.filter((a) => a.id !== agent.id);
    const teammateInfo = teammates.length > 0
      ? teammates.map((a) => `- ${a.name} (${a.role}): ${a.instructions.slice(0, 80)}...`).join("\n")
      : "없음";

    const gwsEnabled = enabledIntegrations.includes("gws");
    const gwsSection = gwsEnabled ? `

=== 도구 안내 ===
Google Workspace 연동이 활성화되어 있습니다. Bash 도구로 gws CLI를 사용할 수 있습니다.
- Gmail: gws gmail messages list/get/send, gws gmail drafts create
- Calendar: gws calendar events list/create/update/delete
- Drive: gws drive files list/get
- Docs: gws docs documents get/create
역할에 맞는 gws 명령어만 사용하세요. 지시사항의 제약사항을 준수하세요.` : "";

    return `${agent.instructions}

=== 팀 컨텍스트 ===
당신의 이름: ${agent.name}
당신의 역할: ${agent.role}
같은 팀 동료:
${teammateInfo}${gwsSection}

참고: 동료의 작업 결과를 전달받으면 그 맥락을 이해하고 이어서 작업하세요.
사용자가 다른 팀원의 결과를 언급하면 그 정보를 활용하세요.`;
  };

  const handleRunAgent = async (agent: Agent, customPrompt?: string) => {
    const p = customPrompt || prompt;
    if (!p.trim() || runningAgents[agent.id]) return;
    setRunningAgents((prev) => ({ ...prev, [agent.id]: true }));
    setPrompt("");

    // Add user message to chat
    setAgentChats((prev) => ({
      ...prev,
      [agent.id]: [...(prev[agent.id] || []), { role: "user", text: p.trim() }],
    }));

    const existingSession = agentSessions[agent.id];
    const instructions = buildInstructions(agent);
    const allowedTools = agent.tools.join(",");
    const disallowedTools = agent.not_allowed.length > 0 ? agent.not_allowed.join(",") : null;

    const runNew = async () =>
      invoke<string>("run_agent", {
        prompt: p.trim(),
        instructions,
        allowedTools,
        disallowedTools,
        sessionId: null,
        cwd: null,
      });

    try {
      let raw: string;
      if (existingSession) {
        try {
          raw = await invoke<string>("resume_agent", {
            prompt: p.trim(),
            instructions,
            allowedTools,
            disallowedTools,
            sessionId: existingSession,
            cwd: null,
          });
        } catch {
          // Session expired — start fresh
          setAgentSessions((prev) => { const n = { ...prev }; delete n[agent.id]; return n; });
          raw = await runNew();
        }
      } else {
        raw = await runNew();
      }

      const { session_id, result } = parseAgentResponse(raw);
      if (session_id) {
        setAgentSessions((prev) => ({ ...prev, [agent.id]: session_id }));
      }

      // Add agent response to chat
      setAgentChats((prev) => ({
        ...prev,
        [agent.id]: [...(prev[agent.id] || []), { role: "agent", text: result }],
      }));
    } catch (e) {
      const errMsg = `${e}`;
      setAgentChats((prev) => ({
        ...prev,
        [agent.id]: [...(prev[agent.id] || []), { role: "agent", text: `Error: ${errMsg}` }],
      }));
    } finally {
      setRunningAgents((prev) => ({ ...prev, [agent.id]: false }));
    }
  };

  const handleDeleteAgent = async (id: number) => {
    try {
      await apiDeleteAgent(id);
      await refresh();
      setSelectedAgent(null);
    } catch (e) {
      setError(`${e}`);
    }
  };

  const handleRunTeam = async (atId: number) => {
    if (!teamPrompt.trim() || runningTeamId) return;
    const p = teamPrompt.trim();
    setRunningTeamId(atId);
    setTeamPrompt("");

    // Add user message
    setTeamChats((prev) => ({
      ...prev,
      [atId]: [...(prev[atId] || []), { role: "user", text: p }],
    }));

    try {
      const plan = await runAgentTeam(atId, p);

      // Build team-aware instructions for each agent
      const enrichInstructions = (agent: typeof plan.agents[0]) => {
        const teammates = plan.agents.filter((a) => a.agent_id !== agent.agent_id);
        const teammateInfo = teammates.map((a) => `- ${a.name}: ${a.instructions.slice(0, 80)}...`).join("\n");
        return `${agent.instructions}\n\n=== 팀 컨텍스트 ===\n당신의 이름: ${agent.name}\n팀 실행 모드: ${plan.execution_mode}\n같은 팀 동료:\n${teammateInfo}\n\n팀 명령을 받아 자신의 역할에 맞는 부분을 수행하세요.`;
      };

      if (plan.execution_mode === "sequential") {
        let prevContext = "";
        for (const agent of plan.agents) {
          const fullPrompt = prevContext
            ? `[팀 명령] ${p}\n\n--- 이전 팀원 작업 결과 (이어서 작업하세요) ---\n${prevContext}`
            : `[팀 명령] ${p}`;
          const allowedTools = agent.tools.join(",");
          const disallowedTools = agent.not_allowed.length > 0 ? agent.not_allowed.join(",") : null;
          const existingSession = agentSessions[agent.agent_id];

          let raw: string;
          if (existingSession) {
            try {
              raw = await invoke<string>("resume_agent", {
                prompt: fullPrompt,
                instructions: enrichInstructions(agent),
                allowedTools,
                disallowedTools,
                sessionId: existingSession,
                cwd: null,
              });
            } catch {
              setAgentSessions((prev) => { const n = { ...prev }; delete n[agent.agent_id]; return n; });
              raw = await invoke<string>("run_agent", {
                prompt: fullPrompt,
                instructions: enrichInstructions(agent),
                allowedTools,
                disallowedTools,
                sessionId: null,
                cwd: null,
              });
            }
          } else {
            raw = await invoke<string>("run_agent", {
              prompt: fullPrompt,
              instructions: enrichInstructions(agent),
              allowedTools,
              disallowedTools,
              sessionId: null,
              cwd: null,
            });
          }

          const { session_id, result } = parseAgentResponse(raw);
          if (session_id) {
            setAgentSessions((prev) => ({ ...prev, [agent.agent_id]: session_id }));
          }
          prevContext += `[${agent.name}]: ${result}\n`;
          setTeamChats((prev) => ({
            ...prev,
            [atId]: [...(prev[atId] || []), { role: "agent", agentName: agent.name, text: result }],
          }));
        }
      } else {
        // Parallel — all at once, with session support
        const promises = plan.agents.map(async (agent) => {
          const allowedTools = agent.tools.join(",");
          const disallowedTools = agent.not_allowed.length > 0 ? agent.not_allowed.join(",") : null;
          const existingSession = agentSessions[agent.agent_id];

          let raw: string;
          if (existingSession) {
            try {
              raw = await invoke<string>("resume_agent", {
                prompt: `[팀 명령] ${p}`,
                instructions: enrichInstructions(agent),
                allowedTools,
                disallowedTools,
                sessionId: existingSession,
                cwd: null,
              });
            } catch {
              setAgentSessions((prev) => { const n = { ...prev }; delete n[agent.agent_id]; return n; });
              raw = await invoke<string>("run_agent", {
                prompt: `[팀 명령] ${p}`,
                instructions: enrichInstructions(agent),
                allowedTools,
                disallowedTools,
                sessionId: null,
                cwd: null,
              });
            }
          } else {
            raw = await invoke<string>("run_agent", {
              prompt: `[팀 명령] ${p}`,
              instructions: enrichInstructions(agent),
              allowedTools,
              disallowedTools,
              sessionId: null,
              cwd: null,
            });
          }

          const { session_id, result } = parseAgentResponse(raw);
          if (session_id) {
            setAgentSessions((prev) => ({ ...prev, [agent.agent_id]: session_id }));
          }
          return { agentName: agent.name, result };
        });
        const results = await Promise.all(promises);
        for (const r of results) {
          setTeamChats((prev) => ({
            ...prev,
            [atId]: [...(prev[atId] || []), { role: "agent", agentName: r.agentName, text: r.result }],
          }));
        }
      }
    } catch (e) {
      setTeamChats((prev) => ({
        ...prev,
        [atId]: [...(prev[atId] || []), { role: "agent", agentName: "System", text: `Error: ${e}` }],
      }));
    } finally {
      setRunningTeamId(null);
    }
  };

  const handleRunOnClient = async (client: Client) => {
    const agent = activeAgents.find((a) => a.name === client.assigned_agent);
    if (!agent) return;
    const clientContext = `대상 고객 정보:\n- 기업: ${client.company}\n- 담당자: ${client.contact_name}\n- 이메일: ${client.email}\n- 전화: ${client.phone}\n- 부서: ${client.department}\n- 상태: ${client.status}\n- 메모: ${client.notes}\n\n이 고객에 대해 당신의 역할에 맞는 업무를 수행하세요.`;
    setSelectedAgent(agent);
    setCurrentPage("agents");
    setPrompt(clientContext);
  };

  const handleGeneratePrompt = async () => {
    const name = agentFormName.trim();
    const role = agentFormRole.trim();
    const hint = promptHint.trim();
    if ((!name && !role && !hint) || isGenerating) return;
    setIsGenerating(true);
    try {
      const toolsList = agentFormTools.length > 0 ? agentFormTools.join(", ") : "any relevant tools";
      const hasBash = (agentFormTools.includes("Bash") || agentFormTools.length === 0) && enabledIntegrations.includes("gws");
      const gwsGuide = hasBash ? `

## Google Workspace CLI (gws) 사용 가능
이 에이전트는 Bash 도구를 통해 gws CLI를 사용할 수 있습니다. 역할에 맞게 적극적으로 활용하세요.

주요 명령어:
- Gmail: gws gmail messages list --query "...", gws gmail messages get --id "ID", gws gmail messages send --to "..." --subject "..." --body "...", gws gmail drafts create --to "..." --subject "..." --body "..."
- Calendar: gws calendar events list --calendar "primary" --time-min "..." --time-max "...", gws calendar events create --calendar "primary" --summary "..." --start "..." --end "..." --attendees "..."
- Drive: gws drive files list --query "...", gws drive files get --file-id "ID"
- Docs: gws docs documents get --document-id "ID", gws docs documents create --title "..."

반드시 역할에 맞는 gws 명령어를 "## 도구 사용법" 섹션에 구체적 예시와 함께 포함하세요.` : "";
      const meta = `당신은 AI 에이전트 프롬프트 엔지니어입니다. 아래 정보를 바탕으로 에이전트의 시스템 프롬프트(instructions)를 한국어로 작성하세요.

에이전트 이름: ${name || "(미정)"}
역할: ${role || "(미정)"}
사용 가능한 도구: ${toolsList}
${hint ? `추가 요구사항: ${hint}` : ""}${gwsGuide}

반드시 아래 구조를 따르세요:

## 역할
(1-2문장으로 이 에이전트가 무엇을 하는지)
${hasBash ? `
## 도구 사용법 — gws CLI 명령어
(역할에 맞는 gws CLI 명령어를 코드블록으로 구체적 예시 포함)
` : ""}
## 실행 절차
(번호 매긴 단계별 절차. 어떤 도구를 언제 쓰는지 명시)

## 출력 형식
(결과물의 구체적 포맷. 마크다운 템플릿)

## 제약사항
(절대 하지 말아야 할 것들. 역할 외 gws 서비스 접근 금지 명시)

프롬프트만 출력하세요. 다른 설명은 하지 마세요.`;

      const result = await invoke<string>("run_agent", {
        prompt: meta,
        instructions: "You are a prompt engineer. Output only the agent instructions in Korean. No preamble.",
        allowedTools: "",
        disallowedTools: null,
        sessionId: null,
      });
      setAgentFormInstructions(result);
    } catch (e) {
      setAgentFormInstructions(`Error generating: ${e}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Team ──

  const handleCreateTeam = async () => {
    if (!workspaceId || !teamFormName.trim() || teamFormMembers.length === 0) return;
    try {
      await createAgentTeam(workspaceId, {
        name: teamFormName,
        members: teamFormMembers.map((id, i) => ({
          agent_id: id,
          order: i + 1,
          is_lead: id === teamFormLead,
          condition: teamFormConditions[id] || "",
          requires_approval: teamFormApprovals[id] || false,
        })),
        execution_mode: teamFormMode,
      });
      await refresh();
      setShowTeamForm(false);
      setTeamFormName("");
      setTeamFormMembers([]);
      setTeamFormLead(null);
    } catch (e) {
      setError(`${e}`);
    }
  };

  // ── Client ──

  const handleCreateClient = async () => {
    if (!workspaceId) return;
    try {
      if (editingClientId) {
        await updateClient(editingClientId, clientForm);
      } else {
        await createClient(workspaceId, clientForm);
      }
      await refresh();
      setShowClientForm(false);
      setEditingClientId(null);
      setClientForm({ company: "", contact_name: "", email: "", phone: "", department: "", notes: "" });
    } catch (e) {
      setError(`${e}`);
    }
  };

  const handleUpdateClientStatus = async (clientId: number, status: string) => {
    try {
      const client = clients.find((c) => c.id === clientId);
      await updateClient(clientId, { status });
      await createClientHistory(clientId, {
        agent_name: "System",
        action: `Status → ${status}`,
        detail: `${client?.status} → ${status}`,
      });
      await refresh();
      if (expandedClientId === clientId) {
        const h = await getClientHistory(clientId);
        setClientHistoryMap((p) => ({ ...p, [clientId]: h }));
      }
    } catch (e) {
      setError(`${e}`);
    }
  };

  const handleAssignAgent = async (clientId: number, agentName: string) => {
    try {
      await updateClient(clientId, { assigned_agent: agentName });
      if (agentName) {
        await createClientHistory(clientId, { agent_name: agentName, action: "Assigned" });
      }
      await refresh();
    } catch (e) {
      setError(`${e}`);
    }
  };

  const toggleClientExpand = async (clientId: number) => {
    if (expandedClientId === clientId) return setExpandedClientId(null);
    setExpandedClientId(clientId);
    // Load both legacy history and unified timeline
    if (!clientHistoryMap[clientId]) {
      try {
        const h = await getClientHistory(clientId);
        setClientHistoryMap((p) => ({ ...p, [clientId]: h }));
      } catch (e) { console.error("Failed to load client history:", e); }
    }
    if (!clientTimelines[clientId]) {
      try {
        const t = await getClientTimeline(clientId);
        setClientTimelines((p) => ({ ...p, [clientId]: t }));
      } catch {}
    }
  };

  const filteredClients = useMemo(() => clients.filter((c) => {
    if (clientFilter !== "all" && c.status !== clientFilter) return false;
    if (clientSearch) {
      const q = clientSearch.toLowerCase();
      return (
        c.company.toLowerCase().includes(q) ||
        c.contact_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    }
    return true;
  }), [clients, clientFilter, clientSearch]);

  const filteredSkills = useMemo(() => SKILL_LIBRARY.filter(
    (s) => skillCategory === "all" || s.category === skillCategory
  ), [skillCategory]);

  // ── Login Screen ──
  if (!isLoggedIn) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF9F6]">
        <div className="text-center max-w-sm">
          <div className="text-5xl font-serif font-bold text-[#D97706] mb-2">F</div>
          <h1 className="text-2xl font-serif font-bold mb-1">Flaude</h1>
          <p className="text-sm text-[#6B7280] mb-8">{t("wizard.subtitle")}</p>

          <button
            onClick={handleGoogleLogin}
            disabled={loginLoading}
            className="px-6 py-2.5 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition flex items-center gap-3 mx-auto disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
            {loginLoading ? t("auth.loginLoading") : t("auth.loginGoogle")}
          </button>

          {loginError && <p className="mt-3 text-xs text-red-500">{loginError}</p>}

          <div className="mt-6 flex justify-center gap-2">
            {(["ko", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-3 py-1 text-xs rounded transition ${
                  lang === l ? "text-[#D97706] font-medium" : "text-[#9CA3AF]"
                }`}
              >
                {l === "ko" ? "한국어" : "English"}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF9F6]">
        <p className="text-[#6B7280]">{t("loading")}</p>
      </div>
    );
  }

  // ── Setup Wizard ──
  if (!setupDone) {
    const wizardSteps = [
      // Step 0: Welcome
      () => (
        <div className="text-center">
          <div className="text-5xl font-serif font-bold text-[#D97706] mb-3">F</div>
          <h1 className="text-2xl font-serif font-bold mb-2">{t("wizard.welcome")}</h1>
          <p className="text-sm text-[#6B7280]">{t("wizard.subtitle")}</p>
        </div>
      ),
      // Step 1: Claude Code check
      () => {
        if (claudeStatus === "checking") {
          invoke<string>("run_agent", {
            prompt: "echo ok",
            instructions: "Reply with just 'ok'",
            allowedTools: "",
            disallowedTools: null,
            sessionId: null,
            cwd: null,
          }).then(() => setClaudeStatus("ok")).catch(() => setClaudeStatus("missing"));
        }
        return (
          <div>
            <h2 className="text-lg font-serif font-bold mb-2">{t("wizard.claudeTitle")}</h2>
            <p className="text-sm text-[#6B7280] whitespace-pre-line mb-4">{t("wizard.claudeDesc")}</p>
            <div className={`p-3 rounded-lg border text-sm ${
              claudeStatus === "ok" ? "border-[#059669]/40 bg-[#059669]/5 text-[#059669]"
              : claudeStatus === "missing" ? "border-red-300 bg-red-50 text-red-600"
              : "border-gray-200 bg-gray-50 text-[#6B7280] animate-pulse"
            }`}>
              {claudeStatus === "checking" && t("wizard.claudeChecking")}
              {claudeStatus === "ok" && t("wizard.claudeOk")}
              {claudeStatus === "missing" && t("wizard.claudeNotFound")}
            </div>
          </div>
        );
      },
      // Step 2: GWS
      () => {
        if (gwsStatus === "checking") {
          invoke<string>("check_integration", { id: "gws" })
            .then((s) => setGwsStatus(s.startsWith("connected") ? "ok" : "missing"))
            .catch(() => setGwsStatus("missing"));
        }
        return (
          <div>
            <h2 className="text-lg font-serif font-bold mb-2">{t("wizard.gwsTitle")}</h2>
            <p className="text-sm text-[#6B7280] mb-4">{t("wizard.gwsDesc")}</p>
            <div className={`p-3 rounded-lg border text-sm mb-3 ${
              gwsStatus === "ok" ? "border-[#059669]/40 bg-[#059669]/5 text-[#059669]" : "border-gray-200 bg-gray-50 text-[#6B7280]"
            }`}>
              {gwsStatus === "checking" ? t("wizard.claudeChecking") : gwsStatus === "ok" ? "Google Workspace " + t("settings.connected") : t("common.notInstalled")}
            </div>
            {gwsStatus !== "ok" && (
              <button
                onClick={async () => {
                  try {
                    await invoke<string>("setup_integration", { id: "gws", envVars: null });
                    await invoke<string>("auth_integration", { id: "gws" });
                    setGwsStatus("ok");
                  } catch (e) { console.error("GWS setup failed:", e); }
                }}
                className="px-4 py-2 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309]"
              >
                {t("settings.install")}
              </button>
            )}
          </div>
        );
      },
      // Step 3: Chat (Discord/Slack)
      () => (
        <div>
          <h2 className="text-lg font-serif font-bold mb-2">{t("wizard.chatTitle")}</h2>
          <p className="text-sm text-[#6B7280] mb-4">{t("wizard.chatDesc")}</p>
          <div className="space-y-3">
            {INTEGRATIONS.filter((i) => i.category === "communication").map((integ) => (
              <div key={integ.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded bg-gray-50 flex items-center justify-center"><IntegrationLogo id={integ.id} size={18} /></div>
                  <div>
                    <div className="text-sm font-medium">{integ.name}</div>
                  </div>
                </div>
                {integ.setupType === "managed" && integ.inviteUrl && (
                  <a href={integ.inviteUrl} target="_blank" rel="noopener noreferrer"
                    className="px-3 py-1.5 text-[11px] font-medium text-[#5865F2] border border-[#5865F2]/20 rounded-md hover:bg-[#5865F2]/5">
                    {t("settings.addToServer")}
                  </a>
                )}
                {integ.setupType === "mcp-http" && (
                  <button
                    onClick={() => invoke<string>("setup_integration", { id: integ.id, envVars: null }).catch(() => {})}
                    className="px-3 py-1.5 text-[11px] font-medium text-[#D97706] border border-[#D97706]/20 rounded-md hover:bg-[#D97706]/5">
                    {t("settings.install")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ),
    ];

    const totalSteps = wizardSteps.length;
    const isLast = wizardStep === totalSteps - 1;

    return (
      <div className="flex h-screen items-center justify-center bg-[#FAF9F6]">
        <div className="w-full max-w-md p-8">
          {/* Progress */}
          <div className="flex gap-1 mb-8 justify-center">
            {wizardSteps.map((_, i) => (
              <div key={i} className={`h-1 w-8 rounded-full transition ${i <= wizardStep ? "bg-[#D97706]" : "bg-gray-200"}`} />
            ))}
          </div>

          {/* Content */}
          <div className="mb-8 min-h-[200px]">
            {wizardSteps[wizardStep]()}
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => wizardStep > 0 && setWizardStep(wizardStep - 1)}
              className={`px-4 py-2 text-sm rounded-lg ${wizardStep === 0 ? "invisible" : "text-[#6B7280] hover:bg-gray-100"}`}
            >
              {t("wizard.back")}
            </button>
            <div className="flex gap-2">
              {!isLast && wizardStep > 0 && (
                <button onClick={() => setWizardStep(wizardStep + 1)} className="px-4 py-2 text-sm text-[#6B7280] hover:bg-gray-100 rounded-lg">
                  {t("wizard.skip")}
                </button>
              )}
              <button
                onClick={() => {
                  if (isLast) {
                    localStorage.setItem("flaude_setup_done", "true");
                    setSetupDone(true);
                  } else {
                    setWizardStep(wizardStep + 1);
                  }
                }}
                className="px-6 py-2 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309]"
              >
                {isLast ? t("wizard.done") : t("wizard.next")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#FAF9F6] text-[#1A1A1A]">
      {/* Sidebar */}
      <aside className="w-52 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-serif font-bold text-[#D97706]">Flaude</h1>
        </div>
        <nav className="flex-1 p-2">
          {(["agents", "teams", "clients"] as Page[]).map((page) => (
            <button
              key={page}
              onClick={() => {
                setCurrentPage(page);
                setSelectedAgent(null);
                setPrompt("");
                resetAgentForm();
                setShowTeamForm(false);
                setShowClientForm(false);
              }}
              className={`w-full text-left px-3 py-2 rounded text-sm ${
                currentPage === page
                  ? "bg-[#D97706]/10 text-[#D97706] font-medium"
                  : "text-[#6B7280] hover:bg-gray-100"
              }`}
            >
              {page === "agents" && t("nav.members")}
              {page === "teams" && t("nav.teams")}
              {page === "clients" && t("nav.clients")}
            </button>
          ))}
        </nav>

        {/* Bottom: status + settings */}
        <div className="border-t border-gray-200">
          <button
            onClick={() => {
              setCurrentPage("settings");
              setSelectedAgent(null);
              resetAgentForm();
              setShowTeamForm(false);
              setShowClientForm(false);
            }}
            className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-gray-50"
          >
            <div className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
              <span className={`w-1.5 h-1.5 rounded-full ${error ? "bg-gray-300" : "bg-[#059669]"}`} />
              {error ? t("settings.disconnected") : t("settings.connected")}
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={currentPage === "settings" ? "#D97706" : "#9CA3AF"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {error && (
          <div className="m-4 p-3 bg-gray-50 border border-gray-200 rounded text-sm text-[#6B7280]">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline text-xs">{t("empty.dismiss")}</button>
          </div>
        )}

        {/* ═══ AGENTS ═══ */}
        {currentPage === "agents" && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-serif font-semibold">{t("member.title")}</h2>
              <button
                onClick={() => { resetAgentForm(); setShowAgentForm(true); setHireMode("choose"); }}
                className="px-4 py-2 bg-[#D97706] text-white rounded text-sm hover:bg-[#B45309]"
              >
                + {t("member.create")}
              </button>
            </div>

            {/* ── Agent Form ── */}
            {showAgentForm && hireMode === "choose" && (
              <div className="mb-6 bg-white rounded-lg border border-[#D97706] overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-medium">{t("hire.howToCreate")}</h3>
                  <button onClick={resetAgentForm} className="text-[10px] text-[#6B7280] hover:text-[#D97706]">
                    {t("member.cancel")}
                  </button>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                  <button
                    onClick={openHireTemplate}
                    className="p-5 rounded-lg border-2 border-gray-200 hover:border-[#D97706] transition text-left group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#D97706]/10 text-[#D97706] flex items-center justify-center text-sm font-bold mb-3">T</div>
                    <div className="font-medium text-sm group-hover:text-[#D97706]">{t("hire.fromTemplate")}</div>
                    <p className="text-xs text-[#6B7280] mt-1.5 leading-relaxed">
                      {t("hire.templateDesc", AGENT_TEMPLATES.length)}
                    </p>
                  </button>
                  <button
                    onClick={openHireCustom}
                    className="p-5 rounded-lg border-2 border-gray-200 hover:border-[#D97706] transition text-left group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-sm font-bold mb-3">+</div>
                    <div className="font-medium text-sm group-hover:text-[#D97706]">{t("hire.fromScratch")}</div>
                    <p className="text-xs text-[#6B7280] mt-1.5 leading-relaxed">
                      {t("hire.scratchDesc")}
                    </p>
                  </button>
                </div>
              </div>
            )}

            {showAgentForm && hireMode === "template" && (
              <div className="mb-6 p-6 bg-white rounded-lg border border-[#D97706]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium">{t("hire.chooseTemplate")}</h3>
                  <button
                    onClick={() => setHireMode("choose")}
                    className="text-[10px] text-[#6B7280] hover:text-[#D97706] underline"
                  >
                    {t("member.cancel")}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {AGENT_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => applyTemplate(tpl)}
                      className="p-4 rounded-lg border-2 border-gray-200 hover:border-[#D97706] transition text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{tpl.icon}</span>
                        <div>
                          <div className="font-medium text-sm group-hover:text-[#D97706]">{tpl.name}</div>
                          <div className="text-[10px] text-[#6B7280]">{tpl.role}</div>
                        </div>
                      </div>
                      <p className="text-xs text-[#6B7280] line-clamp-2">{tpl.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tpl.tools.slice(0, 3).map((tool) => (
                          <span key={tool} className="px-1.5 py-0.5 text-[9px] bg-gray-100 text-gray-500 rounded">
                            {toolLabel(tool, lang)}
                          </span>
                        ))}
                        {tpl.tools.length > 3 && (
                          <span className="px-1.5 py-0.5 text-[9px] bg-gray-100 text-gray-500 rounded">
                            +{tpl.tools.length - 3}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showAgentForm && (hireMode === "custom" || hireMode === "edit") && (
              <div className="mb-6 bg-white rounded-lg border border-[#D97706] overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">
                      {hireMode === "edit" ? t("hire.editMember") : t("hire.hireMember")}
                    </h3>
                    {hireMode !== "edit" && (
                      <button
                        onClick={() => { setHireMode("choose"); setShowSkillBrowser(false); }}
                        className="text-[10px] text-[#6B7280] hover:text-[#D97706] underline"
                      >
                        {t("hire.changeMode")}
                      </button>
                    )}
                  </div>
                  {agentFormSkills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {agentFormSkills.map((id) => {
                        const s = SKILL_LIBRARY.find((sk) => sk.id === id);
                        return s ? (
                          <span key={id} className="px-2 py-0.5 text-[10px] bg-[#D97706]/10 text-[#D97706] rounded-full">
                            {s.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>

                <div className="flex">
                  {/* Left: Skill Browser (template & edit modes) */}
                  {showSkillBrowser && (
                    <div className="w-80 border-r border-gray-100 p-4 max-h-[500px] overflow-auto">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-medium text-[#6B7280]">{t("settings.skillLibrary")}</h4>
                        <span className="text-[10px] text-[#6B7280]">
                          {t("common.selected", agentFormSkills.length)}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1 mb-3">
                        {SKILL_CATEGORIES.map((cat) => (
                          <button
                            key={cat.key}
                            onClick={() => setSkillCategory(cat.key)}
                            className={`px-2 py-0.5 text-[11px] rounded-full border transition ${
                              skillCategory === cat.key
                                ? "bg-[#D97706] text-white border-[#D97706]"
                                : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>

                      <div className="space-y-2">
                        {filteredSkills.map((skill) => (
                          <SkillCard
                            key={skill.id}
                            skill={skill}
                            selected={agentFormSkills.includes(skill.id)}
                            onToggle={() => toggleSkill(skill.id)}
                            lang={lang}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Right: Agent Config */}
                  <div className="flex-1 p-4 space-y-3">
                    {/* Toggle skill browser in custom/edit mode */}
                    {(hireMode === "custom" || hireMode === "edit") && (
                      <button
                        onClick={() => setShowSkillBrowser(!showSkillBrowser)}
                        className={`px-3 py-1 text-xs rounded border transition ${
                          showSkillBrowser
                            ? "bg-[#D97706]/10 text-[#D97706] border-[#D97706]"
                            : "border-gray-200 text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {showSkillBrowser ? t("hire.skillBrowserHide") : t("hire.skillBrowserShow")}
                      </button>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder={t("member.name")}
                        value={agentFormName}
                        onChange={(e) => setAgentFormName(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706]"
                      />
                      <input
                        type="text"
                        placeholder={t("member.role")}
                        value={agentFormRole}
                        onChange={(e) => setAgentFormRole(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706]"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-[#6B7280]">
                          {lang === "ko" ? "업무 매뉴얼" : "Work Manual"}
                        </label>
                      </div>

                      {/* AI Prompt Generator */}
                      {(hireMode === "custom" || hireMode === "edit") && (
                        <div className="mb-2 p-2.5 bg-gray-50 rounded border border-gray-200">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder={t("hire.aiPlaceholder")}
                              value={promptHint}
                              onChange={(e) => setPromptHint(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleGeneratePrompt(); } }}
                              disabled={isGenerating}
                              className="flex-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-[#D97706] disabled:bg-gray-100"
                            />
                            <button
                              onClick={handleGeneratePrompt}
                              disabled={isGenerating || (!agentFormName.trim() && !agentFormRole.trim() && !promptHint.trim())}
                              className="px-3 py-1.5 text-xs bg-[#1A1A1A] text-white rounded hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
                            >
                              {isGenerating ? t("ai.generating") : t("ai.generate")}
                            </button>
                          </div>
                          <p className="text-[10px] text-[#6B7280] mt-1">
                            {lang === "ko" ? "이름과 역할을 입력한 뒤, 어떤 일을 시키고 싶은지 적으면 AI가 업무 매뉴얼을 자동으로 작성합니다." : "Enter a name and role, then describe what you want — AI will auto-generate the work manual."}
                          </p>
                        </div>
                      )}

                      <textarea
                        placeholder={t("hire.instructionPlaceholder")}
                        value={agentFormInstructions}
                        onChange={(e) => setAgentFormInstructions(e.target.value)}
                        rows={hireMode === "custom" ? 10 : 6}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706] font-mono text-xs"
                      />
                    </div>

                    <TagSelector
                      label={lang === "ko" ? "이 팀원이 할 수 있는 일" : "What this member can do"}
                      hint={lang === "ko" ? "클릭하여 켜거나 끄세요. 잘 모르시면 기본값 그대로 두셔도 됩니다." : "Click to toggle. Leave as-is if unsure."}
                      available={ALL_TOOLS}
                      selected={agentFormTools}
                      onChange={setAgentFormTools}
                      lang={lang}
                    />
                    <TagSelector
                      label={lang === "ko" ? "이 팀원이 하면 안 되는 일" : "What this member must NOT do"}
                      hint={lang === "ko" ? "잘못 사용하면 안 되는 기능을 선택하세요." : "Select capabilities to restrict."}
                      available={ALL_TOOLS}
                      selected={agentFormNotAllowed}
                      onChange={setAgentFormNotAllowed}
                      lang={lang}
                    />

                    <div>
                      <label className="text-xs font-medium text-[#6B7280] block mb-1">
                        {lang === "ko" ? "Discord 자동응답 채널" : "Discord Auto-reply Channels"}
                      </label>
                      <input
                        type="text"
                        placeholder={lang === "ko" ? "채널 ID를 입력하세요 (쉼표로 구분)" : "Enter channel IDs (comma-separated)"}
                        value={agentFormChannels}
                        onChange={(e) => setAgentFormChannels(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706] font-mono text-xs"
                      />
                      <p className="text-[10px] text-[#9CA3AF] mt-1 leading-relaxed">
                        {lang === "ko"
                          ? "채널 ID 찾는 법: Discord 설정 → 고급 → 개발자 모드 켜기 → 채널 우클릭 → \"채널 ID 복사\""
                          : "Finding channel ID: Discord Settings → Advanced → Developer Mode ON → Right-click channel → Copy Channel ID"}
                      </p>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={handleSaveAgent}
                        disabled={!agentFormName.trim() || !agentFormRole.trim()}
                        className="px-4 py-1.5 text-sm bg-[#D97706] text-white rounded hover:bg-[#B45309] disabled:opacity-50"
                      >
                        {hireMode === "edit" ? t("member.save") : t("hire.hire")}
                      </button>
                      <button
                        onClick={resetAgentForm}
                        className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                      >
                        {t("member.cancel")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {agents.length === 0 && !showAgentForm && (
              <div className="text-center py-12">
                <p className="text-sm text-[#6B7280] whitespace-pre-line mb-4">{t("empty.members")}</p>
                <button
                  onClick={() => { resetAgentForm(); setShowAgentForm(true); setHireMode("choose"); }}
                  className="px-4 py-2 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309]"
                >
                  + {t("member.create")}
                </button>
              </div>
            )}

            {/* Active agents */}
            <div className="space-y-3">
              {activeAgents.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => {
                    setSelectedAgent(selectedAgent?.id === agent.id ? null : agent);
                    setPrompt("");
                  }}
                  className={`p-4 bg-white rounded-lg border cursor-pointer transition ${
                    selectedAgent?.id === agent.id
                      ? "border-[#D97706]"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex gap-3">
                      <img src={avatarUrl(agent.name)} alt="" className="w-10 h-10 rounded-xl flex-shrink-0 shadow-sm" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{agent.name}</span>
                          <span className="text-xs text-[#6B7280]">{agent.role}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                        {agent.tools.map((tl) => (
                          <span key={tl} className="px-1.5 py-0.5 text-[10px] bg-[#F5F0E8] text-[#8B7355] rounded">
                            {toolLabel(tl, lang)}
                          </span>
                        ))}
                        {agent.not_allowed.map((tl) => (
                          <span key={tl} className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-400 rounded line-through">
                            {toolLabel(tl, lang)}
                          </span>
                        ))}
                        {agent.channels && agent.channels.length > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-[#F5F0E8] text-[#8B7355] rounded">
                            Discord {agent.channels.length}{lang === "ko" ? "개 채널" : " channels"}
                          </span>
                        )}
                      </div>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      runningAgents[agent.id]
                        ? "bg-[#D97706]/10 text-[#D97706]"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {runningAgents[agent.id] ? t("member.running") : t("member.active")}
                    </span>
                  </div>

                  {selectedAgent?.id === agent.id && (
                    <div className="mt-3 pt-3 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                      {/* Chat messages */}
                      {(agentChats[agent.id] || []).length > 0 && (
                        <div className="mb-3 max-h-80 overflow-auto space-y-2">
                          {(agentChats[agent.id] || []).map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2`}>
                              {msg.role === "agent" && (
                                <img src={avatarUrl(agent.name)} alt="" className="w-6 h-6 rounded-full flex-shrink-0 mt-1" />
                              )}
                              <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                                msg.role === "user"
                                  ? "bg-[#D97706] text-white rounded-br-sm"
                                  : "bg-gray-50 text-[#1A1A1A] border border-gray-200 rounded-bl-sm"
                              }`}>
                                {msg.text}
                              </div>
                            </div>
                          ))}
                          {runningAgents[agent.id] && (
                            <div className="flex justify-start gap-2">
                              <img src={avatarUrl(agent.name)} alt="" className="w-6 h-6 rounded-full flex-shrink-0 mt-1 animate-pulse" />
                              <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 rounded-bl-sm">
                                <span className="text-sm text-[#6B7280] animate-pulse">{t("chat.thinking")}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Message input */}
                      <form
                        onSubmit={(e) => { e.preventDefault(); handleRunAgent(agent); }}
                        className="mb-3"
                      >
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={t("chat.messageAgent", agent.name)}
                            disabled={runningAgents[agent.id]}
                            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#D97706] disabled:bg-gray-50"
                          />
                          <button
                            type="submit"
                            disabled={runningAgents[agent.id] || !prompt.trim()}
                            className="px-4 py-2 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309] disabled:opacity-50"
                          >
                            {runningAgents[agent.id] ? "..." : t("chat.send")}
                          </button>
                        </div>
                      </form>

                      {/* Memory panel */}
                      {showMemory === agent.id && (
                        <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <h4 className="text-xs font-medium text-[#6B7280]">
                                {lang === "ko" ? "학습 노트" : "Learning Notes"}
                                <span className="ml-1 font-normal text-[#9CA3AF]">({(agentMemories[agent.id] || []).length})</span>
                              </h4>
                              <p className="text-[10px] text-[#9CA3AF] mt-0.5">
                                {lang === "ko" ? "이 팀원이 기억해야 할 내용을 적어주세요. 대화할 때 자동으로 참고합니다." : "Write what this member should remember. It's automatically used in conversations."}
                              </p>
                            </div>
                            <button onClick={() => setShowMemory(null)} className="text-[10px] text-[#6B7280] hover:text-[#1A1A1A]">✕</button>
                          </div>
                          <div className="space-y-1.5 mb-2 max-h-40 overflow-auto">
                            {(agentMemories[agent.id] || []).map((mem) => (
                              <div key={mem.id} className="flex items-start gap-2 text-xs bg-white p-2 rounded border border-gray-100">
                                <div className="flex-1 min-w-0">
                                  <span className="font-medium text-[#D97706]">{mem.key}</span>
                                  <p className="text-[#6B7280] mt-0.5 whitespace-pre-wrap">{mem.content}</p>
                                </div>
                                <button
                                  onClick={async () => { await deleteAgentMemory(mem.id); setAgentMemories((p) => ({ ...p, [agent.id]: (p[agent.id] || []).filter((m) => m.id !== mem.id) })); }}
                                  className="text-[10px] text-red-400 hover:text-red-600 flex-shrink-0"
                                >✕</button>
                              </div>
                            ))}
                            {(agentMemories[agent.id] || []).length === 0 && (
                              <p className="text-[10px] text-[#9CA3AF] text-center py-2">{lang === "ko" ? "아직 등록된 노트가 없습니다" : "No notes yet"}</p>
                            )}
                          </div>
                          <div className="flex gap-1.5">
                            <input type="text" placeholder={lang === "ko" ? "제목 (예: 말투, 고객 선호)" : "Title (e.g. tone, preferences)"} value={memoryForm.key} onChange={(e) => setMemoryForm({ ...memoryForm, key: e.target.value })} className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-[#D97706]" />
                            <input type="text" placeholder={lang === "ko" ? "기억할 내용" : "What to remember"} value={memoryForm.content} onChange={(e) => setMemoryForm({ ...memoryForm, content: e.target.value })} className="flex-[2] px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-[#D97706]" />
                            <button
                              onClick={async () => {
                                if (!memoryForm.key.trim() || !memoryForm.content.trim()) return;
                                const mem = await createAgentMemory(agent.id, memoryForm);
                                setAgentMemories((p) => ({ ...p, [agent.id]: [mem, ...(p[agent.id] || []).filter((m) => m.key !== mem.key)] }));
                                setMemoryForm({ key: "", content: "" });
                              }}
                              disabled={!memoryForm.key.trim() || !memoryForm.content.trim()}
                              className="px-2 py-1 text-xs bg-[#D97706] text-white rounded hover:bg-[#B45309] disabled:opacity-50"
                            >+</button>
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={() => openEditAgent(agent)}
                          className="px-3 py-1 text-xs border border-gray-200 text-[#6B7280] rounded hover:bg-gray-50"
                        >
                          {t("member.edit")}
                        </button>
                        <button
                          onClick={async () => {
                            if (showMemory === agent.id) { setShowMemory(null); return; }
                            if (!agentMemories[agent.id]) {
                              try { const mems = await getAgentMemories(agent.id); setAgentMemories((p) => ({ ...p, [agent.id]: mems })); } catch {}
                            }
                            setShowMemory(agent.id);
                          }}
                          className={`px-3 py-1 text-xs border rounded hover:bg-gray-50 ${showMemory === agent.id ? "border-[#D97706] text-[#D97706]" : "border-gray-200 text-[#6B7280]"}`}
                        >
                          {lang === "ko" ? "학습 노트" : "Notes"}
                        </button>
                        {agentSessions[agent.id] && (
                          <button
                            onClick={() => {
                              setAgentSessions((prev) => { const n = { ...prev }; delete n[agent.id]; return n; });
                              setAgentChats((prev) => { const n = { ...prev }; delete n[agent.id]; return n; });
                            }}
                            className="px-3 py-1 text-xs border border-gray-200 text-[#6B7280] rounded hover:bg-gray-50"
                          >
                            {t("chat.newChat")}
                          </button>
                        )}
                        <div className="flex-1" />
                        <button
                          onClick={() => handleFire(agent.id)}
                          className="px-3 py-1 text-xs text-[#6B7280] hover:text-[#1A1A1A]"
                        >
                          {t("member.fire")}
                        </button>
                        <button
                          onClick={() => { if (confirm(t("confirm.delete", agent.name))) handleDeleteAgent(agent.id); }}
                          className="px-3 py-1 text-xs text-[#6B7280] hover:text-[#1A1A1A]"
                        >
                          {t("member.delete")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {firedAgents.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm text-[#6B7280] mb-2">{t("member.fired")}</h3>
                <div className="space-y-2">
                  {firedAgents.map((agent) => (
                    <div key={agent.id} className="p-3 bg-white rounded-lg border border-gray-200 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <img src={avatarUrl(agent.name)} alt="" className="w-7 h-7 rounded-full grayscale opacity-50 flex-shrink-0" />
                        <div>
                          <span className="text-sm text-[#6B7280]">{agent.name} — {agent.role}</span>
                          <span className="text-xs text-[#DC2626] ml-2">{agent.fired_reason}</span>
                        </div>
                      </div>
                      <button onClick={() => handleRehire(agent.id)} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">
                        {t("member.rehire")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ TEAMS ═══ */}
        {currentPage === "teams" && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-serif font-semibold">{t("team.title")}</h2>
                <p className="text-xs text-[#6B7280] mt-1">{t("team.subtitle")}</p>
              </div>
              {(agentTeams.length > 0 || showTeamForm) && (
                <button
                  onClick={() => setShowTeamForm(!showTeamForm)}
                  className="px-4 py-2 bg-[#D97706] text-white rounded text-sm hover:bg-[#B45309]"
                >
                  + {t("team.create")}
                </button>
              )}
            </div>

            {showTeamForm && (
              <div className="mb-6 bg-white rounded-lg border border-[#D97706] overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="text-sm font-medium">{t("team.newTeam")}</h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* Team name */}
                  <div>
                    <label className="text-xs font-medium text-[#6B7280] block mb-1.5">{t("team.name")}</label>
                    <input
                      type="text"
                      placeholder={lang === "ko" ? "예: 리서치팀, 콘텐츠팀" : "e.g. Research Team"}
                      value={teamFormName}
                      onChange={(e) => setTeamFormName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]"
                    />
                  </div>

                  {/* Execution mode with descriptions */}
                  <div>
                    <label className="text-xs font-medium text-[#6B7280] block mb-1.5">{t("team.executionMode")}</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(["sequential", "parallel"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setTeamFormMode(mode)}
                          className={`p-3 rounded-lg border-2 text-left transition ${
                            teamFormMode === mode
                              ? "border-[#D97706] bg-[#D97706]/5"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm">{mode === "sequential" ? "→" : "⇉"}</span>
                            <span className={`text-sm font-medium ${teamFormMode === mode ? "text-[#D97706]" : ""}`}>
                              {mode === "sequential" ? t("team.seqDesc") : t("team.parDesc")}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#6B7280]">
                            {mode === "sequential"
                              ? (lang === "ko" ? "첫 번째 팀원이 하고, 그 결과를 다음 팀원이 이어받아 합니다" : "First member works, then passes results to the next")
                              : (lang === "ko" ? "모든 팀원이 동시에 일하고, 리드가 결과를 종합합니다" : "All members work at the same time, lead combines the results")}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Member selection */}
                  <div>
                    <label className="text-xs font-medium text-[#6B7280] block mb-1.5">
                      {t("team.members")}
                      {teamFormMembers.length > 0 && (
                        <span className="ml-1 font-normal text-[#D97706]">({teamFormMembers.length}{lang === "ko" ? "명 선택" : " selected"})</span>
                      )}
                    </label>
                    {activeAgents.length === 0 ? (
                      <p className="text-xs text-[#6B7280]">{t("team.hireFirst")}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {activeAgents.map((agent) => {
                          const idx = teamFormMembers.indexOf(agent.id);
                          const isSelected = idx >= 0;
                          const isLead = teamFormLead === agent.id;
                          return (
                            <div key={agent.id}>
                            <div
                              className={`flex items-center gap-3 p-2.5 rounded-lg border transition cursor-pointer ${
                                isSelected
                                  ? isLead ? "border-[#D97706] bg-[#D97706]/5" : "border-blue-300 bg-blue-50/50"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                              onClick={() => {
                                if (!isSelected) {
                                  const next = [...teamFormMembers, agent.id];
                                  setTeamFormMembers(next);
                                  if (next.length === 1) setTeamFormLead(agent.id);
                                } else {
                                  const next = teamFormMembers.filter((m) => m !== agent.id);
                                  setTeamFormMembers(next);
                                  if (isLead) setTeamFormLead(next[0] || null);
                                }
                              }}
                            >
                              <img src={avatarUrl(agent.name)} alt="" className="w-8 h-8 rounded-lg flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">{agent.name}</span>
                                  <span className="text-[11px] text-[#6B7280]">{agent.role}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {isSelected && (
                                  <>
                                    <span className="text-[10px] text-[#6B7280]">#{idx + 1}</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setTeamFormLead(agent.id); }}
                                      className={`px-2 py-0.5 text-[10px] rounded-full border transition ${
                                        isLead
                                          ? "bg-[#D97706] text-white border-[#D97706]"
                                          : "border-gray-300 text-[#6B7280] hover:border-[#D97706] hover:text-[#D97706]"
                                      }`}
                                    >
                                      {isLead ? (lang === "ko" ? "리드" : "Lead") : (lang === "ko" ? "리드 지정" : "Set Lead")}
                                    </button>
                                  </>
                                )}
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                                  isSelected ? "border-[#D97706] bg-[#D97706]" : "border-gray-300"
                                }`}>
                                  {isSelected && <span className="text-white text-[10px]">✓</span>}
                                </div>
                              </div>
                            </div>
                            {/* Condition & Approval — only for selected members in sequential mode */}
                            {isSelected && teamFormMode === "sequential" && idx > 0 && (
                              <div className="mt-1 ml-4 relative" onClick={(e) => e.stopPropagation()}>
                                {/* Visual connector line */}
                                <div className="absolute left-4 -top-1 w-px h-1 bg-gray-200" />
                                <div className="border border-dashed border-gray-200 rounded-lg p-3 bg-gray-50/70">
                                  <div className="text-[10px] font-medium text-[#9CA3AF] mb-2 flex items-center gap-1.5">
                                    <span className="w-4 h-4 rounded-full bg-[#D97706]/10 flex items-center justify-center text-[8px] font-bold text-[#D97706]">?</span>
                                    {lang === "ko" ? "실행 조건" : "Run condition"}
                                  </div>
                                  <div className="space-y-2.5">
                                    {/* Condition selector */}
                                    <div className="flex flex-wrap gap-1.5">
                                      {[
                                        { value: "", label: lang === "ko" ? "항상 실행" : "Always run", icon: "—" },
                                        { value: "result_contains:", label: lang === "ko" ? "특정 단어가 있으면" : "If result includes...", icon: "=" },
                                        { value: "result_not_contains:", label: lang === "ko" ? "특정 단어가 없으면" : "If result doesn't include...", icon: "≠" },
                                      ].map((opt) => {
                                        const currentVal = teamFormConditions[agent.id] || "";
                                        const isActive = opt.value === "" ? currentVal === "" : currentVal.startsWith(opt.value);
                                        return (
                                          <button
                                            key={opt.value}
                                            onClick={() => setTeamFormConditions({ ...teamFormConditions, [agent.id]: opt.value })}
                                            className={`px-2.5 py-1.5 text-[11px] rounded-md border transition flex items-center gap-1.5 ${
                                              isActive
                                                ? "border-[#D97706] bg-[#D97706]/5 text-[#D97706] font-medium"
                                                : "border-gray-200 bg-white text-[#6B7280] hover:border-gray-300"
                                            }`}
                                          >
                                            <span className="text-[10px]">{opt.icon}</span>
                                            {opt.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    {/* Keyword input */}
                                    {(teamFormConditions[agent.id] || "").includes(":") && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-[#9CA3AF]">{lang === "ko" ? "키워드:" : "Keyword:"}</span>
                                        <input
                                          type="text"
                                          placeholder={lang === "ko" ? "예: 긴급, 완료, 오류..." : "e.g. urgent, done, error..."}
                                          value={(teamFormConditions[agent.id] || "").split(":").slice(1).join(":")}
                                          onChange={(e) => {
                                            const prefix = (teamFormConditions[agent.id] || "").split(":")[0] + ":";
                                            setTeamFormConditions({ ...teamFormConditions, [agent.id]: prefix + e.target.value });
                                          }}
                                          className="flex-1 text-[11px] px-2.5 py-1.5 border border-gray-200 rounded-md bg-white focus:outline-none focus:border-[#D97706]"
                                        />
                                      </div>
                                    )}
                                    {/* Approval gate */}
                                    <div className="pt-2 border-t border-gray-200/60">
                                      <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className={`relative w-8 h-[18px] rounded-full transition-colors ${
                                          teamFormApprovals[agent.id] ? "bg-[#D97706]" : "bg-gray-200"
                                        }`}
                                          onClick={() => setTeamFormApprovals({ ...teamFormApprovals, [agent.id]: !teamFormApprovals[agent.id] })}
                                        >
                                          <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
                                            teamFormApprovals[agent.id] ? "left-[16px]" : "left-[2px]"
                                          }`} />
                                        </div>
                                        <div>
                                          <span className="text-[11px] font-medium text-[#374151]">
                                            {lang === "ko" ? "내 승인 후 실행" : "Need my approval"}
                                          </span>
                                          <p className="text-[10px] text-[#9CA3AF]">
                                            {lang === "ko"
                                              ? "이전 팀원의 결과를 확인한 뒤 넘길 수 있어요"
                                              : "Review the previous member's work before passing it on"}
                                          </p>
                                        </div>
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Visual flow preview */}
                  {teamFormMembers.length > 0 && (
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-[10px] font-medium text-[#6B7280] mb-2">
                        {lang === "ko" ? "실행 흐름 미리보기" : "Execution Flow Preview"}
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {teamFormMembers.map((id, i) => {
                          const agent = activeAgents.find((a) => a.id === id);
                          const isLead = teamFormLead === id;
                          if (!agent) return null;
                          const cond = teamFormConditions[id] || "";
                          const hasCondition = cond.includes(":");
                          const needsApproval = teamFormApprovals[id] || false;
                          return (
                            <span key={id} className="flex items-center gap-1">
                              {/* Show condition/approval badges between members in sequential mode */}
                              {teamFormMode === "sequential" && i > 0 && (hasCondition || needsApproval) && (
                                <span className="flex items-center gap-0.5 mx-0.5">
                                  {hasCondition && (
                                    <span className="text-[8px] px-1 py-0.5 bg-blue-50 text-blue-500 rounded font-mono font-bold" title={cond}>
                                      {cond.startsWith("result_contains:") ? "=" : "≠"}
                                    </span>
                                  )}
                                  {needsApproval && (
                                    <span className="text-[8px] px-1 py-0.5 bg-amber-50 text-amber-600 rounded font-medium">
                                      OK?
                                    </span>
                                  )}
                                </span>
                              )}
                              <span className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md ${
                                isLead ? "bg-[#D97706]/10 text-[#D97706] font-medium" : "bg-white border border-gray-200"
                              }`}>
                                <img src={avatarUrl(agent.name)} alt="" className="w-4 h-4 rounded-full" />
                                {agent.name}
                                {isLead && <span className="text-[9px]">★</span>}
                              </span>
                              {i < teamFormMembers.length - 1 && (
                                <span className="text-gray-400 text-xs mx-0.5">
                                  {teamFormMode === "sequential" ? "→" : "+"}
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button onClick={handleCreateTeam} disabled={!teamFormName.trim() || teamFormMembers.length === 0} className="px-4 py-2 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309] disabled:opacity-50">{t("common.create")}</button>
                    <button onClick={() => setShowTeamForm(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{t("member.cancel")}</button>
                  </div>
                </div>
              </div>
            )}

            {agentTeams.length === 0 && !showTeamForm && (
              <div className="text-center py-16">
                <p className="text-sm text-[#6B7280] mb-1">{t("team.noTeams")}</p>
                {activeAgents.length >= 2 ? (
                  <>
                    <p className="text-xs text-[#9CA3AF] mb-4">{lang === "ko" ? "팀원들을 묶어서 함께 일하게 해보세요" : "Group your members to work together"}</p>
                    <button
                      onClick={() => setShowTeamForm(true)}
                      className="px-5 py-2.5 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309]"
                    >
                      + {t("team.create")}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-[#9CA3AF]">{t("team.hireFirst")}</p>
                )}
              </div>
            )}

            <div className="space-y-3">
              {agentTeams.map((at) => {
                const leadMember = at.members.find((m: any) => m.is_lead);
                const leadAgent = leadMember ? agents.find((a) => a.id === leadMember.agent_id) : null;
                const isSelected = selectedTeamId === at.id;
                const chat = teamChats[at.id] || [];
                const isRunning = runningTeamId === at.id;

                return (
                  <div key={at.id} className={`bg-white rounded-lg border transition ${isSelected ? "border-[#D97706]/40" : "border-gray-200"}`}>
                    {/* Team header */}
                    <div
                      className="p-4 cursor-pointer"
                      onClick={() => setSelectedTeamId(isSelected ? null : at.id)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{at.name}</span>
                            <span className={`px-2 py-0.5 text-[10px] rounded-full ${
                              at.execution_mode === "sequential" ? "bg-[#F5F0E8] text-[#8B7355]" : "bg-gray-100 text-[#6B7280]"
                            }`}>
                              {at.execution_mode === "sequential" ? t("team.sequential") : t("team.parallel")}
                            </span>
                            {isRunning && (
                              <span className="px-2 py-0.5 text-[10px] rounded-full bg-[#D97706]/10 text-[#D97706] animate-pulse">
                                {t("member.running")}
                              </span>
                            )}
                          </div>
                          {leadAgent && <div className="mt-0.5 text-[10px] text-[#D97706]">{t("team.lead")}: {leadAgent.name}</div>}
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            {at.members.map((m: any, i: number) => {
                              const a = agents.find((ag) => ag.id === m.agent_id);
                              const memberName = a?.name || `#${m.agent_id}`;
                              return (
                                <span key={m.agent_id} className="flex items-center">
                                  <span className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded ${m.is_lead ? "bg-[#D97706]/10 text-[#D97706] font-medium" : "bg-gray-100"}`}>
                                    <img src={avatarUrl(memberName)} alt="" className="w-4 h-4 rounded-full" />
                                    {memberName}
                                  </span>
                                  {i < at.members.length - 1 && (
                                    <span className="mx-1 text-gray-400 text-xs">
                                      {at.execution_mode === "sequential" ? "→" : "+"}
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteAgentTeam(at.id).then(refresh).catch((err) => console.error("Delete team failed:", err)); }}
                          className="px-2 py-1 text-xs text-[#6B7280] hover:text-red-500 hover:bg-red-50 rounded"
                        >
                          {t("member.delete")}
                        </button>
                      </div>
                    </div>

                    {/* Team chat — expanded */}
                    {isSelected && (
                      <div className="border-t border-gray-100 p-4" onClick={(e) => e.stopPropagation()}>
                        {/* Chat messages */}
                        {chat.length > 0 && (
                          <div className="mb-3 max-h-96 overflow-auto space-y-2">
                            {chat.map((msg, i) => (
                              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2`}>
                                {msg.role === "agent" && msg.agentName && (
                                  <img src={avatarUrl(msg.agentName)} alt="" className="w-6 h-6 rounded-full flex-shrink-0 mt-1" />
                                )}
                                <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                                  msg.role === "user"
                                    ? "bg-[#D97706] text-white rounded-br-sm"
                                    : "bg-gray-50 text-[#1A1A1A] border border-gray-200 rounded-bl-sm"
                                }`}>
                                  {msg.role === "agent" && msg.agentName && (
                                    <div className="text-[10px] text-[#D97706] mb-1 font-medium">{msg.agentName}</div>
                                  )}
                                  {msg.text}
                                </div>
                              </div>
                            ))}
                            {isRunning && (
                              <div className="flex justify-start">
                                <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 rounded-bl-sm">
                                  <span className="text-sm text-[#6B7280] animate-pulse">{t("chat.teamRunning")}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Input */}
                        <form
                          onSubmit={(e) => { e.preventDefault(); handleRunTeam(at.id); }}
                          className="flex gap-2"
                        >
                          <input
                            type="text"
                            value={teamPrompt}
                            onChange={(e) => setTeamPrompt(e.target.value)}
                            placeholder={t("chat.messageTeam", at.name)}
                            disabled={isRunning}
                            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#D97706] disabled:bg-gray-50"
                          />
                          <button
                            type="submit"
                            disabled={isRunning || !teamPrompt.trim()}
                            className="px-4 py-2 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309] disabled:opacity-50"
                          >
                            {isRunning ? "..." : t("chat.send")}
                          </button>
                        </form>

                        {/* Clear chat */}
                        {chat.length > 0 && (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => setTeamChats((prev) => { const n = { ...prev }; delete n[at.id]; return n; })}
                              className="text-[11px] text-[#6B7280] hover:text-[#1A1A1A]"
                            >
                              {t("chat.newChat")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ CLIENTS ═══ */}
        {currentPage === "clients" && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-serif font-semibold">{t("client.title")}</h2>
              <button onClick={() => { setEditingClientId(null); setClientForm({ company: "", contact_name: "", email: "", phone: "", department: "", notes: "" }); setShowClientForm(!showClientForm); }} className="px-4 py-2 bg-[#D97706] text-white rounded text-sm hover:bg-[#B45309]">+ {t("client.create")}</button>
            </div>

            {/* Pipeline overview */}
            <div className="mb-4 bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex">
                <button
                  onClick={() => setClientFilter("all")}
                  className={`flex-1 py-3 text-center transition border-b-2 ${
                    clientFilter === "all"
                      ? "border-[#D97706] bg-[#D97706]/5"
                      : "border-transparent hover:bg-gray-50"
                  }`}
                >
                  <div className={`text-lg font-bold ${clientFilter === "all" ? "text-[#D97706]" : "text-[#1A1A1A]"}`}>{clients.length}</div>
                  <div className={`text-[11px] mt-0.5 ${clientFilter === "all" ? "text-[#D97706] font-medium" : "text-[#6B7280]"}`}>{t("client.all")}</div>
                </button>
                {CLIENT_STATUSES.map((s) => {
                  const count = clients.filter((c) => c.status === s.key).length;
                  const isActive = clientFilter === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setClientFilter(isActive ? "all" : s.key)}
                      className={`flex-1 py-3 text-center transition border-b-2 ${
                        isActive
                          ? "border-[#D97706] bg-[#D97706]/5"
                          : "border-transparent hover:bg-gray-50"
                      }`}
                    >
                      <div className={`text-lg font-bold ${isActive ? "text-[#D97706]" : "text-[#1A1A1A]"}`}>{count}</div>
                      <div className={`text-[11px] mt-0.5 ${isActive ? "text-[#D97706] font-medium" : "text-[#6B7280]"}`}>{s.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <input type="text" placeholder={t("client.search")} value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} className="w-full mb-4 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" />

            {showClientForm && (
              <div className="mb-4 bg-white rounded-lg border border-[#D97706] overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="text-sm font-medium">{editingClientId ? (lang === "ko" ? "고객 수정" : "Edit Client") : t("client.create")}</h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* Company info */}
                  <div>
                    <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wider mb-2">{lang === "ko" ? "기업 정보" : "Company Info"}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-[#6B7280] block mb-1">{t("client.company")} *</label>
                        <input type="text" value={clientForm.company} onChange={(e) => setClientForm({ ...clientForm, company: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" />
                      </div>
                      <div>
                        <label className="text-xs text-[#6B7280] block mb-1">{t("client.department")}</label>
                        <input type="text" value={clientForm.department} onChange={(e) => setClientForm({ ...clientForm, department: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" />
                      </div>
                    </div>
                  </div>
                  {/* Contact info */}
                  <div>
                    <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wider mb-2">{lang === "ko" ? "담당자 정보" : "Contact Info"}</div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-[#6B7280] block mb-1">{t("client.contact")} *</label>
                        <input type="text" value={clientForm.contact_name} onChange={(e) => setClientForm({ ...clientForm, contact_name: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" />
                      </div>
                      <div>
                        <label className="text-xs text-[#6B7280] block mb-1">{t("client.email")}</label>
                        <input type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" />
                      </div>
                      <div>
                        <label className="text-xs text-[#6B7280] block mb-1">{t("client.phone")}</label>
                        <input type="text" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" />
                      </div>
                    </div>
                  </div>
                  {/* Notes */}
                  <div>
                    <label className="text-xs text-[#6B7280] block mb-1">{t("client.notes")}</label>
                    <textarea value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" rows={2} />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleCreateClient} disabled={!clientForm.company.trim() || !clientForm.contact_name.trim()} className="px-4 py-2 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309] disabled:opacity-50">{editingClientId ? t("common.save") : t("client.add")}</button>
                    <button onClick={() => { setShowClientForm(false); setEditingClientId(null); }} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{t("member.cancel")}</button>
                  </div>
                </div>
              </div>
            )}

            {filteredClients.length === 0 && !showClientForm && (
              <p className="text-sm text-[#6B7280]">{clients.length === 0 ? t("client.noClients") : t("client.noMatch")}</p>
            )}

            <div className="space-y-3">
              {filteredClients.map((client) => {
                const si = CLIENT_STATUSES.find((s) => s.key === client.status);
                const isExp = expandedClientId === client.id;
                const history = clientHistoryMap[client.id] || [];
                const cidx = CLIENT_STATUSES.findIndex((s) => s.key === client.status);
                return (
                  <div key={client.id} className={`bg-white rounded-lg border transition cursor-pointer ${isExp ? "border-[#D97706]" : "border-gray-200 hover:border-gray-300"}`} onClick={() => toggleClientExpand(client.id)}>
                    <div className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{client.company || t("client.unnamed")}</span>
                            <span className="text-xs text-[#6B7280]">{client.contact_name}</span>
                            <span className="px-2 py-0.5 text-[10px] rounded-full bg-gray-100 text-[#6B7280]">{si?.label}</span>
                          </div>
                          <div className="mt-1 text-xs text-[#6B7280] space-x-3">
                            {client.email && <span>{client.email}</span>}
                            {client.phone && <span>{client.phone}</span>}
                          </div>
                          {client.assigned_agent && (
                            <span className="mt-1 inline-block text-[10px] bg-[#F5F0E8] text-[#8B7355] px-1.5 py-0.5 rounded">{client.assigned_agent}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <select value={client.status} onChange={(e) => handleUpdateClientStatus(client.id, e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-[#D97706]">
                            {CLIENT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="mt-2 flex gap-0.5">
                        {CLIENT_STATUSES.map((_, i) => <div key={i} className={`h-1 flex-1 rounded-full ${i <= cidx ? "bg-[#D97706]" : "bg-gray-200"}`} />)}
                      </div>
                    </div>

                    {isExp && (
                      <div className="px-4 pb-4 border-t border-gray-100 pt-3" onClick={(e) => e.stopPropagation()}>
                        <div className="grid grid-cols-5 gap-4">
                          {/* Left: details & agent */}
                          <div className="col-span-3 space-y-3">
                            {/* Info grid */}
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="p-2 bg-gray-50 rounded-lg">
                                <div className="text-[10px] text-[#9CA3AF] mb-0.5">{t("client.department")}</div>
                                <div className="font-medium">{client.department || "—"}</div>
                              </div>
                              <div className="p-2 bg-gray-50 rounded-lg">
                                <div className="text-[10px] text-[#9CA3AF] mb-0.5">{t("client.email")}</div>
                                <div className="font-medium truncate">{client.email || "—"}</div>
                              </div>
                              <div className="p-2 bg-gray-50 rounded-lg">
                                <div className="text-[10px] text-[#9CA3AF] mb-0.5">{t("client.phone")}</div>
                                <div className="font-medium">{client.phone || "—"}</div>
                              </div>
                            </div>

                            {client.notes && (
                              <div className="p-2 bg-gray-50 rounded-lg text-xs">
                                <div className="text-[10px] text-[#9CA3AF] mb-0.5">{t("client.notes")}</div>
                                <div className="whitespace-pre-wrap">{client.notes}</div>
                              </div>
                            )}

                            {/* Agent assignment & actions */}
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <label className="text-[10px] text-[#9CA3AF] block mb-1">{t("client.assignAgent")}</label>
                                <select value={client.assigned_agent} onChange={(e) => handleAssignAgent(client.id, e.target.value)} className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 w-full focus:outline-none focus:border-[#D97706]">
                                  <option value="">{t("client.none")}</option>
                                  {activeAgents.map((a) => <option key={a.id} value={a.name}>{a.name} ({a.role})</option>)}
                                </select>
                              </div>
                              {client.assigned_agent && (
                                <button
                                  onClick={() => handleRunOnClient(client)}
                                  className="mt-4 px-3 py-1.5 text-xs bg-[#D97706] text-white rounded-lg hover:bg-[#B45309]"
                                >
                                  {t("client.run", client.assigned_agent)}
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                              <span className="text-[10px] text-[#9CA3AF]">{t("client.created")}: {new Date(client.created_at).toLocaleDateString()}</span>
                              <div className="flex-1" />
                              <button onClick={() => {
                                setEditingClientId(client.id);
                                setClientForm({
                                  company: client.company || "",
                                  contact_name: client.contact_name || "",
                                  email: client.email || "",
                                  phone: client.phone || "",
                                  department: client.department || "",
                                  notes: client.notes || "",
                                });
                                setShowClientForm(true);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }} className="px-2.5 py-1 text-[10px] text-[#6B7280] border border-gray-200 rounded-lg hover:bg-gray-100">{t("common.edit")}</button>
                              <button onClick={() => { if (confirm(t("client.confirmDelete", client.company || t("client.unnamed")))) { deleteClient(client.id).then(() => { refresh(); setExpandedClientId(null); }).catch((err) => console.error("Delete client failed:", err)); } }} className="px-2.5 py-1 text-[10px] text-red-400 border border-red-200 rounded-lg hover:bg-red-50">{t("member.delete")}</button>
                            </div>
                          </div>

                          {/* Right: unified timeline */}
                          <div className="col-span-2">
                            <h4 className="text-xs font-medium text-[#6B7280] mb-2">{lang === "ko" ? "타임라인" : "Timeline"}</h4>
                            {(() => {
                              const timeline = clientTimelines[client.id] || [];
                              const entries = timeline.length > 0 ? timeline : history.map((h) => ({
                                id: h.id, type: "history" as const, agent_name: h.agent_name,
                                action: h.action, detail: h.detail, created_at: h.created_at,
                              }));
                              return entries.length === 0 ? (
                                <p className="text-xs text-[#9CA3AF] py-4 text-center">{t("client.noHistory")}</p>
                              ) : (
                                <div className="space-y-0 max-h-52 overflow-auto">
                                  {entries.map((h, i) => (
                                    <div key={h.id} className="flex gap-2.5 text-xs relative">
                                      <div className="flex flex-col items-center">
                                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                                          h.type === "execution" ? "bg-[#059669]/40" : "bg-[#D97706]/40"
                                        }`} />
                                        {i < entries.length - 1 && <div className="w-px flex-1 bg-gray-200" />}
                                      </div>
                                      <div className="pb-3">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-medium">{h.agent_name}</span>
                                          {h.type === "execution" && (
                                            <span className="text-[9px] px-1 py-0.5 bg-[#059669]/10 text-[#059669] rounded">
                                              {lang === "ko" ? "실행" : "exec"}
                                            </span>
                                          )}
                                          <span className="text-[10px] text-[#9CA3AF]">{new Date(h.created_at).toLocaleString()}</span>
                                        </div>
                                        <div className="text-[#6B7280] mt-0.5">{h.action}</div>
                                        {h.detail && <div className="text-[#9CA3AF] mt-0.5 line-clamp-2">{h.detail}</div>}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {currentPage === "settings" && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-serif font-semibold">{t("settings.title")}</h2>
              {authUser && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#6B7280]">{authUser.email}</span>
                  <button onClick={handleLogout} className="text-xs text-red-400 hover:text-red-600">
                    {t("auth.logout")}
                  </button>
                </div>
              )}
            </div>
            {/* Settings Tab Navigation */}
            <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
              {([
                { key: "general" as const, ko: "일반", en: "General" },
                { key: "integrations" as const, ko: "연동", en: "Integrations" },
                { key: "automation" as const, ko: "자동화", en: "Automation" },
                { key: "team" as const, ko: "팀 관리", en: "Team" },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setSettingsTab(tab.key)}
                  className={`flex-1 px-3 py-2 text-xs rounded-md transition font-medium ${
                    settingsTab === tab.key
                      ? "bg-white text-[#1A1A1A] shadow-sm"
                      : "text-[#6B7280] hover:text-[#1A1A1A]"
                  }`}
                >
                  {tab[lang]}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {/* ── General Tab ── */}
              {settingsTab === "general" && (<>
              {/* Language */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-2">{t("settings.language")}</h3>
                <div className="flex gap-2">
                  {(["ko", "en"] as Lang[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`px-3 py-1.5 text-xs rounded border transition ${
                        lang === l
                          ? "border-[#D97706] bg-[#D97706]/10 text-[#D97706] font-medium"
                          : "border-gray-200 text-[#6B7280] hover:bg-gray-50"
                      }`}
                    >
                      {l === "ko" ? "한국어" : "English"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Server Status */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-2">{t("settings.server")}</h3>
                <div className="flex justify-between text-xs">
                  <span className="text-[#6B7280]">flaude.com</span>
                  <span className={error ? "text-red-500" : "text-[#059669]"}>
                    {error ? t("settings.disconnected") : t("settings.connected")}
                  </span>
                </div>
              </div>

              {/* Skill Library Info */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-2">{t("settings.skillLibrary")}</h3>
                <p className="text-xs text-[#6B7280] mb-2">
                  {t("settings.skillCount", SKILL_LIBRARY.length)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SKILL_CATEGORIES.filter((c) => c.key !== "all").map((cat) => (
                    <span key={cat.key} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                      {cat.label} ({SKILL_LIBRARY.filter((s) => s.category === cat.key).length})
                    </span>
                  ))}
                </div>
              </div>
              </>)}

              {/* ── Integrations Tab ── */}
              {settingsTab === "integrations" && (<>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-medium text-[#1A1A1A]">{t("settings.integrations")}</h3>
                  <button
                    onClick={async () => {
                      setSettingUp("all");
                      setSetupLog("Setting up all integrations...");
                      try {
                        const result = await invoke<string>("setup_all_integrations");
                        setSetupLog(result);
                        setEnabledIntegrations(INTEGRATIONS.map((i) => i.id));
                        const status: Record<string, string> = {};
                        for (const integ of INTEGRATIONS) {
                          try { status[integ.id] = await invoke<string>("check_integration", { id: integ.id }); } catch { status[integ.id] = "error"; }
                        }
                        setIntegrationStatus(status);
                      } catch (e) {
                        setSetupLog(`Error: ${e}`);
                      } finally {
                        setSettingUp(null);
                      }
                    }}
                    disabled={settingUp !== null}
                    className="text-xs text-[#D97706] hover:text-[#B45309] font-medium disabled:opacity-50"
                  >
                    {settingUp === "all" ? t("settings.settingUp") : t("settings.setupAll")}
                  </button>
                </div>

                {setupLog && (
                  <div className="mx-4 mt-3 p-2.5 bg-gray-50 rounded border border-gray-100">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-medium text-[#6B7280]">{t("common.setupLog")}</span>
                      <button onClick={() => setSetupLog("")} className="text-[10px] text-[#6B7280] hover:text-[#1A1A1A]">{t("common.clear")}</button>
                    </div>
                    <pre className="text-[11px] font-mono text-[#1A1A1A] whitespace-pre-wrap">{setupLog}</pre>
                  </div>
                )}

                <div>
                  {/* Group integrations by category */}
                  {[
                    { key: "productivity", label: lang === "ko" ? "생산성 도구" : "Productivity" },
                    { key: "communication", label: lang === "ko" ? "커뮤니케이션" : "Communication" },
                    { key: "dev", label: lang === "ko" ? "개발 도구" : "Developer Tools" },
                  ].map((cat) => {
                    const catIntegrations = INTEGRATIONS.filter((i) => i.category === cat.key);
                    if (catIntegrations.length === 0) return null;
                    return (
                      <div key={cat.key}>
                        <div className="px-4 py-2 bg-gray-50/80 border-b border-gray-100">
                          <span className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wider">{cat.label}</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {catIntegrations.map((integ) => {
                            const enabled = enabledIntegrations.includes(integ.id);
                            const status = integrationStatus[integ.id] || "checking";
                            const isConnected = status.startsWith("connected");
                            const needsAuth = status.startsWith("needs_auth");
                            const isInstalled = isConnected || needsAuth;
                            const isNotInstalled = status === "not_installed";
                            const isError = status === "error";
                            const isBusy = settingUp === integ.id;
                            const isManaged = integ.setupType === "managed";

                            const dotColor = status === "checking" ? "bg-gray-300 animate-pulse"
                              : isConnected ? "bg-[#059669]"
                              : needsAuth ? "bg-[#D97706]"
                              : isError ? "bg-red-400"
                              : "bg-gray-300";

                            const statusLabel = status === "checking" ? t("common.checking")
                              : isConnected ? t("settings.connected")
                              : needsAuth ? t("common.needsAuth")
                              : isError ? t("common.error")
                              : t("common.notInstalled");

                            const handleInstall = async () => {
                              setSettingUp(integ.id);
                              setSetupLog(`Installing ${integ.name}...`);
                              try {
                                const result = await invoke<string>("setup_integration", { id: integ.id, envVars: null });
                                setSetupLog(result);
                                if (!enabled) setEnabledIntegrations([...enabledIntegrations, integ.id]);
                                const s = await invoke<string>("check_integration", { id: integ.id });
                                setIntegrationStatus((prev) => ({ ...prev, [integ.id]: s }));
                              } catch (e) {
                                setSetupLog(`Error: ${e}`);
                              } finally {
                                setSettingUp(null);
                              }
                            };

                            const handleAuth = async () => {
                              setSettingUp(integ.id);
                              setSetupLog(`Authenticating ${integ.name}...`);
                              try {
                                const result = await invoke<string>("auth_integration", { id: integ.id });
                                setSetupLog(result);
                                if (!enabled) setEnabledIntegrations([...enabledIntegrations, integ.id]);
                                setTimeout(async () => {
                                  const s = await invoke<string>("check_integration", { id: integ.id });
                                  setIntegrationStatus((prev) => ({ ...prev, [integ.id]: s }));
                                }, 3000);
                              } catch (e) {
                                setSetupLog(`Error: ${e}`);
                              } finally {
                                setSettingUp(null);
                              }
                            };

                            return (
                              <div key={integ.id} className="px-4 py-3 hover:bg-gray-50/50 transition">
                                <div className="flex items-center gap-3">
                                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    isConnected ? "bg-[#059669]/5" : "bg-gray-50"
                                  }`}>
                                    <IntegrationLogo id={integ.id} size={22} />
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[13px] font-medium text-[#1A1A1A]">{integ.name}</span>
                                      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                      <span className="text-[11px] text-[#6B7280]">{statusLabel}</span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {isManaged && integ.inviteUrl && (
                                      <a
                                        href={integ.inviteUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-3 py-1.5 text-[11px] font-medium text-[#5865F2] border border-[#5865F2]/20 rounded-md hover:bg-[#5865F2]/5 transition"
                                      >
                                        {t("settings.addToServer")}
                                      </a>
                                    )}

                                    {!isManaged && (isNotInstalled || isError) && (
                                      <button
                                        onClick={handleInstall}
                                        disabled={isBusy || settingUp !== null}
                                        className="px-3 py-1.5 text-[11px] font-medium text-[#D97706] border border-[#D97706]/20 rounded-md hover:bg-[#D97706]/5 disabled:opacity-50 transition"
                                      >
                                        {isBusy ? "..." : t("settings.install")}
                                      </button>
                                    )}

                                    {!isManaged && needsAuth && (
                                      <button
                                        onClick={handleAuth}
                                        disabled={isBusy || settingUp !== null}
                                        className="px-3 py-1.5 text-[11px] font-medium text-[#D97706] border border-[#D97706]/20 rounded-md hover:bg-[#D97706]/5 disabled:opacity-50 transition"
                                      >
                                        {isBusy ? "..." : t("settings.connect")}
                                      </button>
                                    )}

                                    {!isManaged && isConnected && (
                                      <span className="text-[11px] font-medium text-[#059669]">{t("settings.ready")}</span>
                                    )}

                                    {(isInstalled || isManaged) && (
                                      <button
                                        onClick={() =>
                                          setEnabledIntegrations(
                                            enabled
                                              ? enabledIntegrations.filter((i) => i !== integ.id)
                                              : [...enabledIntegrations, integ.id]
                                          )
                                        }
                                        className={`relative w-8 h-[18px] rounded-full transition-colors ${
                                          enabled ? "bg-[#D97706]" : "bg-gray-200"
                                        }`}
                                      >
                                        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
                                          enabled ? "left-[16px]" : "left-[2px]"
                                        }`} />
                                      </button>
                                    )}
                                  </div>
                                </div>

                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              </>)}

              {/* ── Automation Tab ── */}
              {settingsTab === "automation" && (<>
              {/* Schedules */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
                  <div>
                    <h3 className="text-sm font-medium text-[#1A1A1A]">{lang === "ko" ? "자동 실행" : "Auto-run"}</h3>
                    <p className="text-[11px] text-[#9CA3AF] mt-0.5">{lang === "ko" ? "팀원이나 팀에게 정해진 시간에 자동으로 일을 시킵니다" : "Automatically assign tasks to members or teams at set times"}</p>
                  </div>
                  <button
                    onClick={() => setShowScheduleForm(!showScheduleForm)}
                    className="text-xs text-[#D97706] hover:text-[#B45309] font-medium"
                  >
                    + {lang === "ko" ? "스케줄 추가" : "Add Schedule"}
                  </button>
                </div>

                {showScheduleForm && (
                  <div className="p-4 border-b border-gray-100 bg-gray-50/50 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-[#9CA3AF] block mb-1">{lang === "ko" ? "스케줄 이름" : "Schedule Name"}</label>
                        <input type="text" placeholder={lang === "ko" ? "예: 매일 아침 리서치" : "e.g. Daily research"} value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" />
                      </div>
                      <div>
                        <label className="text-[10px] text-[#9CA3AF] block mb-1">{lang === "ko" ? "얼마나 자주?" : "How often?"}</label>
                        <select
                          value={SCHEDULE_PRESETS.some((p) => p.cron === scheduleForm.cron_expression) ? scheduleForm.cron_expression : scheduleForm.cron_expression ? "custom" : ""}
                          onChange={(e) => {
                            if (e.target.value === "custom") {
                              setScheduleForm({ ...scheduleForm, cron_expression: "" });
                            } else {
                              setScheduleForm({ ...scheduleForm, cron_expression: e.target.value });
                            }
                          }}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]"
                        >
                          <option value="">{lang === "ko" ? "선택하세요..." : "Select..."}</option>
                          {SCHEDULE_PRESETS.map((p) => (
                            <option key={p.cron} value={p.cron}>{p[lang]}</option>
                          ))}
                          <option value="custom">{lang === "ko" ? "직접 입력 (고급)" : "Custom (advanced)"}</option>
                        </select>
                      </div>
                    </div>
                    {/* Show raw cron input only when "custom" is selected */}
                    {!SCHEDULE_PRESETS.some((p) => p.cron === scheduleForm.cron_expression) && scheduleForm.cron_expression !== "" && (
                      <div>
                        <label className="text-[10px] text-[#9CA3AF] block mb-1">Cron {lang === "ko" ? "표현식" : "Expression"}</label>
                        <input type="text" placeholder="0 9 * * 1-5" value={scheduleForm.cron_expression} onChange={(e) => setScheduleForm({ ...scheduleForm, cron_expression: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706] font-mono text-xs" />
                        <p className="text-[10px] text-[#9CA3AF] mt-1">
                          {lang === "ko" ? "예: \"0 9 * * 1-5\" → 평일 오전 9시, \"0 */6 * * *\" → 6시간마다" : "e.g. \"0 9 * * 1-5\" → Weekdays 9am, \"0 */6 * * *\" → Every 6h"}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-[#9CA3AF] block mb-1">{lang === "ko" ? "누구한테 시킬까요?" : "Who should do it?"}</label>
                        <select value={scheduleForm.agent_id ? `agent:${scheduleForm.agent_id}` : scheduleForm.team_id ? `team:${scheduleForm.team_id}` : ""} onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("agent:")) setScheduleForm({ ...scheduleForm, agent_id: Number(v.split(":")[1]), team_id: null });
                          else if (v.startsWith("team:")) setScheduleForm({ ...scheduleForm, agent_id: null, team_id: Number(v.split(":")[1]) });
                          else setScheduleForm({ ...scheduleForm, agent_id: null, team_id: null });
                        }} className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]">
                          <option value="">{lang === "ko" ? "팀원 또는 팀 선택..." : "Select member or team..."}</option>
                          {activeAgents.map((a) => <option key={`a-${a.id}`} value={`agent:${a.id}`}>{a.name} ({a.role})</option>)}
                          {agentTeams.map((tm) => <option key={`t-${tm.id}`} value={`team:${tm.id}`}>{lang === "ko" ? "팀" : "Team"}: {tm.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-[#9CA3AF] block mb-1">{lang === "ko" ? "결과 알림 받을 채널 (선택)" : "Results notification (optional)"}</label>
                        <input type="text" placeholder={lang === "ko" ? "Discord 또는 Slack 채널 ID" : "Discord or Slack channel ID"} value={scheduleForm.notification_channel} onChange={(e) => setScheduleForm({ ...scheduleForm, notification_channel: e.target.value })} className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706] font-mono text-xs" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-[#9CA3AF] block mb-1">{lang === "ko" ? "무슨 일을 시킬까요?" : "What should they do?"}</label>
                      <textarea value={scheduleForm.prompt} onChange={(e) => setScheduleForm({ ...scheduleForm, prompt: e.target.value })} placeholder={lang === "ko" ? "예: 오늘의 주요 뉴스를 조사해서 보고해줘" : "e.g. Research today's key news and report"} className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#D97706]" rows={2} />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!workspaceId || !scheduleForm.name.trim() || !scheduleForm.cron_expression.trim()) return;
                          try {
                            await createSchedule(workspaceId, scheduleForm);
                            setSchedules(await getSchedules(workspaceId));
                            setShowScheduleForm(false);
                            setScheduleForm({ name: "", agent_id: null, team_id: null, cron_expression: "", prompt: "", notification_channel: "" });
                          } catch (e) { setError(`${e}`); }
                        }}
                        disabled={!scheduleForm.name.trim() || !scheduleForm.cron_expression.trim()}
                        className="px-4 py-1.5 text-sm bg-[#D97706] text-white rounded-lg hover:bg-[#B45309] disabled:opacity-50"
                      >
                        {lang === "ko" ? "추가" : "Add"}
                      </button>
                      <button onClick={() => setShowScheduleForm(false)} className="px-4 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{t("member.cancel")}</button>
                    </div>
                  </div>
                )}

                {schedules.length === 0 && !showScheduleForm && (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-[#9CA3AF]">{lang === "ko" ? "아직 자동 실행이 없습니다. 위에서 스케줄을 추가해보세요." : "No auto-runs yet. Add a schedule above."}</p>
                  </div>
                )}

                <div className="divide-y divide-gray-100">
                  {schedules.map((s) => (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition group">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${s.is_active ? "bg-[#D97706]/10 text-[#D97706]" : "bg-gray-100 text-[#9CA3AF]"}`}>
                        S
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium">{s.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-[#6B7280]">{cronLabel(s.cron_expression, lang)}</span>
                        </div>
                        <div className="text-[11px] text-[#9CA3AF] truncate mt-0.5">
                          {s.prompt.slice(0, 60)}
                          {s.last_run_at && <span className="ml-2">{lang === "ko" ? "마지막" : "Last"}: {new Date(s.last_run_at).toLocaleString()}</span>}
                        </div>
                      </div>
                      <button
                        onClick={async () => { await deleteSchedule(s.id); if (workspaceId) setSchedules(await getSchedules(workspaceId)); }}
                        className="text-[10px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Approvals */}
              {approvals.length > 0 && (
                <div className="bg-white rounded-lg border border-[#D97706]/30 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-[#D97706]/5">
                    <h3 className="text-sm font-medium text-[#D97706]">{lang === "ko" ? "내 확인이 필요한 작업" : "Needs Your OK"} ({approvals.length})</h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {approvals.map((a) => (
                      <div key={a.id} className="px-4 py-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-[13px] font-medium">
                              {a.team_name}
                            </div>
                            <p className="text-[11px] text-[#6B7280] mt-0.5">
                              {lang === "ko"
                                ? `${a.agent_name}의 작업이 끝났습니다. ${a.next_agent_name}에게 넘길까요?`
                                : `${a.agent_name} finished. Pass to ${a.next_agent_name}?`}
                            </p>
                            {a.result_preview && <p className="text-[10px] text-[#9CA3AF] mt-1 line-clamp-2 bg-gray-50 p-1.5 rounded">{a.result_preview}</p>}
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0 ml-3">
                            <button
                              onClick={async () => {
                                await decideApproval(a.id, "approved");
                                setApprovals(approvals.filter((x) => x.id !== a.id));
                              }}
                              className="px-3 py-1 text-xs bg-[#059669] text-white rounded-lg hover:bg-[#047857]"
                            >
                              {lang === "ko" ? "승인" : "Approve"}
                            </button>
                            <button
                              onClick={async () => {
                                await decideApproval(a.id, "rejected");
                                setApprovals(approvals.filter((x) => x.id !== a.id));
                              }}
                              className="px-3 py-1 text-xs border border-red-300 text-red-500 rounded-lg hover:bg-red-50"
                            >
                              {lang === "ko" ? "거절" : "Reject"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              </>)}

              {/* ── Team & Users Tab ── */}
              {settingsTab === "team" && (<>
              {/* Workspace Users & Invites */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-medium text-[#1A1A1A]">{t("workspace.users")}</h3>
                  <p className="text-[11px] text-[#9CA3AF] mt-0.5">{t("workspace.usersHint")}</p>
                </div>

                {/* Member list */}
                <div className="divide-y divide-gray-100">
                  {wsMembers.map((m) => (
                    <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 group">
                      <div className="w-7 h-7 rounded-full bg-[#D97706]/10 flex items-center justify-center text-xs font-medium text-[#D97706]">
                        {(m.name || m.email)[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{m.name || m.email.split("@")[0]}</div>
                        <div className="text-[11px] text-[#9CA3AF] truncate">{m.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.role === "owner" ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#D97706]/10 text-[#D97706]">{t("workspace.roleOwner")}</span>
                        ) : (
                          <select
                            value={m.role}
                            onChange={async (e) => {
                              if (!workspaceId) return;
                              await updateMemberRole(workspaceId, m.id, e.target.value);
                              await refresh();
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 bg-white focus:outline-none"
                          >
                            <option value="admin">{t("workspace.roleAdmin")}</option>
                            <option value="member">{t("workspace.roleMember")}</option>
                          </select>
                        )}
                        {m.role !== "owner" && (
                          <button
                            onClick={async () => {
                              if (!workspaceId || !confirm(t("workspace.removeUser") + "?")) return;
                              await removeWorkspaceMember(workspaceId, m.id);
                              await refresh();
                            }}
                            className="text-[10px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
                          >
                            {t("common.delete")}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pending invites */}
                {wsInvites.length > 0 && (
                  <div className="border-t border-gray-100">
                    <div className="px-4 py-2 text-[11px] text-[#9CA3AF] font-medium">{t("workspace.invitePending")}</div>
                    {wsInvites.map((inv) => (
                      <div key={inv.id} className="px-4 py-2 flex items-center gap-3 group">
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs text-[#9CA3AF]">?</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-[#6B7280] truncate">{inv.email}</div>
                        </div>
                        <span className="text-[10px] text-[#9CA3AF]">{inv.role}</span>
                        <button
                          onClick={async () => { await cancelInvite(inv.id); await refresh(); }}
                          className="text-[10px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
                        >
                          {t("workspace.inviteCancel")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Invite form */}
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!workspaceId || !inviteEmail.trim()) return;
                      try {
                        await createWorkspaceInvite(workspaceId, inviteEmail.trim(), inviteRole);
                        setInviteEmail("");
                        await refresh();
                      } catch (err) { setError(`${err}`); }
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="email"
                      placeholder={t("workspace.inviteEmail")}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706]"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                      className="px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none"
                    >
                      <option value="member">{t("workspace.roleMember")}</option>
                      <option value="admin">{t("workspace.roleAdmin")}</option>
                    </select>
                    <button
                      type="submit"
                      disabled={!inviteEmail.trim()}
                      className="px-4 py-1.5 text-sm bg-[#D97706] text-white rounded hover:bg-[#B45309] disabled:opacity-50"
                    >
                      {t("workspace.inviteSend")}
                    </button>
                  </form>
                </div>
              </div>

              {/* Staff (Human Team Members) */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
                  <div>
                    <h3 className="text-sm font-medium text-[#1A1A1A]">{t("staff.title")}</h3>
                    <p className="text-[11px] text-[#9CA3AF] mt-0.5">{t("staff.hint")}</p>
                  </div>
                  <button
                    onClick={() => { setShowStaffForm(true); setEditingStaffId(null); setStaffForm({ name: "", role: "", email: "", phone: "", notes: "" }); }}
                    className="text-xs text-[#D97706] hover:text-[#B45309] font-medium"
                  >
                    + {t("staff.add")}
                  </button>
                </div>

                {showStaffForm && (
                  <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder={t("staff.name")} value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706]" />
                      <input type="text" placeholder={t("staff.role")} value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706]" />
                      <input type="email" placeholder={t("staff.email")} value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706]" />
                      <input type="text" placeholder={t("staff.phone")} value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706]" />
                      <textarea placeholder={t("staff.notes")} value={staffForm.notes} onChange={(e) => setStaffForm({ ...staffForm, notes: e.target.value })} className="col-span-2 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706]" rows={2} />
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={async () => {
                          if (!workspaceId || !staffForm.name.trim()) return;
                          try {
                            if (editingStaffId) {
                              await updateStaff(editingStaffId, staffForm);
                            } else {
                              await createStaff(workspaceId, staffForm);
                            }
                            await refresh();
                            setShowStaffForm(false);
                          } catch (e) { setError(`${e}`); }
                        }}
                        className="px-4 py-1.5 text-sm bg-[#D97706] text-white rounded hover:bg-[#B45309]"
                      >
                        {editingStaffId ? t("common.save") : t("client.add")}
                      </button>
                      <button onClick={() => setShowStaffForm(false)} className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">{t("member.cancel")}</button>
                    </div>
                  </div>
                )}

                {staffList.length === 0 && !showStaffForm && (
                  <div className="px-4 py-6 text-center text-xs text-[#9CA3AF]">{t("staff.empty")}</div>
                )}

                <div className="divide-y divide-gray-100">
                  {staffList.map((s) => (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition group">
                      <img src={avatarUrl(s.name)} alt="" className="w-8 h-8 rounded-full bg-gray-100" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium">{s.name}</span>
                          {s.role && <span className="text-[11px] text-[#9CA3AF]">{s.role}</span>}
                        </div>
                        <div className="text-[11px] text-[#9CA3AF] truncate">
                          {[s.email, s.phone].filter(Boolean).join(" · ") || t("staff.notes")}
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={() => { setEditingStaffId(s.id); setStaffForm({ name: s.name, role: s.role, email: s.email, phone: s.phone, notes: s.notes }); setShowStaffForm(true); }}
                          className="px-2 py-1 text-[10px] text-[#6B7280] border border-gray-200 rounded hover:bg-gray-100"
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          onClick={async () => { if (confirm(t("staff.confirmDelete", s.name))) { await deleteStaff(s.id); await refresh(); } }}
                          className="px-2 py-1 text-[10px] text-red-400 border border-red-200 rounded hover:bg-red-50"
                        >
                          {t("common.delete")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              </>)}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
