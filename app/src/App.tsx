import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  SERVER_URL,
  type Meeting,
  type MeetingTranscript as MeetingTranscriptType,
  type MeetingAgentResult,
  getMeetings,
  createMeeting,
  deleteMeeting,
  updateMeeting,
  getMeetingTranscript,
  saveMeetingTranscript,
  updateMeetingTranscript,
  processMeeting,
  getMeetingResults,
} from "./api";
import {
  SKILL_LIBRARY,
  SKILL_CATEGORIES,
  INTEGRATIONS,
  // BUILT_IN_TOOLS,
  mergeSkills,
  toolLabel,
  cronLabel,
  SCHEDULE_PRESETS,
  PERMISSION_GROUPS,
  permissionGroupsToSdkTools,
  sdkToolsToPermissionGroups,
  permissionGroupsToDisallowed,
  buildGwsRestrictions,
  type Skill,
  // type PermissionGroup,
} from "./skills";
import { createT, type Lang } from "./i18n";
import { AGENT_TEMPLATES, type AgentTemplate } from "./templates";

// CLIENT_STATUSES labels are resolved via i18n in the component

// Moved to inside App component to be reactive to enabledIntegrations

type Page = "chat" | "agents" | "teams" | "clients" | "meetings" | "settings";

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

// ── Permission Selector (user-friendly) ─────────────

function PermissionSelector({
  label,
  hint,
  selected,
  onChange,
  lang,
  hasGws,
}: {
  label: string;
  hint?: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  lang: "ko" | "en";
  hasGws: boolean;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((g) => g !== id) : [...selected, id]);
  const groups = PERMISSION_GROUPS.filter((g) => !g.requiresGws || hasGws);

  return (
    <div>
      <label className="text-xs font-medium text-[#6B7280] block mb-1.5">{label}</label>
      {hint && <p className="text-[10px] text-[#9CA3AF] mb-2">{hint}</p>}
      <div className="grid grid-cols-2 gap-1.5">
        {groups.map((g) => {
          const on = selected.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition ${
                on
                  ? "bg-[#D97706]/5 border-[#D97706]/30"
                  : "bg-gray-50 border-gray-200 hover:bg-gray-100"
              }`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                on ? "bg-[#D97706] border-[#D97706]" : "border-gray-300"
              }`}>
                {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-[#374151]">{g[lang]}</div>
                <div className="text-[10px] text-[#9CA3AF] truncate">{g.description[lang]}</div>
              </div>
            </button>
          );
        })}
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

  // Update state
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; body: string } | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    // Check for updates on launch (skip in dev)
    if (window.location.hostname === "localhost") return;
    const checkUpdate = async () => {
      try {
        const update = await check();
        if (update) {
          setUpdateAvailable({ version: update.version, body: update.body || "" });
        }
      } catch {
        // Silently ignore update check failures
      }
    };
    checkUpdate();
    // Re-check every 30 minutes
    const interval = setInterval(checkUpdate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (e) {
      console.error("Update failed:", e);
      setUpdating(false);
    }
  };

  // Auth state
  const [authUser, setAuthUser] = useState<{ email: string; name: string } | null>(() => {
    try { const s = localStorage.getItem("flaude_user"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getAuthToken());
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);

  // Connect WebSocket to server for Discord dispatch
  const connectWebSocket = async (token?: string) => {
    const t = token || getAuthToken();
    if (!t) { setWsError("No auth token"); return; }
    try {
      setWsError(null);
      await invoke<string>("ws_connect", { serverUrl: SERVER_URL, token: t });
      setWsConnected(true);
      setWsError(null);
    } catch (e) {
      console.error("WebSocket connection failed:", e);
      setWsError(String(e));
      setWsConnected(false);
    }
  };

  // Auto-connect on app start if already logged in
  useEffect(() => {
    if (isLoggedIn) {
      connectWebSocket();
    }
  }, [isLoggedIn]);

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
            // Connect WebSocket for Discord dispatch
            connectWebSocket(result.token);
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
  const [currentPage, setCurrentPage] = useState<Page>("chat");
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
  const [, setAgentFormNotAllowed] = useState<string[]>([]);
  // Permission group IDs for user-friendly UI
  const [agentFormPermissions, setAgentFormPermissions] = useState<string[]>(["web-research", "file-access", "run-commands"]);
  const [agentFormDenied, setAgentFormDenied] = useState<string[]>([]);
  const [agentFormSkills, setAgentFormSkills] = useState<string[]>([]);
  const [agentFormChannels, setAgentFormChannels] = useState("");
  const [agentFormReduceHallucinations, setAgentFormReduceHallucinations] = useState(false);
  const [agentFormMaxTurns, setAgentFormMaxTurns] = useState<string>("");
  const [agentFormMaxBudget, setAgentFormMaxBudget] = useState<string>("");
  const [agentFormEffort, setAgentFormEffort] = useState<"" | "low" | "medium" | "high">("");
  const [skillCategory, setSkillCategory] = useState("all");
  const [showSkillBrowser, setShowSkillBrowser] = useState(false);

  // Team form
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamFormName, setTeamFormName] = useState("");
  const [teamFormMembers, setTeamFormMembers] = useState<number[]>([]);
  const [teamFormLead, setTeamFormLead] = useState<number | null>(null);
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

  // Meeting
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);
  const [meetingTranscript, setMeetingTranscript] = useState<MeetingTranscriptType | null>(null);
  const [recentTranscripts, setRecentTranscripts] = useState<Record<number, string>>({});
  const [, setMeetingResults] = useState<MeetingAgentResult[]>([]);
  const [meetingEnabled, setMeetingEnabled] = useState(() =>
    localStorage.getItem("flaude_meeting_enabled") === "true"
  );
  const [meetingProcessAgent, setMeetingProcessAgent] = useState<number | null>(null);
  const [meetingProcessing, setMeetingProcessing] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [editTranscriptText, setEditTranscriptText] = useState("");

  // Recording (Phase 2)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const recordingTimerRef = useRef<number | null>(null);

  // Meeting Settings
  const [whisperInstalled, setWhisperInstalled] = useState<boolean | null>(null);
  const [ffmpegInstalled, setFfmpegInstalled] = useState<boolean | null>(null);
  // BlackHole removed — using ScreenCaptureKit / WASAPI for system audio
  const [whisperModels, setWhisperModels] = useState<{ name: string; size_mb: number; path: string; downloaded: boolean }[]>([]);
  const [activeWhisperModel, setActiveWhisperModel] = useState(() =>
    localStorage.getItem("flaude_meeting_model") || "medium"
  );
  const [meetingAudioSource, setMeetingAudioSource] = useState(() =>
    localStorage.getItem("flaude_meeting_source") || "mic"
  );
  const [_meetingAutoDelete] = useState(() =>
    localStorage.getItem("flaude_meeting_auto_delete") !== "false"
  );
  const [meetingLanguage, setMeetingLanguage] = useState(() =>
    localStorage.getItem("flaude_meeting_language") || "ko"
  );

  // Settings — persist to localStorage
  const [enabledIntegrations, setEnabledIntegrations] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("flaude_integrations");
      return saved ? JSON.parse(saved) : ["gws"];
    } catch { return ["gws"]; }
  });
  type DriveFolder = { label: string; folderId: string; driveId?: string };
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>(() => {
    try { return JSON.parse(localStorage.getItem("flaude_drive_folders") || "[]"); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem("flaude_drive_folders", JSON.stringify(driveFolders)); }, [driveFolders]);

  // Default file save path
  const [defaultSavePath, setDefaultSavePath] = useState(() => localStorage.getItem("flaude_save_path") || "");
  useEffect(() => { localStorage.setItem("flaude_save_path", defaultSavePath); }, [defaultSavePath]);

  // Per-agent advanced settings (stored locally)
  type AgentAdvSettings = { reduceHallucinations?: boolean; maxTurns?: number; maxBudgetUsd?: number; effort?: "low" | "medium" | "high" };
  const [agentAdvSettings, setAgentAdvSettings] = useState<Record<number, AgentAdvSettings>>(() => {
    try { return JSON.parse(localStorage.getItem("flaude_agent_adv") || "{}"); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem("flaude_agent_adv", JSON.stringify(agentAdvSettings)); }, [agentAdvSettings]);

  // Chat: unified conversations stored locally
  type ChatMsg = { role: "user" | "agent" | "system"; text: string; agentName?: string; files?: string[]; ts?: number; error?: boolean };
  type Conversation = { id: string; title: string; messages: ChatMsg[]; sessions: Record<number, string>; createdAt: number; lastAgentId?: number };

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [chatRunningAgent, setChatRunningAgent] = useState<string | null>(null);
  const streamTargetTsRef = useRef<number>(0); // current streaming message timestamp
  const streamRunningAgentRef = useRef<string | null>(null); // agent name for new interject placeholders
  const [chatFiles, setChatFiles] = useState<{ name: string; path: string }[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dataDir, setDataDir] = useState("");
  const [chatDataLoaded, setChatDataLoaded] = useState(false);

  // Legacy per-agent chats (used in agents page inline chat)
  const [agentChats, setAgentChats] = useState<Record<number, ChatMsg[]>>({});
  const [agentSessions, setAgentSessions] = useState<Record<number, string>>({});

  // Load chat data from file storage on mount
  useEffect(() => {
    (async () => {
      try {
        const [convosRaw, activeRaw, chatsRaw, sessionsRaw, dirPath] = await Promise.all([
          invoke<string>("read_data", { key: "conversations" }),
          invoke<string>("read_data", { key: "active_convo" }),
          invoke<string>("read_data", { key: "agent_chats" }),
          invoke<string>("read_data", { key: "agent_sessions" }),
          invoke<string>("get_data_path"),
        ]);
        if (convosRaw && convosRaw !== "null") setConversations(JSON.parse(convosRaw));
        if (activeRaw && activeRaw !== "null") setActiveConvoId(JSON.parse(activeRaw));
        if (chatsRaw && chatsRaw !== "null") setAgentChats(JSON.parse(chatsRaw));
        if (sessionsRaw && sessionsRaw !== "null") setAgentSessions(JSON.parse(sessionsRaw));
        setDataDir(dirPath);
      } catch {
        // Fallback: migrate from localStorage if file storage fails
        try {
          const lc = localStorage.getItem("flaude_convos");
          if (lc) setConversations(JSON.parse(lc));
          const la = localStorage.getItem("flaude_active_convo");
          if (la) setActiveConvoId(la);
        } catch { /* ignore */ }
      } finally {
        setChatDataLoaded(true);
      }
    })();
  }, []);

  const activeConvo = conversations.find((c) => c.id === activeConvoId) || null;
  const chatMessages = activeConvo?.messages || [];

  const updateConvo = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => c.id === id ? updater(c) : c));
  }, []);

  const createConvo = useCallback(() => {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const convo: Conversation = { id, title: lang === "ko" ? "새 대화" : "New chat", messages: [], sessions: {}, createdAt: Date.now() };
    setConversations((prev) => [convo, ...prev]);
    setActiveConvoId(id);
    setChatFiles([]);
    return id;
  }, [lang]);

  // Persist conversations to file storage (only after initial load completes)
  useEffect(() => { if (chatDataLoaded) invoke("write_data", { key: "conversations", value: JSON.stringify(conversations) }).catch(() => {}); }, [conversations, chatDataLoaded]);
  useEffect(() => { if (chatDataLoaded) invoke("write_data", { key: "active_convo", value: JSON.stringify(activeConvoId) }).catch(() => {}); }, [activeConvoId, chatDataLoaded]);
  useEffect(() => { if (chatDataLoaded) invoke("write_data", { key: "agent_chats", value: JSON.stringify(agentChats) }).catch(() => {}); }, [agentChats, chatDataLoaded]);
  useEffect(() => { if (chatDataLoaded) invoke("write_data", { key: "agent_sessions", value: JSON.stringify(agentSessions) }).catch(() => {}); }, [agentSessions, chatDataLoaded]);

  // ── Recording toggle via global shortcut ──
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("toggle-recording", async () => {
      const status = await invoke<string>("get_recording_status");
      const { recording } = JSON.parse(status);
      if (recording) {
        // Stop recording
        try {
          const res = await invoke<string>("stop_recording");
          const data = JSON.parse(res);
          setIsRecording(false);
          if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
          setRecordingElapsed(0);
          if (workspaceId) {
            const m = await createMeeting(workspaceId, {
              title: `${new Date().toLocaleDateString()} recording`,
              meeting_date: new Date().toISOString(),
              duration_seconds: data.duration_seconds,
              audio_filename: data.path,
              audio_source: meetingAudioSource === "system" ? "system" : "mic",
              status: "uploaded",
            });
            setMeetings((prev) => [m, ...prev]);
          }
        } catch (e) {
          console.error("Stop recording failed:", e);
        }
      } else {
        // Start recording
        try {
          const path = `/tmp/flaude_recordings/${Date.now()}.wav`;
          await invoke("start_recording", { source: meetingAudioSource, path });
          setIsRecording(true);
          setRecordingElapsed(0);
          recordingTimerRef.current = window.setInterval(() => setRecordingElapsed((e) => e + 1), 1000);
        } catch (e) {
          alert(`Recording failed: ${e}\n\nMac: System Settings > Privacy & Security > Microphone > enable Terminal/Flaude`);
        }
      }
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [workspaceId, meetingAudioSource]);

  // ── Knowledge Memory (local knowledge graph) ──
  type MemoryNode = {
    id: string;
    category: "client" | "project" | "person" | "decision" | "fact";
    subject: string;
    content: string;
    source: string; // conversation title / agent name
    createdAt: number;
    relations?: string[]; // IDs of related nodes
  };
  const [knowledgeMemory, setKnowledgeMemory] = useState<MemoryNode[]>([]);
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(() => localStorage.getItem("flaude_memory_enabled") !== "false");

  // Load knowledge memory from file storage
  useEffect(() => {
    (async () => {
      try {
        const raw = await invoke<string>("read_data", { key: "knowledge_memory" });
        if (raw && raw !== "null") setKnowledgeMemory(JSON.parse(raw));
      } catch { /* ignore */ }
      setMemoryLoaded(true);
    })();
  }, []);

  // Persist knowledge memory
  useEffect(() => {
    if (memoryLoaded) invoke("write_data", { key: "knowledge_memory", value: JSON.stringify(knowledgeMemory) }).catch(() => {});
  }, [knowledgeMemory, memoryLoaded]);
  useEffect(() => { localStorage.setItem("flaude_memory_enabled", memoryEnabled ? "true" : "false"); }, [memoryEnabled]);

  // Extract memories from a conversation turn (runs in background, no latency)
  const extractMemories = useCallback(async (userMsg: string, agentResponse: string, agentName: string, convoTitle: string) => {
    if (!memoryEnabled) return;
    // Don't extract from error responses or very short ones
    if (agentResponse.length < 50 || agentResponse.startsWith("Error")) return;

    try {
      // Build existing memory context for dedup + relation linking
      const existingSubjects = knowledgeMemory.slice(-20).map((m) => m.subject);
      const existingCtx = existingSubjects.length > 0
        ? `\n\n이미 저장된 기억 (중복 금지, 관계 연결에 활용):\n${existingSubjects.map((s) => `- ${s}`).join("\n")}`
        : "";

      const extractionPrompt = `아래 대화에서 장기적으로 기억할 가치가 있는 핵심 정보를 지식 그래프 노드로 추출하세요.

## 추출 기준
✅ 추출 대상:
- 고객/회사 정보 (이름, 연락처, 업종, 히스토리)
- 프로젝트 결정사항, 마일스톤, 일정
- 중요 인물과 역할 관계
- 비즈니스 수치, KPI, 예산
- 기술적 결정이나 아키텍처 선택

❌ 추출 금지:
- 일반 대화, 인사, 단순 질문/답변
- 이미 알려진 상식이나 일반 지식
- 코드 스니펫이나 구현 세부사항
- 이미 저장된 정보와 동일한 내용

## 관계(relations) 작성 규칙
- 이미 저장된 기억의 subject와 연결될 수 있으면 해당 subject를 relations에 포함
- 같은 추출 결과 내 다른 노드와도 연결
- 관계는 구체적 키워드로 (예: "삼성전자", "2024 리뉴얼 프로젝트")
${existingCtx}

## 응답 형식 (JSON만, 다른 텍스트 금지)
추출할 게 없으면: []
있으면:
[{"category":"client|project|person|decision|fact","subject":"고유하고 구체적인 제목","content":"맥락이 담긴 1~2문장 설명","relations":["관련_subject_또는_키워드"]}]

---
대화:
사용자: ${userMsg.slice(0, 800)}
${agentName}: ${agentResponse.slice(0, 2000)}`;

      const raw = await invoke<string>("run_agent", {
        prompt: extractionPrompt,
        instructions: "너는 지식 그래프 빌더다. 대화에서 장기 기억할 정보를 JSON 노드로 추출한다. 도구를 절대 사용하지 마라. JSON 배열만 반환하라.",
        allowedTools: "",
        disallowedTools: null,
        sessionId: null,
        continueSession: null,
        agents: null,
        enableCheckpointing: false,
        cwd: null,
        maxTurns: 1,
        maxBudgetUsd: null,
        effort: "medium",
        model: "sonnet",
      });

      const parsed = JSON.parse(raw);
      const result = parsed.result || raw;
      // Try to extract JSON array from the result
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;
      const items: Array<{ category: string; subject: string; content: string; relations?: string[] }> = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(items) || items.length === 0) return;

      const newNodes: MemoryNode[] = items
        .filter((item) => item.subject && item.content && ["client", "project", "person", "decision", "fact"].includes(item.category))
        .slice(0, 5) // Max 5 per turn — sonnet is better at quality filtering
        .map((item) => ({
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          category: item.category as MemoryNode["category"],
          subject: item.subject,
          content: item.content,
          source: `${agentName} · ${convoTitle}`,
          createdAt: Date.now(),
          relations: item.relations,
        }));

      if (newNodes.length > 0) {
        // Deduplicate: skip if same subject already exists
        setKnowledgeMemory((prev) => {
          const existing = new Set(prev.map((n) => n.subject));
          const unique = newNodes.filter((n) => !existing.has(n.subject));
          return unique.length > 0 ? [...prev, ...unique] : prev;
        });
      }
    } catch {
      // Silent fail — memory extraction is best-effort
    }
  }, [memoryEnabled, knowledgeMemory]);

  // Auto-scroll on new messages
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, chatRunningAgent]);

  // Cmd+N for new conversation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && currentPage === "chat") {
        e.preventDefault();
        createConvo();
        chatInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentPage, createConvo]);

  const [convoSearch, setConvoSearch] = useState("");
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);

  const copyMessage = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgIdx(idx);
    setTimeout(() => setCopiedMsgIdx(null), 1500);
  };

  // ── Confidence badge rendering ──
  // Problem: ReactMarkdown parses [확인됨] as markdown link syntax.
  // Solution: Pre-process text BEFORE markdown parsing to replace badges
  // with inline code markers that markdown won't touch, then render them
  // as React components via the `code` handler.
  const BADGE_TOKEN = "::badge::";
  const BADGE_MAP: Record<string, { style: string; label: string; icon: string }> = {
    confirmed: { style: "bg-emerald-50 text-emerald-700 border-emerald-200", label: lang === "ko" ? "확인됨" : "Verified", icon: "\u2713" },
    estimated: { style: "bg-amber-50 text-amber-700 border-amber-200", label: lang === "ko" ? "추정" : "Estimated", icon: "~" },
    unverified: { style: "bg-red-50 text-red-600 border-red-200", label: lang === "ko" ? "미확인" : "Unverified", icon: "?" },
    "no-source": { style: "bg-gray-100 text-gray-500 border-gray-200", label: lang === "ko" ? "출처 미확인" : "No Source", icon: "\u2014" },
  };

  const ConfidenceBadge = ({ type }: { type: string }) => {
    const b = BADGE_MAP[type];
    if (!b) return <code>{type}</code>;
    return (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full border ${b.style} align-middle mx-0.5 not-prose`}>
        <span className="text-[9px]">{b.icon}</span>{b.label}
      </span>
    );
  };

  /** Pre-process markdown text: convert [확인됨] etc to backtick-wrapped tokens
   *  that ReactMarkdown will treat as inline code, then we intercept in the `code` renderer. */
  const preprocessBadges = (text: string): string => {
    return text
      .replace(/\[출처 미확인\]/g, `\`${BADGE_TOKEN}no-source\``)
      .replace(/\[확인됨\]/g, `\`${BADGE_TOKEN}confirmed\``)
      .replace(/\[추정\]/g, `\`${BADGE_TOKEN}estimated\``)
      .replace(/\[미확인\]/g, `\`${BADGE_TOKEN}unverified\``);
  };

  const MarkdownMessage = ({ text }: { text: string }) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1.5 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-[15px] font-bold mt-3 mb-1 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0">{children}</h3>,
        h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-0.5 first:mt-0">{children}</h4>,
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 last:mb-0 pl-4 space-y-0.5 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 last:mb-0 pl-4 space-y-0.5 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ href, children }) => {
          // Style source/citation links with a special pill look
          const isSource = href && (href.startsWith("http") || href.startsWith("https"));
          const childText = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
          const isFootnote = /^\d+$/.test(childText) || /^출처/.test(childText) || /^source/i.test(childText);
          if (isSource && isFootnote) {
            return (
              <a href={href} onClick={(e) => { e.preventDefault(); openUrl(href!); }} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-[#D97706] bg-[#D97706]/5 rounded-full border border-[#D97706]/20 hover:bg-[#D97706]/10 cursor-pointer align-middle mx-0.5 no-underline font-medium" title={href}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                {children}
              </a>
            );
          }
          return (
            <a href={href} onClick={(e) => { e.preventDefault(); if (href) openUrl(href); }} className="text-[#D97706] underline underline-offset-2 hover:text-[#B45309] cursor-pointer">
              {children}
            </a>
          );
        },
        blockquote: ({ children }) => (
          <blockquote className="border-l-[3px] border-[#D97706]/40 pl-3 my-2 text-[#6B7280] italic">{children}</blockquote>
        ),
        hr: () => <hr className="my-3 border-gray-200" />,
        code: ({ className, children, ...props }) => {
          // Intercept badge tokens
          const childStr = typeof children === "string" ? children : "";
          if (childStr.startsWith(BADGE_TOKEN)) {
            const type = childStr.slice(BADGE_TOKEN.length);
            return <ConfidenceBadge type={type} />;
          }
          const isBlock = className?.includes("language-");
          if (isBlock) {
            const langName = className?.replace("language-", "") || "";
            return (
              <div className="my-2 rounded-lg overflow-hidden bg-[#1A1A1A]">
                {langName && <div className="px-3 pt-2 text-[10px] text-[#6B7280] font-mono">{langName}</div>}
                <pre className="p-3 pt-1.5 overflow-x-auto text-xs">
                  <code className="text-[#E5E5E5] font-mono" {...props}>{children}</code>
                </pre>
              </div>
            );
          }
          return <code className="px-1 py-0.5 bg-gray-100 text-[#D97706] rounded text-xs font-mono" {...props}>{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50 border-b border-gray-200">{children}</thead>,
        th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold text-[#374151]">{children}</th>,
        td: ({ children }) => <td className="px-3 py-1.5 border-t border-gray-100">{children}</td>,
        input: ({ checked, ...props }) => (
          <input type="checkbox" checked={checked} readOnly className="mr-1.5 accent-[#D97706]" {...props} />
        ),
      }}
    >
      {preprocessBadges(text)}
    </ReactMarkdown>
  );

  // Used in history dropdown (filtered inline)

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
  const [, setIntegrationStatus] = useState<Record<string, string>>({});
  const [setupLog, setSetupLog] = useState("");
  const [settingUp, setSettingUp] = useState<string | null>(null);

  // Agent Memory
  const [agentMemories, setAgentMemories] = useState<Record<number, AgentMemory[]>>({});
  const [showMemory, setShowMemory] = useState<number | null>(null);
  const [memoryForm, setMemoryForm] = useState({ key: "", content: "" });

  // Schedules
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "integrations" | "automation" | "team" | "memory" | "meeting">("general");
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
        const [a, at, c, s, wm, wi, mt] = await Promise.all([
          getAgents(ws.id),
          getAgentTeams(ws.id),
          getClients(ws.id),
          getStaff(ws.id),
          getWorkspaceMembers(ws.id),
          getWorkspaceInvites(ws.id).catch(() => [] as WorkspaceInvite[]),
          getMeetings(ws.id).catch(() => [] as Meeting[]),
        ]);
        setAgents(a);
        setAgentTeams(at);
        setClients(c);
        setStaffList(s);
        setWsMembers(wm);
        setWsInvites(wi);
        setMeetings(mt);
        // Preload recent meeting transcripts for chat context
        const completed = mt.filter((m: Meeting) => m.status === "completed").slice(0, 3);
        for (const m of completed) {
          getMeetingTranscript(m.id).then((tr) => {
            if (tr) setRecentTranscripts((prev) => ({ ...prev, [m.id]: tr.full_text.slice(0, 3000) }));
          }).catch(() => {});
        }
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
    setAgentFormPermissions(["web-research", "file-access", "run-commands"]);
    setAgentFormDenied([]);
    setAgentFormSkills([]);
    setAgentFormChannels("");
    setAgentFormReduceHallucinations(false);
    setAgentFormMaxTurns("");
    setAgentFormMaxBudget("");
    setAgentFormEffort("");
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
    setAgentFormPermissions(sdkToolsToPermissionGroups(tpl.tools, enabledIntegrations.includes("gws")));
    setAgentFormDenied([]);
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
    setAgentFormPermissions(sdkToolsToPermissionGroups(agent.tools, enabledIntegrations.includes("gws")));
    setAgentFormDenied([]);
    setAgentFormSkills([]);
    setAgentFormChannels((agent.channels || []).join(", "));
    const adv = agentAdvSettings[agent.id] || {};
    setAgentFormReduceHallucinations(adv.reduceHallucinations || false);
    setAgentFormMaxTurns(adv.maxTurns != null ? String(adv.maxTurns) : "");
    setAgentFormMaxBudget(adv.maxBudgetUsd != null ? String(adv.maxBudgetUsd) : "");
    setAgentFormEffort(adv.effort || "");
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
    setAgentFormPermissions(sdkToolsToPermissionGroups(merged.tools, enabledIntegrations.includes("gws")));
    setAgentFormDenied([]);
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
      const resolvedTools = permissionGroupsToSdkTools(agentFormPermissions);
      const resolvedDenied = permissionGroupsToDisallowed(agentFormDenied);
      const gwsRestrictions = buildGwsRestrictions(agentFormDenied, lang);
      const finalInstructions = agentFormInstructions + gwsRestrictions;
      const data = {
        name: agentFormName,
        role: agentFormRole,
        instructions: finalInstructions,
        tools: resolvedTools,
        not_allowed: resolvedDenied,
        channels,
      };
      let savedId: number;
      if (editingAgentId) {
        await updateAgent(editingAgentId, data);
        savedId = editingAgentId;
      } else {
        const created = await createAgent(workspaceId, data);
        savedId = created?.id || 0;
      }
      // Save advanced settings locally
      if (savedId) {
        const adv: AgentAdvSettings = {};
        if (agentFormReduceHallucinations) adv.reduceHallucinations = true;
        if (agentFormMaxTurns && parseInt(agentFormMaxTurns) > 0) adv.maxTurns = parseInt(agentFormMaxTurns);
        if (agentFormMaxBudget && parseFloat(agentFormMaxBudget) > 0) adv.maxBudgetUsd = parseFloat(agentFormMaxBudget);
        if (agentFormEffort) adv.effort = agentFormEffort;
        setAgentAdvSettings((prev) => ({ ...prev, [savedId]: adv }));
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
      const parsed = JSON.parse(raw);
      return {
        session_id: parsed.session_id || "",
        result: parsed.result || raw,
      };
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

=== Google Workspace 도구 안내 ===
gws CLI가 활성화되어 있습니다. Bash 도구를 통해 아래 명령어를 사용할 수 있습니다.

[Gmail]
- gws gmail messages list --maxResults=10  # 받은편지함 목록
- gws gmail messages get <messageId>  # 메일 읽기
- gws gmail messages send --to="email@example.com" --subject="제목" --body="본문"  # 메일 발송
- gws gmail drafts create --to="email@example.com" --subject="제목" --body="본문"  # 임시저장

[Calendar]
- gws calendar events list  # 오늘 일정
- gws calendar events list --timeMin="2024-01-01T00:00:00Z" --timeMax="2024-01-31T23:59:59Z"  # 기간 일정
- gws calendar events create --summary="회의" --start="2024-01-15T14:00:00" --end="2024-01-15T15:00:00" --attendees="a@b.com,c@d.com"  # 일정 생성
- gws calendar events update <eventId> --summary="변경된 제목"  # 일정 수정
- gws calendar events delete <eventId>  # 일정 삭제

[Drive — 파일 관리]
- gws drive files list --params='{"pageSize":10}'  # 내 드라이브 파일 목록
- gws drive files list --params='{"q":"name contains \\'보고서\\'","pageSize":10}'  # 파일 검색
- gws drive files list --params='{"driveId":"ID","corpora":"drive","includeItemsFromAllDrives":true,"supportsAllDrives":true}'  # 공유 드라이브 파일
- gws drive files get --params='{"fileId":"FILE_ID","fields":"*"}'  # 파일 상세 정보
- gws drive files download --params='{"fileId":"FILE_ID"}' -o ./downloaded.pdf  # 파일 다운로드
- gws drive files export --params='{"fileId":"FILE_ID","mimeType":"application/pdf"}' -o ./export.pdf  # Google Docs/Sheets → PDF 내보내기
- gws drive files export --params='{"fileId":"FILE_ID","mimeType":"text/plain"}' -o ./export.txt  # Google Docs → 텍스트 내보내기
- gws drive +upload ./report.pdf --parent=<folderId> --name="보고서.pdf"  # 파일 업로드 (헬퍼)
- gws drive files copy --params='{"fileId":"FILE_ID"}' --json='{"name":"복사본","parents":["FOLDER_ID"]}'  # 파일 복사
- gws drive files update --params='{"fileId":"FILE_ID"}' --json='{"name":"새이름.pdf"}'  # 파일 이름 변경
- gws drive files update --params='{"fileId":"FILE_ID","addParents":"FOLDER_ID","removeParents":"OLD_FOLDER_ID"}'  # 파일 이동
- gws drive files delete --params='{"fileId":"FILE_ID"}'  # 파일 영구 삭제

[Drive — 공유/권한]
- gws drive permissions list --params='{"fileId":"FILE_ID","fields":"*"}'  # 권한 목록
- gws drive permissions create --params='{"fileId":"FILE_ID"}' --json='{"role":"writer","type":"user","emailAddress":"email@example.com"}'  # 사용자에게 편집 권한
- gws drive permissions create --params='{"fileId":"FILE_ID"}' --json='{"role":"reader","type":"user","emailAddress":"email@example.com"}'  # 사용자에게 읽기 권한
- gws drive permissions create --params='{"fileId":"FILE_ID"}' --json='{"role":"reader","type":"anyone"}'  # 링크 공유 (누구나 보기)
- gws drive permissions create --params='{"fileId":"FILE_ID"}' --json='{"role":"writer","type":"anyone"}'  # 링크 공유 (누구나 편집)
- gws drive permissions delete --params='{"fileId":"FILE_ID","permissionId":"PERM_ID"}'  # 권한 삭제
- gws drive permissions update --params='{"fileId":"FILE_ID","permissionId":"PERM_ID"}' --json='{"role":"reader"}'  # 권한 변경

[Drive — 공유 드라이브]
- gws drive drives list  # 공유 드라이브 목록
- gws drive drives get --params='{"driveId":"DRIVE_ID"}'  # 공유 드라이브 정보
- gws drive drives create --params='{"requestId":"unique-id"}' --json='{"name":"새 공유 드라이브"}'  # 공유 드라이브 생성

[Drive — 댓글]
- gws drive comments list --params='{"fileId":"FILE_ID","fields":"*"}'  # 파일 댓글 목록
- gws drive comments create --params='{"fileId":"FILE_ID"}' --json='{"content":"댓글 내용"}'  # 댓글 작성
- gws drive replies create --params='{"fileId":"FILE_ID","commentId":"COMMENT_ID"}' --json='{"content":"답글 내용"}'  # 답글 작성

[Drive — 변경 이력]
- gws drive changes list --params='{"pageToken":"TOKEN"}'  # 최근 변경 이력
- gws drive changes getStartPageToken  # 변경 추적 시작 토큰
- gws drive revisions list --params='{"fileId":"FILE_ID"}'  # 파일 버전 이력

[Docs — 문서]
- gws docs documents get --params='{"documentId":"DOC_ID"}'  # 문서 읽기
- gws docs documents create --json='{"title":"문서 제목"}'  # 문서 생성
- gws docs +write <documentId> --body="추가할 텍스트"  # 문서에 텍스트 추가 (헬퍼)
- gws docs documents batchUpdate --params='{"documentId":"DOC_ID"}' --json='{"requests":[{"insertText":{"location":{"index":1},"text":"삽입할 내용"}}]}'  # 문서 수정
- gws docs documents batchUpdate --params='{"documentId":"DOC_ID"}' --json='{"requests":[{"replaceAllText":{"containsText":{"text":"찾을텍스트","matchCase":true},"replaceText":"바꿀텍스트"}}]}'  # 텍스트 치환

주의사항:
- gws 명령어의 파라미터는 --params(URL 파라미터)와 --json(요청 본문)으로 구분
- 파일 다운로드/내보내기 시 -o 옵션으로 저장 경로 지정
- 공유 드라이브 파일 접근 시 supportsAllDrives=true 필수
- 이메일 발송 시 수신자를 반드시 확인하세요
- 중요 작업(삭제, 권한 변경) 전 사용자에게 확인을 구하세요${driveFolders.length > 0 ? `

[등록된 Drive 폴더]
${driveFolders.map((f) => `- "${f.label}": folderId=${f.folderId}${f.driveId ? `, driveId=${f.driveId} (공유 드라이브)` : " (내 드라이브)"}`).join("\n")}
파일을 저장할 때 사용자가 위 이름을 언급하면 해당 folderId의 --parents 옵션을 사용하세요.
공유 드라이브 폴더는 --supportsAllDrives 플래그를 추가하세요.` : ""}` : "";

    const adv = agentAdvSettings[agent.id] || {};
    const hallucinationGuard = adv.reduceHallucinations ? `

=== 거짓말 방지 — 반드시 지킬 것 ===

당신은 절대로 사실이 아닌 정보를 만들어내면 안 됩니다. 아래 규칙을 하나라도 어기면 심각한 문제가 됩니다.

**핵심 원칙: 모르면 모른다고 해라**
- 확실하지 않으면 "정확한 정보를 찾지 못했습니다" 또는 "확인이 필요합니다"라고 말하세요.
- 절대로 그럴듯하게 꾸며내지 마세요. 틀린 답변보다 "모르겠습니다"가 100배 낫습니다.

**출처 표기 규칙 (반드시 따를 것)**
1. 웹에서 찾은 정보는 반드시 출처 URL을 함께 적으세요
2. 수치, 통계, 날짜 등 팩트를 언급할 때는 어디서 확인했는지 밝히세요
3. 출처를 찾을 수 없는 정보는 아예 쓰지 마세요

출처 표기 예시:
> 2024년 매출은 약 500억원입니다. ([출처](https://example.com/ir/2024))
> 직원 수는 약 1,200명입니다. ([출처](https://example.com/about))

**신뢰도 표시 (숫자/통계 등 핵심 팩트에 표시)**
- 공식 자료에서 직접 확인한 경우: [확인됨]
- 간접 정보나 추론인 경우: [추정]
- 확인할 수 없는 경우: [미확인]

예시:
> - 2024년 매출: 523억원 [확인됨] ([출처](https://example.com/ir))
> - 시장 점유율: 약 15~20% [추정] (정확한 공식 데이터 없음)
> - 해외 진출 계획: 2025년 하반기 [미확인]

**추가 규칙**
- 검색 결과나 제공된 문서에 없는 정보를 배경지식으로 채우지 마세요
- "약", "대략", "~정도" 대신 가능하면 정확한 수치를 쓰세요. 정확한 수치를 모르면 범위로 표현하세요
- 여러 출처가 상충하면 그 사실을 명시하세요` : "";

    const savePathSection = defaultSavePath ? `

=== 파일 저장 경로 ===
파일을 생성하거나 저장할 때는 반드시 아래 경로에 저장하세요:
${defaultSavePath}

절대로 다른 경로에 파일을 저장하지 마세요. Write 도구를 사용할 때 이 경로를 기본 디렉토리로 사용하세요.
예: ${defaultSavePath}/보고서.md, ${defaultSavePath}/분석결과.csv 등` : "";

    // Inject relevant knowledge memories (max 10 most recent)
    const categoryLabel: Record<string, string> = { client: "고객", project: "프로젝트", person: "인물", decision: "결정", fact: "사실" };
    const relevantMemories = memoryEnabled && knowledgeMemory.length > 0
      ? knowledgeMemory.slice(-10).map((m) => `- [${categoryLabel[m.category] || m.category}] ${m.subject}: ${m.content}`).join("\n")
      : "";
    const memorySection = relevantMemories ? `

=== 기억된 정보 (이전 대화에서 학습) ===
아래는 이전 대화에서 추출한 중요 정보입니다. 관련 있을 때 참고하세요.
${relevantMemories}` : "";

    const staffInfo = staffList.length > 0
      ? `\n\n=== 회사 구성원 연락처 ===\n${staffList.map((s) => `- ${s.name}${s.role ? ` (${s.role})` : ""}${s.email ? ` — 이메일: ${s.email}` : ""}${s.phone ? ` — 전화: ${s.phone}` : ""}${s.notes ? ` — 메모: ${s.notes}` : ""}`).join("\n")}\n\n이메일이나 연락처가 필요하면 위 목록을 참고하세요. 절대로 사용자에게 다시 물어보지 마세요.`
      : "";

    // Inject recent meeting transcripts for chat context
    const recentMeetings = meetings
      .filter((m) => m.status === "completed")
      .slice(0, 3);
    const meetingEntries = recentMeetings.map((m) => {
      const text = recentTranscripts[m.id];
      return text
        ? `[${m.title}] (${new Date(m.meeting_date).toLocaleDateString()})\n${text}`
        : `[${m.title}] (${new Date(m.meeting_date).toLocaleDateString()})`;
    });
    const meetingSection = meetingEntries.length > 0
      ? `\n\n=== 최근 회의록 ===\n사용자가 회의, 회의록, 미팅, 요약 등을 언급하면 아래 내용을 참고하세요.\n\n` + meetingEntries.join("\n\n---\n\n")
      : "";

    return `${agent.instructions}

=== 팀 컨텍스트 ===
사용자(당신의 상사): ${authUser?.name || "사용자"}${authUser?.email ? ` (${authUser.email})` : ""}
메일, 문서 등 외부 커뮤니케이션은 반드시 사용자의 이름(${authUser?.name || "사용자"})으로 작성하세요. 절대로 당신(AI 에이전트)의 이름으로 보내지 마세요.

당신의 이름: ${agent.name}
당신의 역할: ${agent.role}
같은 팀 동료:
${teammateInfo}${staffInfo}
${gwsSection}${hallucinationGuard}${savePathSection}${memorySection}${meetingSection}

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
    const adv = agentAdvSettings[agent.id] || {};
    const sdkExtra = {
      maxTurns: adv.maxTurns || null,
      maxBudgetUsd: adv.maxBudgetUsd || null,
      effort: adv.effort || null,
    };

    const runNew = async () =>
      invoke<string>("run_agent", {
        prompt: p.trim(),
        instructions,
        allowedTools,
        disallowedTools,
        sessionId: null,
        enableCheckpointing: true,
        cwd: null,
        ...sdkExtra,
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
            enableCheckpointing: true,
            cwd: null,
            ...sdkExtra,
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

  // Unified chat: parse @agentName from prompt, route to agent, store locally
  const handleChatSend = async () => {
    const p = prompt.trim();
    if (!p) return;
    // If agent is already running
    if (chatRunningAgent) {
      // Check if user is @mentioning a DIFFERENT agent — cancel current and let it fall through
      const mentionCheck = p.match(/^@(\S+)\s*/);
      const mentionedName = mentionCheck?.[1];
      const isDifferentAgent = mentionedName && mentionedName.toLowerCase() !== chatRunningAgent.toLowerCase();

      if (isDifferentAgent) {
        // Cancel current agent, then fall through to normal send
        try { await invoke("cancel_agent"); } catch {}
        await new Promise((r) => setTimeout(r, 300));
      } else {
        // Same agent or no mention — interject
        setPrompt("");
        const msg = p;
        if (!activeConvoId) return;
        const agentName = streamRunningAgentRef.current || chatRunningAgent;
        const userTs = Date.now();
        const newPlaceholderTs = userTs + 1;
        streamTargetTsRef.current = newPlaceholderTs;
        updateConvo(activeConvoId, (c) => ({
          ...c,
          messages: [
            ...c.messages,
            { role: "user" as const, text: msg, ts: userTs },
            { role: "agent" as const, agentName, text: "", ts: newPlaceholderTs },
          ],
        }));
        try { await invoke("interject_agent", { text: msg }); } catch (e) { console.warn("Interject failed:", e); }
        return;
      }
    }
    setPrompt("");
    setShowMentionPicker(false);

    // Ensure we have an active conversation
    let convoId = activeConvoId;
    if (!convoId) {
      convoId = createConvo();
    }

    // Parse @agentName or @teamName at the start of the message
    const mentionMatch = p.match(/^@(\S+)\s*([\s\S]*)/);
    let targetAgent: Agent | undefined;
    let targetTeam: AgentTeam | undefined;
    let userMessage: string;

    if (mentionMatch) {
      const name = mentionMatch[1];
      userMessage = mentionMatch[2] || "";
      targetAgent = activeAgents.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (!targetAgent) {
        // Try matching team name
        targetTeam = agentTeams.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (!targetTeam) {
          updateConvo(convoId, (c) => ({
            ...c,
            messages: [...c.messages, { role: "user", text: p }, { role: "system", text: `"${name}" ${lang === "ko" ? "을(를) 찾을 수 없습니다." : "not found."}` }],
          }));
          return;
        }
      }
    } else if (activeAgents.length === 1) {
      targetAgent = activeAgents[0];
      userMessage = p;
    } else {
      // Fall back to last used agent in this conversation
      const convo = conversations.find((c) => c.id === convoId);
      if (convo?.lastAgentId) {
        targetAgent = activeAgents.find((a) => a.id === convo.lastAgentId);
      }
      if (!targetAgent) {
        updateConvo(convoId, (c) => ({
          ...c,
          messages: [...c.messages, { role: "user", text: p }, { role: "system", text: lang === "ko" ? `@팀원이름 또는 @팀이름으로 시작해주세요` : "Start with @agentName or @teamName" }],
        }));
        return;
      }
      userMessage = p;
    }

    // If team was mentioned, run team execution within the chat
    if (targetTeam && !targetAgent) {
      const teamMsg = userMessage || p;
      const userMsg: ChatMsg = { role: "user", text: p, files: chatFiles.map((f) => f.name), ts: Date.now() };
      updateConvo(convoId, (c) => ({
        ...c,
        title: c.messages.length === 0 ? teamMsg.slice(0, 30) : c.title,
        messages: [...c.messages, userMsg],
      }));
      setChatRunningAgent(`${targetTeam.name}`);
      setChatFiles([]);

      try {
        const plan = await runAgentTeam(targetTeam.id, teamMsg);
        const lead = plan.agents.find((a) => a.is_lead) || plan.agents[0];
        const workers = plan.agents.filter((a) => a.agent_id !== lead.agent_id);

        const subagents: Record<string, { description: string; prompt: string; tools: string[] }> = {};
        for (const w of workers) {
          subagents[w.name] = {
            description: w.instructions.slice(0, 200),
            prompt: w.instructions || `You are ${w.name}.`,
            tools: w.tools || [],
          };
        }

        const teamPromptText = workers.length > 0
          ? `팀 명령: ${teamMsg}\n\n필요한 팀원에게 작업을 위임하고 결과를 종합해주세요.`
          : teamMsg;
        const leadInstructions = `${lead.instructions}\n\n=== 팀 컨텍스트 ===\n당신의 이름: ${lead.name}\n같은 팀 동료:\n${workers.map((w) => `- ${w.name}: ${w.instructions.slice(0, 80)}...`).join("\n") || "없음"}\n\nSDK 서브에이전트로 팀원이 등록되어 있습니다. 필요에 따라 자동으로 위임됩니다.`;

        const allowedTools = lead.tools.join(",");
        const disallowedTools = lead.not_allowed.length > 0 ? lead.not_allowed.join(",") : null;
        const convoSess = activeConvo?.sessions || {};
        const existSess = convoSess[lead.agent_id];
        const leadAdv2 = agentAdvSettings[lead.agent_id] || {};
        const teamExtra = { maxTurns: leadAdv2.maxTurns || null, maxBudgetUsd: leadAdv2.maxBudgetUsd || null, effort: leadAdv2.effort || null };

        let raw: string;
        if (existSess) {
          try {
            raw = await invoke<string>("resume_agent", { prompt: teamPromptText, instructions: leadInstructions, allowedTools, disallowedTools, sessionId: existSess, agents: JSON.stringify(subagents), enableCheckpointing: true, cwd: null, ...teamExtra });
          } catch {
            updateConvo(convoId, (c) => { const s = { ...c.sessions }; delete s[lead.agent_id]; return { ...c, sessions: s }; });
            raw = await invoke<string>("run_agent", { prompt: teamPromptText, instructions: leadInstructions, allowedTools, disallowedTools, sessionId: null, agents: JSON.stringify(subagents), enableCheckpointing: true, cwd: null, ...teamExtra });
          }
        } else {
          raw = await invoke<string>("run_agent", { prompt: teamPromptText, instructions: leadInstructions, allowedTools, disallowedTools, sessionId: null, agents: JSON.stringify(subagents), enableCheckpointing: true, cwd: null, ...teamExtra });
        }

        const { session_id, result } = parseAgentResponse(raw);
        updateConvo(convoId, (c) => ({
          ...c,
          lastAgentId: lead.agent_id,
          sessions: session_id ? { ...c.sessions, [lead.agent_id]: session_id } : c.sessions,
          messages: [...c.messages, { role: "agent", agentName: `${targetTeam.name}`, text: result, ts: Date.now() }],
        }));
        // Background memory extraction
        const tConvoTitle = activeConvo?.title || "대화";
        extractMemories(teamMsg, result, targetTeam.name, tConvoTitle);
      } catch (e) {
        updateConvo(convoId, (c) => ({
          ...c,
          messages: [...c.messages, { role: "agent", agentName: `${targetTeam.name}`, text: `${e}`, ts: Date.now(), error: true }],
        }));
      } finally {
        setChatRunningAgent(null);
      }
      return;
    }

    // At this point targetAgent is guaranteed to be defined
    if (!targetAgent) return;

    // Build file context if files are attached
    const fileCtx = chatFiles.length > 0
      ? `\n\n[첨부 파일 — Read 도구로 즉시 읽을 수 있음]\n${chatFiles.map((f) => `- ${f.name}: ${f.path}`).join("\n")}\n\nRead 도구를 사용하여 위 파일을 읽고 작업해주세요. 권한은 이미 허용되어 있습니다.`
      : "";
    const fullMessage = userMessage + fileCtx;

    // Add user message with file info
    const userMsg: ChatMsg = { role: "user", text: p, files: chatFiles.map((f) => f.name), ts: Date.now() };
    updateConvo(convoId, (c) => ({
      ...c,
      title: c.messages.length === 0 ? (userMessage.slice(0, 30) || p.slice(0, 30)) : c.title,
      messages: [...c.messages, userMsg],
    }));
    setChatRunningAgent(targetAgent.name);
    setChatFiles([]);

    const convoSessions = activeConvo?.sessions || {};
    const existingSession = convoSessions[targetAgent.id];
    const instructions = buildInstructions(targetAgent);
    const allowedTools = targetAgent.tools.join(",");
    const disallowedTools = targetAgent.not_allowed.length > 0 ? targetAgent.not_allowed.join(",") : null;
    const chatAdv = agentAdvSettings[targetAgent.id] || {};
    const chatSdkExtra = {
      maxTurns: chatAdv.maxTurns || null,
      maxBudgetUsd: chatAdv.maxBudgetUsd || null,
      effort: chatAdv.effort || null,
    };

    // Add placeholder agent message for streaming (ensure unique ts)
    const streamMsgTs = Date.now() + 1;
    streamTargetTsRef.current = streamMsgTs;
    streamRunningAgentRef.current = targetAgent.name;
    updateConvo(convoId, (c) => ({
      ...c,
      messages: [...c.messages, { role: "agent" as const, agentName: targetAgent.name, text: "", ts: streamMsgTs }],
    }));

    // Listen for streaming deltas — uses ref so interject can redirect to new placeholder
    let streamedText = "";
    let currentTargetTs = streamMsgTs;
    const unlisten = await listen<string>("agent-stream-delta", (event) => {
      // Check if interject created a new target
      if (streamTargetTsRef.current !== currentTargetTs) {
        currentTargetTs = streamTargetTsRef.current;
        streamedText = ""; // reset for new message
      }
      streamedText += event.payload;
      const tsToUpdate = currentTargetTs;
      updateConvo(convoId, (c) => {
        const msgs = [...c.messages];
        const idx = msgs.findIndex((m) => m.role === "agent" && m.ts === tsToUpdate);
        if (idx >= 0) {
          msgs[idx] = { ...msgs[idx], text: streamedText };
        }
        return { ...c, messages: msgs };
      });
    });

    try {
      let raw: string;
      if (existingSession) {
        try {
          raw = await invoke<string>("resume_agent_stream", {
            prompt: fullMessage,
            instructions,
            allowedTools,
            disallowedTools,
            sessionId: existingSession,
            enableCheckpointing: true,
            cwd: null,
            ...chatSdkExtra,
          });
        } catch {
          updateConvo(convoId, (c) => {
            const s = { ...c.sessions };
            delete s[targetAgent.id];
            return { ...c, sessions: s };
          });
          streamedText = "";
          raw = await invoke<string>("run_agent_stream", {
            prompt: fullMessage,
            instructions,
            allowedTools,
            disallowedTools,
            sessionId: null,
            enableCheckpointing: true,
            cwd: null,
            ...chatSdkExtra,
          });
        }
      } else {
        raw = await invoke<string>("run_agent_stream", {
          prompt: fullMessage,
          instructions,
          allowedTools,
          disallowedTools,
          sessionId: null,
          enableCheckpointing: true,
          cwd: null,
          ...chatSdkExtra,
        });
      }

      unlisten();
      const { session_id, result } = parseAgentResponse(raw);
      const finalTs = streamTargetTsRef.current;
      // Update the current streaming target message with final result
      updateConvo(convoId, (c) => {
        const msgs = [...c.messages];
        const idx = msgs.findIndex((m) => m.role === "agent" && m.ts === finalTs);
        if (idx >= 0) {
          msgs[idx] = { ...msgs[idx], text: result };
        }
        return {
          ...c,
          lastAgentId: targetAgent.id,
          sessions: session_id ? { ...c.sessions, [targetAgent.id]: session_id } : c.sessions,
          messages: msgs,
        };
      });
      // Background memory extraction (no await — fire and forget)
      const convoTitle = activeConvo?.title || "대화";
      extractMemories(userMessage, result, targetAgent.name, convoTitle);
    } catch (e) {
      unlisten();
      const errStr = `${e}`;
      const isCancelled = errStr.includes("cancelled");
      const errorTs = streamTargetTsRef.current;
      updateConvo(convoId, (c) => {
        const msgs = [...c.messages];
        const idx = msgs.findIndex((m) => m.role === "agent" && m.ts === errorTs);
        if (idx >= 0) {
          if (isCancelled && streamedText) {
            msgs[idx] = { ...msgs[idx], text: streamedText };
          } else if (isCancelled) {
            msgs.splice(idx, 1);
          } else {
            msgs[idx] = { ...msgs[idx], text: errStr, error: true };
          }
        }
        return { ...c, lastAgentId: targetAgent.id, messages: msgs };
      });
    } finally {
      setChatRunningAgent(null);
      streamTargetTsRef.current = 0;
      streamRunningAgentRef.current = null;
    }
  };

  const handleChatNewConvo = () => {
    createConvo();
  };

  const handleDeleteConvo = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvoId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      setActiveConvoId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // File upload handler
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        // Chunk-based base64 encoding to avoid stack overflow on large files
        const chunks: string[] = [];
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
        }
        const base64 = btoa(chunks.join(""));
        const savedPath = await invoke<string>("save_chat_file", {
          fileName: file.name,
          fileDataBase64: base64,
        });
        setChatFiles((prev) => [...prev, { name: file.name, path: savedPath }]);
      } catch (e) {
        console.error("File upload failed:", e);
      }
    }
  };

  // @mention input handling
  const handleChatInputChange = (value: string) => {
    setPrompt(value);
    // Check if user is typing @
    const lastAt = value.lastIndexOf("@");
    if (lastAt >= 0 && (lastAt === 0 || value[lastAt - 1] === " ")) {
      const after = value.slice(lastAt + 1);
      if (!after.includes(" ")) {
        setShowMentionPicker(true);
        setMentionFilter(after.toLowerCase());
        setMentionIndex(0);
        return;
      }
    }
    setShowMentionPicker(false);
  };

  const insertMention = (agentName: string) => {
    const lastAt = prompt.lastIndexOf("@");
    const before = prompt.slice(0, lastAt);
    setPrompt(`${before}@${agentName} `);
    setShowMentionPicker(false);
    chatInputRef.current?.focus();
  };

  const filteredMentionAgents = activeAgents.filter((a) =>
    a.name.toLowerCase().includes(mentionFilter)
  );
  const filteredMentionTeams = agentTeams.filter((t) =>
    t.name.toLowerCase().includes(mentionFilter)
  );

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

      // Find lead agent; fallback to first agent
      const lead = plan.agents.find((a) => a.is_lead) || plan.agents[0];
      const workers = plan.agents.filter((a) => a.agent_id !== lead.agent_id);

      // Build SDK subagents map from workers
      const subagents: Record<string, { description: string; prompt: string; tools: string[] }> = {};
      for (const w of workers) {
        subagents[w.name] = {
          description: `${w.instructions.slice(0, 200)}`,
          prompt: w.instructions || `You are ${w.name}.`,
          tools: w.tools || [],
        };
      }

      const teamPrompt = workers.length > 0
        ? `팀 명령: ${p}\n\n필요한 팀원에게 작업을 위임하고 결과를 종합해주세요.`
        : p;

      const leadInstructions = `${lead.instructions}\n\n=== 팀 컨텍스트 ===\n당신의 이름: ${lead.name}\n같은 팀 동료:\n${workers.map((w) => `- ${w.name}: ${w.instructions.slice(0, 80)}...`).join("\n") || "없음"}\n\nSDK 서브에이전트로 팀원이 등록되어 있습니다. 필요에 따라 자동으로 위임됩니다.`;

      const allowedTools = lead.tools.join(",");
      const disallowedTools = lead.not_allowed.length > 0 ? lead.not_allowed.join(",") : null;
      const existingSession = agentSessions[lead.agent_id];
      const leadAdv = agentAdvSettings[lead.agent_id] || {};
      const teamSdkExtra = {
        maxTurns: leadAdv.maxTurns || null,
        maxBudgetUsd: leadAdv.maxBudgetUsd || null,
        effort: leadAdv.effort || null,
      };

      let raw: string;
      if (existingSession) {
        try {
          raw = await invoke<string>("resume_agent", {
            prompt: teamPrompt,
            instructions: leadInstructions,
            allowedTools,
            disallowedTools,
            sessionId: existingSession,
            agents: JSON.stringify(subagents),
            enableCheckpointing: true,
            cwd: null,
            ...teamSdkExtra,
          });
        } catch {
          setAgentSessions((prev) => { const n = { ...prev }; delete n[lead.agent_id]; return n; });
          raw = await invoke<string>("run_agent", {
            prompt: teamPrompt,
            instructions: leadInstructions,
            allowedTools,
            disallowedTools,
            sessionId: null,
            agents: JSON.stringify(subagents),
            enableCheckpointing: true,
            cwd: null,
            ...teamSdkExtra,
          });
        }
      } else {
        raw = await invoke<string>("run_agent", {
          prompt: teamPrompt,
          instructions: leadInstructions,
          allowedTools,
          disallowedTools,
          sessionId: null,
          agents: JSON.stringify(subagents),
          enableCheckpointing: true,
          cwd: null,
          ...teamSdkExtra,
        });
      }

      const { session_id, result } = parseAgentResponse(raw);
      if (session_id) {
        setAgentSessions((prev) => ({ ...prev, [lead.agent_id]: session_id }));
      }
      setTeamChats((prev) => ({
        ...prev,
        [atId]: [...(prev[atId] || []), { role: "agent", agentName: lead.name, text: result }],
      }));
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
        enableCheckpointing: false,
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
          requires_approval: teamFormApprovals[id] || false,
        })),
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
            enableCheckpointing: false,
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
                onClick={async () => {
                  if (isLast) {
                    localStorage.setItem("flaude_setup_done", "true");
                    // Default agents/team are auto-created on initial load when agents.length === 0
                    await refresh();
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
        {/* Recording status bar */}
        {isRecording && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-mono text-red-600">
                {String(Math.floor(recordingElapsed / 60)).padStart(2, "0")}:{String(recordingElapsed % 60).padStart(2, "0")}
              </span>
            </div>
            <div className="text-[10px] text-red-400 mt-0.5">Cmd+Shift+R {t("meeting.recordStop")}</div>
          </div>
        )}
        <nav className="flex-1 p-2">
          {(["chat", "agents", "teams", "clients", ...(meetingEnabled ? ["meetings" as Page] : [])] as Page[]).map((page) => (
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
              {page === "chat" && t("nav.chat")}
              {page === "agents" && t("nav.members")}
              {page === "teams" && t("nav.teams")}
              {page === "clients" && t("nav.clients")}
              {page === "meetings" && t("nav.meetings")}
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

        {/* ═══ CHAT ═══ */}
        {currentPage === "chat" && (
          <div className="flex-1 flex flex-col h-full bg-[#FAFAF8]"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFileUpload(e.dataTransfer.files); }}
          >
            {(() => {
              // Auto-create conversation if none
              if (!activeConvo && conversations.length === 0) {
                setTimeout(() => createConvo(), 0);
              } else if (!activeConvo && conversations.length > 0) {
                setTimeout(() => setActiveConvoId(conversations[0].id), 0);
              }
              return null;
            })()}

            {/* Top bar — minimal */}
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
              <div className="flex items-center gap-2 min-w-0">
                {/* History dropdown */}
                {conversations.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setConvoSearch(convoSearch === "__open__" ? "" : "__open__")}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-[#9CA3AF] hover:text-[#374151] transition"
                      title={lang === "ko" ? "이전 대화" : "History"}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </button>
                    {convoSearch === "__open__" && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setConvoSearch("")} />
                        <div className="absolute left-0 top-full mt-1 w-72 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden animate-[fadeIn_0.1s_ease]">
                          {conversations.length > 5 && (
                            <div className="px-3 pt-2.5">
                              <input
                                autoFocus
                                type="text"
                                placeholder={lang === "ko" ? "검색..." : "Search..."}
                                onChange={(e) => { if (e.target.value) setConvoSearch(e.target.value); else setConvoSearch("__open__"); }}
                                className="w-full px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg focus:outline-none focus:border-[#D97706]/40"
                              />
                            </div>
                          )}
                          <div className="max-h-72 overflow-auto p-1.5">
                            {conversations.filter((c) => {
                              const q = convoSearch !== "__open__" ? convoSearch : "";
                              if (!q) return true;
                              return c.title.toLowerCase().includes((q as string).toLowerCase());
                            }).map((convo) => (
                              <button
                                key={convo.id}
                                onClick={() => { setActiveConvoId(convo.id); setChatFiles([]); setConvoSearch(""); }}
                                className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between group transition ${
                                  activeConvoId === convo.id ? "bg-[#D97706]/5" : "hover:bg-gray-50"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-[#374151] truncate">{convo.title}</div>
                                  <div className="text-[10px] text-[#B0B0A8]">
                                    {new Date(convo.createdAt).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" })}
                                    {convo.messages.length > 0 && ` · ${convo.messages.length}`}
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteConvo(convo.id); }}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-[#B0B0A8] hover:text-[#EF4444] transition"
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {/* Current chat title */}
                <span className="text-sm text-[#374151] truncate font-medium">
                  {activeConvo?.title || (lang === "ko" ? "새 대화" : "New chat")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {/* Quick agent chips */}
                <div className="hidden sm:flex items-center gap-0.5 mr-2">
                  {activeAgents.slice(0, 4).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => { setPrompt((prev) => prev ? prev : `@${a.name} `); chatInputRef.current?.focus(); }}
                      className="w-6 h-6 rounded-full hover:ring-2 hover:ring-[#D97706]/30 transition"
                      title={`@${a.name} · ${a.role}`}
                    >
                      <img src={avatarUrl(a.name)} alt={a.name} className="w-6 h-6 rounded-full" />
                    </button>
                  ))}
                </div>
                {/* New chat button */}
                <button
                  onClick={handleChatNewConvo}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-[#9CA3AF] hover:text-[#D97706] transition"
                  title={lang === "ko" ? "새 대화 (⌘N)" : "New chat (⌘N)"}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
              </div>
            </div>

            {activeConvo && (
              <>
                {/* Messages */}
                <div className="flex-1 overflow-auto px-6 py-4">
                  <div className="max-w-2xl mx-auto space-y-4">
                    {chatMessages.length === 0 && !chatRunningAgent && (
                      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
                        <div className="text-center">
                          <div className="flex justify-center gap-2 mb-4">
                            {activeAgents.slice(0, 4).map((a) => (
                              <img key={a.id} src={avatarUrl(a.name)} alt="" className="w-10 h-10 rounded-full border-2 border-white shadow-sm -ml-2 first:ml-0" />
                            ))}
                            {agentTeams.slice(0, 2).map((t) => (
                              <div key={`t-${t.id}`} className="w-10 h-10 rounded-full border-2 border-white shadow-sm -ml-2 bg-gradient-to-br from-[#D97706] to-[#B45309] flex items-center justify-center">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                              </div>
                            ))}
                          </div>
                          <p className="text-sm text-[#9CA3AF] mb-1">
                            {lang === "ko" ? "@이름으로 팀원이나 팀에게 말을 걸어보세요" : "Mention a member or team with @name"}
                          </p>
                          <div className="flex flex-wrap gap-2 justify-center mt-3">
                            {activeAgents.slice(0, 3).map((a) => (
                              <button
                                key={a.id}
                                onClick={() => { setPrompt(`@${a.name} `); chatInputRef.current?.focus(); }}
                                className="px-2.5 py-1 text-xs rounded-full border border-gray-200 text-[#6B7280] hover:border-[#D97706] hover:text-[#D97706] transition"
                              >
                                @{a.name}
                              </button>
                            ))}
                            {agentTeams.slice(0, 2).map((t) => (
                              <button
                                key={`t-${t.id}`}
                                onClick={() => { setPrompt(`@${t.name} `); chatInputRef.current?.focus(); }}
                                className="px-2.5 py-1 text-xs rounded-full border border-[#D97706]/20 text-[#D97706] hover:bg-[#D97706]/5 transition"
                              >
                                @{t.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                      {chatMessages.map((msg, i) => (
                        <div key={i} className={`group/msg flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2.5 animate-[fadeIn_0.2s_ease]`}>
                          {msg.role === "agent" && msg.agentName && (
                            <img src={avatarUrl(msg.agentName)} alt="" className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5 shadow-sm" />
                          )}
                          {msg.role === "system" && (
                            <div className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5 bg-gray-100 flex items-center justify-center">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            </div>
                          )}
                          <div className={msg.role === "user" ? "max-w-[75%]" : "max-w-[80%]"}>
                            {msg.role === "agent" && msg.agentName && (
                              <div className="text-[11px] text-[#9CA3AF] mb-1 ml-0.5 font-medium">{msg.agentName}</div>
                            )}
                            <div className={`px-4 py-2.5 text-sm leading-relaxed ${
                              msg.role === "user"
                                ? "bg-[#1A1A1A] text-white rounded-2xl rounded-br-md whitespace-pre-wrap"
                                : msg.role === "system"
                                ? "bg-amber-50 text-amber-700 rounded-2xl rounded-bl-md text-xs whitespace-pre-wrap"
                                : msg.error
                                ? "bg-white text-[#1A1A1A] rounded-2xl rounded-bl-md shadow-sm border border-red-200"
                                : "bg-white text-[#1A1A1A] rounded-2xl rounded-bl-md shadow-sm border border-gray-100"
                            }`}>
                              {msg.role === "agent" && msg.text === "" && chatRunningAgent ? (
                                <div className="flex gap-1 py-0.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce" style={{ animationDelay: "0ms" }} />
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce" style={{ animationDelay: "150ms" }} />
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce" style={{ animationDelay: "300ms" }} />
                                </div>
                              ) : msg.role === "agent" ? <MarkdownMessage text={msg.text} /> : msg.text}
                            </div>
                            {/* Action buttons: copy, retry */}
                            {msg.role === "agent" && msg.text !== "" && (
                              <div className="flex items-center gap-1 mt-1 ml-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                                <button onClick={() => copyMessage(msg.text, i)} className="p-1 rounded hover:bg-gray-100" title="Copy">
                                  {copiedMsgIdx === i ? (
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                                  ) : (
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                  )}
                                </button>
                                {msg.error && (
                                  <button onClick={() => {
                                    // Find last user message before this error and resend
                                    const convo = conversations.find((c) => c.id === activeConvoId);
                                    if (!convo) return;
                                    const lastUser = [...convo.messages].slice(0, convo.messages.indexOf(msg)).reverse().find((m) => m.role === "user");
                                    if (lastUser) {
                                      // Remove error message and re-send
                                      updateConvo(convo.id, (c) => ({ ...c, messages: c.messages.filter((_, mi) => mi !== convo.messages.indexOf(msg)) }));
                                      setPrompt(lastUser.text);
                                      setTimeout(() => handleChatSend(), 50);
                                    }
                                  }} className="p-1 rounded hover:bg-gray-100" title="Retry">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                                  </button>
                                )}
                              </div>
                            )}
                            {/* Timestamp on hover */}
                            {msg.ts && !chatRunningAgent && (
                              <div className="text-[10px] text-[#D1D5DB] mt-0.5 ml-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                                {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </div>
                            )}
                            {msg.files && msg.files.length > 0 && (
                              <div className="flex gap-1 mt-1.5 flex-wrap">
                                {msg.files.map((f, fi) => (
                                  <span key={fi} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-[10px] text-[#6B7280]">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {/* Show dots only when running AND no streaming placeholder in message list */}
                      {chatRunningAgent && !(chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === "agent") && (
                        <div className="flex justify-start gap-2.5 animate-[fadeIn_0.2s_ease]">
                          <img src={avatarUrl(chatRunningAgent)} alt="" className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5 shadow-sm" />
                          <div>
                            <div className="text-[11px] text-[#9CA3AF] mb-1 ml-0.5 font-medium">{chatRunningAgent}</div>
                            <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-white shadow-sm border border-gray-100">
                              <div className="flex gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce" style={{ animationDelay: "300ms" }} />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                  </div>

                  {/* File chips */}
                  {chatFiles.length > 0 && (
                    <div className="px-6 pb-0">
                      <div className="max-w-2xl mx-auto flex gap-1.5 flex-wrap">
                        {chatFiles.map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-white border border-gray-200 text-xs text-[#374151] shadow-sm">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            {f.name}
                            <button onClick={() => setChatFiles((prev) => prev.filter((_, j) => j !== i))} className="p-0.5 hover:bg-gray-100 rounded">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Input area */}
                  <div className="px-6 py-4">
                    <div className="max-w-2xl mx-auto relative">
                      {/* @mention autocomplete */}
                      {showMentionPicker && (filteredMentionAgents.length > 0 || filteredMentionTeams.length > 0) && (
                        <div className="absolute bottom-full mb-1 left-0 w-64 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 animate-[fadeIn_0.1s_ease] max-h-72 overflow-y-auto">
                          {filteredMentionAgents.map((agent, idx) => (
                            <button
                              key={`a-${agent.id}`}
                              onClick={() => insertMention(agent.name)}
                              onMouseEnter={() => setMentionIndex(idx)}
                              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition ${
                                idx === mentionIndex ? "bg-[#D97706]/5" : "hover:bg-[#FAF9F6]"
                              }`}
                            >
                              <img src={avatarUrl(agent.name)} alt="" className="w-7 h-7 rounded-full" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-[#374151]">{agent.name}</div>
                                <div className="text-[10px] text-[#9CA3AF] truncate">{agent.role}</div>
                              </div>
                              {idx === mentionIndex && (
                                <span className="text-[9px] text-[#B0B0A8] flex-shrink-0">Enter</span>
                              )}
                            </button>
                          ))}
                          {filteredMentionTeams.length > 0 && filteredMentionAgents.length > 0 && (
                            <div className="px-3 py-1 text-[9px] text-[#B0B0A8] uppercase tracking-wider border-t border-gray-100 mt-0.5 pt-1.5">
                              {lang === "ko" ? "팀" : "Teams"}
                            </div>
                          )}
                          {filteredMentionTeams.map((team, idx) => {
                            const globalIdx = filteredMentionAgents.length + idx;
                            const memberCount = team.members.length;
                            return (
                              <button
                                key={`t-${team.id}`}
                                onClick={() => insertMention(team.name)}
                                onMouseEnter={() => setMentionIndex(globalIdx)}
                                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition ${
                                  globalIdx === mentionIndex ? "bg-[#D97706]/5" : "hover:bg-[#FAF9F6]"
                                }`}
                              >
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#D97706] to-[#B45309] flex items-center justify-center flex-shrink-0">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-[#374151]">{team.name}</div>
                                  <div className="text-[10px] text-[#9CA3AF] truncate">{lang === "ko" ? `팀 · ${memberCount}명` : `Team · ${memberCount} members`}</div>
                                </div>
                                {globalIdx === mentionIndex && (
                                  <span className="text-[9px] text-[#B0B0A8] flex-shrink-0">Enter</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <form onSubmit={(e) => { e.preventDefault(); handleChatSend(); }} className="flex items-end gap-2">
                        <div className="flex-1 flex items-end bg-white rounded-xl border border-gray-200 shadow-sm focus-within:border-[#D97706] focus-within:shadow-[0_0_0_1px_rgba(217,119,6,0.1)] transition">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-3 py-2.5 text-[#9CA3AF] hover:text-[#D97706] transition flex-shrink-0"
                            title={lang === "ko" ? "파일 첨부" : "Attach file"}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                            </svg>
                          </button>
                          <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => handleFileUpload(e.target.files)} />
                          <textarea
                            ref={chatInputRef}
                            value={prompt}
                            onChange={(e) => {
                              handleChatInputChange(e.target.value);
                              // Auto-resize
                              e.target.style.height = "auto";
                              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                            }}
                            onKeyDown={(e) => {
                              if (showMentionPicker) {
                                const allMentionItems = [...filteredMentionAgents.map((a) => a.name), ...filteredMentionTeams.map((t) => t.name)];
                                if (e.key === "Escape") { setShowMentionPicker(false); e.preventDefault(); return; }
                                if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, allMentionItems.length - 1)); return; }
                                if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
                                if ((e.key === "Enter" || e.key === "Tab") && allMentionItems.length > 0) {
                                  e.preventDefault();
                                  insertMention(allMentionItems[mentionIndex] || allMentionItems[0]);
                                  return;
                                }
                              }
                              // Enter to send (Shift+Enter for newline)
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleChatSend();
                                // Reset height
                                (e.target as HTMLTextAreaElement).style.height = "auto";
                              }
                            }}
                            placeholder={(() => {
                              const lastAgent = activeConvo?.lastAgentId ? activeAgents.find((a) => a.id === activeConvo.lastAgentId) : null;
                              if (lastAgent) return lang === "ko" ? `${lastAgent.name}에게 메시지...` : `Message ${lastAgent.name}...`;
                              return lang === "ko" ? `@${activeAgents[0]?.name || "팀원"} 또는 @${agentTeams[0]?.name || "팀"} 메시지 입력...` : `@${activeAgents[0]?.name || "agent"} or @${agentTeams[0]?.name || "team"} type a message...`;
                            })()}
                            rows={1}
                            className="flex-1 px-1 py-2.5 text-sm bg-transparent focus:outline-none placeholder:text-[#C4C4C0] resize-none overflow-hidden"
                            style={{ maxHeight: 160 }}
                          />
                          {chatRunningAgent ? (
                            <button
                              type="button"
                              onClick={async () => { try { await invoke("cancel_agent"); } catch {} }}
                              className="px-3 py-2.5 text-red-400 hover:text-red-600 transition flex-shrink-0"
                              title={lang === "ko" ? "중지" : "Stop"}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="4" y="4" width="16" height="16" rx="2" />
                              </svg>
                            </button>
                          ) : (
                            <button
                              type="submit"
                              disabled={!prompt.trim()}
                              className={`px-3 py-2.5 transition flex-shrink-0 ${
                                prompt.trim()
                                  ? "text-[#D97706] hover:text-[#B45309]"
                                  : "text-[#D1D5DB]"
                              }`}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </form>
                    </div>
                  </div>
                </>
              )}
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

                    <PermissionSelector
                      label={lang === "ko" ? "이 팀원에게 허용할 권한" : "Permissions for this member"}
                      hint={lang === "ko" ? "체크하면 해당 기능을 사용할 수 있습니다. 잘 모르시면 기본값 그대로 두세요." : "Check to allow. Leave defaults if unsure."}
                      selected={agentFormPermissions}
                      onChange={setAgentFormPermissions}
                      lang={lang}
                      hasGws={enabledIntegrations.includes("gws")}
                    />

                    {/* Advanced SDK settings — collapsible */}
                    <details className="rounded-xl border border-gray-200 group/adv overflow-hidden">
                      <summary className="px-4 py-3 cursor-pointer select-none flex items-center justify-between bg-white hover:bg-gray-50/80 transition list-none [&::-webkit-details-marker]:hidden">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-md bg-gray-100 group-open/adv:bg-[#D97706]/10 flex items-center justify-center transition">
                            <svg className="w-3.5 h-3.5 text-[#9CA3AF] group-open/adv:text-[#D97706] transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-[#374151]">
                              {lang === "ko" ? "고급 설정" : "Advanced Settings"}
                            </span>
                            {/* Active settings summary */}
                            {(() => {
                              const tags: string[] = [];
                              if (agentFormReduceHallucinations) tags.push(lang === "ko" ? "거짓말 방지" : "Anti-false");
                              if (agentFormEffort) tags.push(agentFormEffort === "low" ? (lang === "ko" ? "빠름" : "Quick") : agentFormEffort === "high" ? (lang === "ko" ? "깊이" : "Deep") : (lang === "ko" ? "보통" : "Balanced"));
                              if (agentFormMaxTurns) tags.push(`${agentFormMaxTurns} turns`);
                              if (agentFormMaxBudget) tags.push(`$${agentFormMaxBudget}`);
                              return tags.length > 0 ? (
                                <span className="text-[10px] text-[#D97706] ml-1.5">{tags.join(" · ")}</span>
                              ) : (
                                <span className="text-[10px] text-[#B0B0A8] ml-1.5 group-open/adv:hidden">{lang === "ko" ? "옵션 없음" : "None"}</span>
                              );
                            })()}
                          </div>
                        </div>
                        <svg className="w-3.5 h-3.5 text-[#B0B0A8] transition-transform group-open/adv:rotate-180 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                      </summary>

                      <div className="bg-[#FAFAF8] border-t border-gray-100">
                        {/* Anti-hallucination toggle */}
                        <button
                          type="button"
                          onClick={() => setAgentFormReduceHallucinations(!agentFormReduceHallucinations)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition border-b border-gray-100 ${
                            agentFormReduceHallucinations ? "bg-[#D97706]/[0.03]" : "hover:bg-white/60"
                          }`}
                        >
                          <div className={`flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition ${
                            agentFormReduceHallucinations
                              ? "bg-[#D97706] border-[#D97706]"
                              : "border-gray-300 bg-white"
                          }`}>
                            {agentFormReduceHallucinations && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-[#374151]">
                              {lang === "ko" ? "거짓말 방지" : "Prevent False Info"}
                            </div>
                            <div className="text-[10px] text-[#9CA3AF] leading-snug">
                              {lang === "ko"
                                ? "모르면 모른다고 답변 · 출처 필수 · 추측 금지"
                                : "Say \"I don't know\" · Cite sources · No guessing"}
                            </div>
                          </div>
                        </button>

                        {/* Effort level */}
                        <div className="px-4 py-3 border-b border-gray-100">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-[#374151]">
                              {lang === "ko" ? "작업 강도" : "Effort Level"}
                            </span>
                            {agentFormEffort && (
                              <button type="button" onClick={() => setAgentFormEffort("")} className="text-[10px] text-[#9CA3AF] hover:text-[#374151]">
                                {lang === "ko" ? "초기화" : "Reset"}
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {([
                              { value: "", label: lang === "ko" ? "자동" : "Auto", desc: lang === "ko" ? "기본" : "Default" },
                              { value: "low", label: lang === "ko" ? "빠름" : "Quick", desc: lang === "ko" ? "간단한 답변" : "Simple" },
                              { value: "medium", label: lang === "ko" ? "보통" : "Medium", desc: lang === "ko" ? "균형" : "Balanced" },
                              { value: "high", label: lang === "ko" ? "깊이" : "Deep", desc: lang === "ko" ? "철저한 분석" : "Thorough" },
                            ] as const).map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setAgentFormEffort(opt.value as any)}
                                className={`px-1 py-2 rounded-lg text-center transition ${
                                  agentFormEffort === opt.value
                                    ? "bg-[#D97706] text-white shadow-sm"
                                    : "bg-white text-[#6B7280] border border-gray-200 hover:border-[#D97706]/30"
                                }`}
                              >
                                <div className="text-[11px] font-medium">{opt.label}</div>
                                <div className={`text-[9px] mt-0.5 ${agentFormEffort === opt.value ? "text-white/70" : "text-[#B0B0A8]"}`}>{opt.desc}</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Limits */}
                        <div className="px-4 py-3">
                          <span className="text-xs font-medium text-[#374151] block mb-2">
                            {lang === "ko" ? "사용 제한" : "Usage Limits"}
                          </span>
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-1.5 mb-1">
                                <svg className="w-3 h-3 text-[#9CA3AF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                                <label className="text-[10px] text-[#6B7280]">{lang === "ko" ? "최대 턴" : "Max Turns"}</label>
                              </div>
                              <div className="relative">
                                <input
                                  type="number"
                                  placeholder="-"
                                  value={agentFormMaxTurns}
                                  onChange={(e) => setAgentFormMaxTurns(e.target.value)}
                                  min="1"
                                  max="100"
                                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-[#D97706] text-center"
                                />
                                {agentFormMaxTurns && (
                                  <button type="button" onClick={() => setAgentFormMaxTurns("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#B0B0A8] hover:text-[#374151]">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-1.5 mb-1">
                                <svg className="w-3 h-3 text-[#9CA3AF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                                <label className="text-[10px] text-[#6B7280]">{lang === "ko" ? "비용 한도" : "Budget Cap"}</label>
                              </div>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#B0B0A8]">$</span>
                                <input
                                  type="number"
                                  placeholder="-"
                                  value={agentFormMaxBudget}
                                  onChange={(e) => setAgentFormMaxBudget(e.target.value)}
                                  min="0.01"
                                  step="0.01"
                                  className="w-full pl-5 pr-2 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-[#D97706] text-center"
                                />
                                {agentFormMaxBudget && (
                                  <button type="button" onClick={() => setAgentFormMaxBudget("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#B0B0A8] hover:text-[#374151]">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                          <p className="text-[9px] text-[#B0B0A8] mt-1.5 text-center">
                            {lang === "ko" ? "비어있으면 제한 없음" : "Leave empty for unlimited"}
                          </p>
                        </div>
                      </div>
                    </details>

                    {enabledIntegrations.includes("discord") && (
                      <div className="p-3 rounded-lg border border-gray-200 bg-gray-50/50">
                        <label className="text-xs font-medium text-[#374151] block mb-0.5">
                          {lang === "ko" ? "Discord 자동응답" : "Discord Auto-reply"}
                        </label>
                        <p className="text-[10px] text-[#6B7280] mb-2 leading-relaxed">
                          {lang === "ko"
                            ? "지정한 채널에 누군가 글을 쓰면, @태그 없이도 이 팀원이 자동으로 응답합니다."
                            : "This member will automatically reply to any message in the specified channels, without needing an @mention."}
                        </p>
                        <input
                          type="text"
                          placeholder={lang === "ko" ? "채널 ID (쉼표로 구분)" : "Channel IDs (comma-separated)"}
                          value={agentFormChannels}
                          onChange={(e) => setAgentFormChannels(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#D97706] font-mono text-xs"
                        />
                        <details className="mt-1.5">
                          <summary className="text-[10px] text-[#9CA3AF] cursor-pointer hover:text-[#6B7280]">
                            {lang === "ko" ? "채널 ID는 어디서 찾나요?" : "Where to find channel ID?"}
                          </summary>
                          <p className="text-[10px] text-[#9CA3AF] mt-1 pl-2 border-l-2 border-gray-200 leading-relaxed">
                            {lang === "ko"
                              ? "Discord 설정 → 고급 → 개발자 모드 켜기 → 채널 우클릭 → \"채널 ID 복사\""
                              : "Discord Settings → Advanced → Developer Mode ON → Right-click channel → Copy Channel ID"}
                          </p>
                        </details>
                      </div>
                    )}

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
                        {sdkToolsToPermissionGroups(agent.tools, enabledIntegrations.includes("gws")).map((gid) => {
                          const g = PERMISSION_GROUPS.find((p) => p.id === gid);
                          return g ? (
                            <span key={gid} className="px-1.5 py-0.5 text-[10px] bg-[#F5F0E8] text-[#8B7355] rounded">
                              {g[lang]}
                            </span>
                          ) : null;
                        })}
                        {agent.channels && agent.channels.length > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-500 rounded flex items-center gap-0.5">
                            <svg width="10" height="8" viewBox="0 0 71 55" className="flex-shrink-0"><path d="M60.1 4.9A58.5 58.5 0 0 0 45.4.2a.2.2 0 0 0-.2.1 40.8 40.8 0 0 0-1.8 3.7 53.9 53.9 0 0 0-16.2 0A37.3 37.3 0 0 0 25.4.3a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.6 4.9C1.5 18.7-.9 32.2.3 45.5a58.7 58.7 0 0 0 17.7 9 42 42 0 0 0 3.6-5.9 38.6 38.6 0 0 1-5.5-2.6c.4-.3.7-.6 1.1-.9a.2.2 0 0 1 .2 0c11.6 5.3 24.1 5.3 35.5 0a.2.2 0 0 1 .2 0l1.1.9c-1.8 1-3.6 1.9-5.5 2.6a47.2 47.2 0 0 0 3.6 5.9A58.5 58.5 0 0 0 70.7 45.6c1.4-15-2.3-28.4-9.8-40.1z" fill="currentColor"/></svg>
                            {lang === "ko" ? "자동응답" : "Auto-reply"} {agent.channels.length}{lang === "ko" ? "채널" : "ch"}
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
                              <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                                msg.role === "user"
                                  ? "bg-[#D97706] text-white rounded-br-sm whitespace-pre-wrap"
                                  : "bg-gray-50 text-[#1A1A1A] border border-gray-200 rounded-bl-sm"
                              }`}>
                                {msg.role === "agent" ? <MarkdownMessage text={msg.text} /> : msg.text}
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
                            {/* Approval gate — for selected non-lead members */}
                            {isSelected && !isLead && (
                              <div className="mt-1 ml-4" onClick={(e) => e.stopPropagation()}>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <div className={`relative w-8 h-[18px] rounded-full transition-colors ${
                                    teamFormApprovals[agent.id] ? "bg-[#D97706]" : "bg-gray-200"
                                  }`}
                                    onClick={() => setTeamFormApprovals({ ...teamFormApprovals, [agent.id]: !teamFormApprovals[agent.id] })}
                                  >
                                    <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
                                      teamFormApprovals[agent.id] ? "left-[16px]" : "left-[2px]"
                                    }`} />
                                  </div>
                                  <span className="text-[11px] font-medium text-[#374151]">
                                    {lang === "ko" ? "승인 필요" : "Requires approval"}
                                  </span>
                                </label>
                              </div>
                            )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

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
                                      {"→"}
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
                                <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                                  msg.role === "user"
                                    ? "bg-[#D97706] text-white rounded-br-sm whitespace-pre-wrap"
                                    : "bg-gray-50 text-[#1A1A1A] border border-gray-200 rounded-bl-sm"
                                }`}>
                                  {msg.role === "agent" && msg.agentName && (
                                    <div className="text-[10px] text-[#D97706] mb-1 font-medium">{msg.agentName}</div>
                                  )}
                                  {msg.role === "agent" ? <MarkdownMessage text={msg.text} /> : msg.text}
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
                          <select value={client.status} onChange={(e) => handleUpdateClientStatus(client.id, e.target.value)} className="text-xs px-2 py-1">
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
                                <select value={client.assigned_agent} onChange={(e) => handleAssignAgent(client.id, e.target.value)} className="text-xs px-2.5 py-1.5 w-full">
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

        {/* ═══ MEETINGS ═══ */}
        {currentPage === "meetings" && (() => {
          // Helper: auto-transcribe a meeting
          // Fire-and-forget transcription — runs in background, doesn't block UI
          const autoTranscribe = (meetingId: number, audioPath: string) => {
            updateMeeting(meetingId, { status: "transcribing" });
            setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, status: "transcribing" } : x));

            // Run transcription without awaiting — user can record another meeting
            (async () => {
              try {
                const result = await invoke<string>("transcribe_audio", {
                  path: audioPath, model: activeWhisperModel, language: meetingLanguage,
                });
                const parsed = JSON.parse(result);
                const rawSegs = parsed.transcription || parsed.segments || [];
                const segments = rawSegs.map((s: any) => ({
                  start: s.offsets ? s.offsets.from / 1000 : (s.start || 0),
                  end: s.offsets ? s.offsets.to / 1000 : (s.end || 0),
                  text: (s.text || "").trim(),
                }));
                const fullText = segments.map((s: any) => s.text).join(" ");
                await saveMeetingTranscript(meetingId, { full_text: fullText, segments, language: meetingLanguage });
                const autoTitle = fullText.slice(0, 40).replace(/\s+/g, " ").trim() || `${lang === "ko" ? "회의" : "Meeting"} ${new Date().toLocaleDateString()}`;
                await updateMeeting(meetingId, { status: "completed", title: autoTitle } as any);
                setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, status: "completed", title: autoTitle } : x));
                // Update transcript view if this meeting is currently selected
                setSelectedMeetingId((cur) => { if (cur === meetingId) setMeetingTranscript({ id: 0, full_text: fullText, segments, language: meetingLanguage }); return cur; });
                setRecentTranscripts((prev) => ({ ...prev, [meetingId]: fullText.slice(0, 3000) }));
              } catch (e) {
                await updateMeeting(meetingId, { status: "failed", error_message: String(e) });
                setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, status: "failed" } : x));
              }
            })();
          };

          // Helper: send meeting to chat
          const sendToChat = (agent: Agent, meetingTitle: string, processingType: string, prompt: string) => {
            const convoId = createConvo();
            const label = { summary: "요약", action_items: "액션 아이템", follow_up_email: "팔로업 메일", proposal: "제안서" }[processingType] || processingType;
            const userMsg: ChatMsg = { role: "user", text: `[${meetingTitle}] ${label} 요청`, ts: Date.now() };
            updateConvo(convoId, (c) => ({ ...c, title: `${meetingTitle} - ${label}`, messages: [userMsg], lastAgentId: agent.id }));
            setSelectedAgent(agent);
            setCurrentPage("chat");
            // Trigger agent run via prompt
            setTimeout(() => setPrompt(prompt), 100);
          };

          return (
          <div className="flex h-full">
            {/* Meeting list */}
            <div className="w-72 border-r border-gray-200 bg-white flex flex-col">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-bold mb-3">{t("meeting.title")}</h2>
                {/* Big record button */}
                {isRecording ? (
                  <button
                    onClick={async () => {
                      try {
                        const res = await invoke<string>("stop_recording");
                        const data = JSON.parse(res);
                        setIsRecording(false);
                        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
                        setRecordingElapsed(0);
                        if (workspaceId) {
                          const now = new Date();
                          const m = await createMeeting(workspaceId, {
                            title: `${lang === "ko" ? "녹음 중..." : "Processing..."}`,
                            meeting_date: now.toISOString(),
                            duration_seconds: data.duration_seconds,
                            audio_filename: data.path,
                            audio_source: meetingAudioSource === "system" ? "system" : "mic",
                            status: "uploaded",
                          });
                          setMeetings((prev) => [m, ...prev]);
                          setSelectedMeetingId(m.id);
                          autoTranscribe(m.id, data.path);
                        }
                      } catch (e) {
                        alert(`${lang === "ko" ? "녹음 중지 실패" : "Stop failed"}: ${e}`);
                      }
                    }}
                    className="w-full py-3 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 flex items-center justify-center gap-2 mb-2"
                  >
                    <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
                    {t("meeting.recordStop")} ({String(Math.floor(recordingElapsed / 60)).padStart(2, "0")}:{String(recordingElapsed % 60).padStart(2, "0")})
                  </button>
                ) : (
                  <>
                    <button
                      onClick={async () => {
                        try {
                          const path = `/tmp/flaude_recordings/${Date.now()}.wav`;
                          await invoke<string>("start_recording", { source: meetingAudioSource, path });
                          setIsRecording(true);
                          setRecordingElapsed(0);
                          recordingTimerRef.current = window.setInterval(() => setRecordingElapsed((e) => e + 1), 1000);
                        } catch (e) {
                          alert(`${lang === "ko" ? "녹음 실패" : "Recording failed"}: ${e}\n\n${lang === "ko" ? "시스템 설정 > 개인정보 보호 > 마이크에서 허용해주세요" : "System Settings > Privacy > Microphone > enable"}`);
                        }
                      }}
                      className="w-full py-3 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 border border-red-200 mb-1"
                    >
                      {t("meeting.record")}
                    </button>
                    {/* Quick source toggle */}
                    <div className="flex mb-2 rounded-md overflow-hidden border border-gray-200">
                      {([
                        { v: "mic", ko: "대면 회의", en: "In-person" },
                        { v: "system", ko: "화상 회의", en: "Video call" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.v}
                          onClick={() => { setMeetingAudioSource(opt.v); localStorage.setItem("flaude_meeting_source", opt.v); }}
                          className={`flex-1 py-1 text-[11px] transition ${
                            meetingAudioSource === opt.v
                              ? "bg-gray-800 text-white"
                              : "bg-white text-gray-400 hover:text-gray-600"
                          }`}
                        >
                          {lang === "ko" ? opt.ko : opt.en}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {/* File actions */}
                <div className="flex gap-2">
                  <label className="flex-1 px-3 py-1.5 bg-gray-50 text-gray-500 text-xs rounded hover:bg-gray-100 border border-gray-200 text-center cursor-pointer">
                    {lang === "ko" ? "파일 업로드" : "Upload File"}
                    <input type="file" accept=".mp3,.m4a,.wav,.ogg" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !workspaceId) return;
                      const reader = new FileReader();
                      reader.onload = async () => {
                        const base64 = (reader.result as string).split(",")[1];
                        const path = await invoke<string>("save_chat_file", { fileName: file.name, fileDataBase64: base64 });
                        const m = await createMeeting(workspaceId, {
                          title: file.name.replace(/\.[^.]+$/, ""),
                          meeting_date: new Date().toISOString(),
                          audio_filename: path, audio_source: "upload", status: "uploaded",
                        });
                        setMeetings((prev) => [m, ...prev]);
                        setSelectedMeetingId(m.id);
                      };
                      reader.readAsDataURL(file);
                    }} />
                  </label>
                  <label className="flex-1 px-3 py-1.5 bg-gray-50 text-gray-500 text-xs rounded hover:bg-gray-100 border border-gray-200 text-center cursor-pointer">
                    {lang === "ko" ? "자막/텍스트" : "Subtitle/Text"}
                    <input type="file" accept=".vtt,.srt,.txt" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !workspaceId) return;
                      if (file.name.endsWith(".txt")) {
                        const text = await file.text();
                        const autoTitle = text.slice(0, 40).replace(/\s+/g, " ").trim() || file.name;
                        const m = await createMeeting(workspaceId, { title: autoTitle, meeting_date: new Date().toISOString(), audio_source: "import", status: "completed" });
                        await saveMeetingTranscript(m.id, { full_text: text, segments: [], language: meetingLanguage });
                        setMeetings((prev) => [{ ...m, status: "completed" }, ...prev]);
                        setSelectedMeetingId(m.id);
                      } else {
                        const reader = new FileReader();
                        reader.onload = async () => {
                          const base64 = (reader.result as string).split(",")[1];
                          const path = await invoke<string>("save_chat_file", { fileName: file.name, fileDataBase64: base64 });
                          const parsed = await invoke<string>("parse_subtitle", { path });
                          const data = JSON.parse(parsed);
                          const autoTitle = data.full_text.slice(0, 40).replace(/\s+/g, " ").trim() || file.name;
                          const m = await createMeeting(workspaceId, { title: autoTitle, meeting_date: new Date().toISOString(), audio_source: "import", status: "completed" });
                          await saveMeetingTranscript(m.id, { full_text: data.full_text, segments: data.segments, language: meetingLanguage });
                          setMeetings((prev) => [{ ...m, status: "completed" }, ...prev]);
                          setSelectedMeetingId(m.id);
                        };
                        reader.readAsDataURL(file);
                      }
                    }} />
                  </label>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {meetings.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-sm text-gray-400">{lang === "ko" ? "녹음하거나 파일을 업로드하세요" : "Record or upload a file"}</p>
                  </div>
                ) : (
                  meetings.map((m) => (
                    <button
                      key={m.id}
                      onClick={async () => {
                        setSelectedMeetingId(m.id);
                        setMeetingTranscript(null);
                        setMeetingResults([]);
                        setEditingTranscript(false);
                        try {
                          const [tr, res] = await Promise.all([
                            getMeetingTranscript(m.id).catch(() => null),
                            getMeetingResults(m.id).catch(() => []),
                          ]);
                          setMeetingTranscript(tr);
                          setMeetingResults(res);
                        } catch {}
                      }}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                        selectedMeetingId === m.id ? "bg-[#D97706]/5 border-l-2 border-l-[#D97706]" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">{m.title}</span>
                        <span className="flex-shrink-0 ml-2">
                          {m.status === "completed" && <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />}
                          {m.status === "transcribing" && <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" />}
                          {m.status === "failed" && <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />}
                          {m.status === "recording" && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />}
                          {m.status === "uploaded" && <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {new Date(m.meeting_date).toLocaleDateString()} {new Date(m.meeting_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {m.duration_seconds ? <span className="ml-2">{Math.round(m.duration_seconds / 60)}{t("meeting.minutes")}</span> : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Meeting detail */}
            <div className="flex-1 overflow-y-auto">
              {selectedMeetingId ? (() => {
                const meeting = meetings.find((m) => m.id === selectedMeetingId);
                if (!meeting) return null;
                return (
                  <div className="p-6 max-w-3xl">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-1">
                      <h2 className="text-xl font-bold">{meeting.title}</h2>
                      <button
                        onClick={async () => {
                          if (!confirm(lang === "ko" ? "이 회의를 삭제할까요?" : "Delete this meeting?")) return;
                          await deleteMeeting(meeting.id);
                          setMeetings((prev) => prev.filter((x) => x.id !== meeting.id));
                          setSelectedMeetingId(null);
                        }}
                        className="px-2 py-1 text-xs text-gray-400 hover:text-red-500"
                      >
                        {t("meeting.delete")}
                      </button>
                    </div>
                    <div className="text-xs text-gray-400 mb-4">
                      {new Date(meeting.meeting_date).toLocaleString()}
                      {meeting.duration_seconds ? ` / ${Math.round(meeting.duration_seconds / 60)}${t("meeting.minutes")}` : ""}
                      {meeting.participants.length > 0 ? ` / ${meeting.participants.join(", ")}` : ""}
                    </div>

                    {/* Status banner for non-completed */}
                    {meeting.status === "transcribing" && (
                      <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700 flex items-center gap-2">
                        {lang === "ko" ? "음성을 텍스트로 변환 중입니다..." : "Converting speech to text..."}
                      </div>
                    )}
                    {meeting.status === "uploaded" && (
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                        <p className="mb-2">{lang === "ko" ? "음성 파일이 업로드되었습니다. 전사를 시작하세요." : "Audio uploaded. Start transcription."}</p>
                        <button
                          onClick={() => autoTranscribe(meeting.id, meeting.audio_filename)}
                          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                        >
                          {lang === "ko" ? "전사 시작" : "Start Transcription"}
                        </button>
                      </div>
                    )}
                    {meeting.status === "failed" && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                        {lang === "ko" ? "전사에 실패했습니다." : "Transcription failed."}
                        {meeting.error_message && <pre className="mt-1 text-xs whitespace-pre-wrap">{meeting.error_message}</pre>}
                        <button
                          onClick={() => autoTranscribe(meeting.id, meeting.audio_filename)}
                          className="mt-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                        >
                          {t("meeting.retranscribe")}
                        </button>
                      </div>
                    )}

                    {/* Transcript */}
                    {meetingTranscript && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-semibold text-gray-700">{t("meeting.transcript")}</h3>
                          <div className="flex gap-1">
                            {editingTranscript ? (
                              <>
                                <button onClick={async () => {
                                  await updateMeetingTranscript(meeting.id, { full_text: editTranscriptText });
                                  setMeetingTranscript((prev) => prev ? { ...prev, full_text: editTranscriptText } : prev);
                                  setEditingTranscript(false);
                                }} className="px-2 py-0.5 text-xs bg-[#D97706] text-white rounded">{t("meeting.save")}</button>
                                <button onClick={() => setEditingTranscript(false)} className="px-2 py-0.5 text-xs text-gray-500 border rounded">{t("meeting.cancel")}</button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => { setEditingTranscript(true); setEditTranscriptText(meetingTranscript.full_text); }} className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-600">{t("meeting.edit")}</button>
                                <button onClick={() => navigator.clipboard.writeText(meetingTranscript.full_text)} className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-600">{t("meeting.copy")}</button>
                              </>
                            )}
                          </div>
                        </div>
                        {editingTranscript ? (
                          <textarea value={editTranscriptText} onChange={(e) => setEditTranscriptText(e.target.value)} className="w-full h-64 p-3 border rounded text-sm font-mono" />
                        ) : (
                          <div className="bg-gray-50 rounded-lg p-4 max-h-72 overflow-y-auto text-sm leading-relaxed">
                            {meetingTranscript.segments.length > 0 ? (
                              meetingTranscript.segments.map((seg, i) => (
                                <div key={i} className="mb-1.5">
                                  <span className="text-[10px] text-gray-300 font-mono mr-1.5">
                                    {String(Math.floor(seg.start / 60)).padStart(2, "0")}:{String(Math.floor(seg.start % 60)).padStart(2, "0")}
                                  </span>
                                  <span>{seg.text}</span>
                                </div>
                              ))
                            ) : (
                              <pre className="whitespace-pre-wrap">{meetingTranscript.full_text}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Agent actions — step 1: pick agent, step 2: pick action */}
                    {meetingTranscript && (
                      <div className="mb-6">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">{lang === "ko" ? "회의록 활용하기" : "Use this transcript"}</h3>

                        {/* Step 1: Select agent or team */}
                        <div className="mb-3">
                          <p className="text-xs text-gray-400 mb-2">{lang === "ko" ? "누구에게 맡길까요?" : "Who should handle this?"}</p>
                          <div className="flex flex-wrap gap-2">
                            {agents.filter((a) => a.status === "active").map((a) => (
                              <button
                                key={`agent-${a.id}`}
                                onClick={() => setMeetingProcessAgent(a.id)}
                                className={`px-3 py-2.5 rounded-lg border text-sm flex items-center gap-2.5 transition ${
                                  meetingProcessAgent === a.id
                                    ? "border-[#D97706] bg-[#D97706]/5 shadow-sm"
                                    : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                                }`}
                              >
                                <img src={avatarUrl(a.name)} className="w-7 h-7 rounded-full object-cover" />
                                <div className="text-left">
                                  <div className={`text-sm font-medium ${meetingProcessAgent === a.id ? "text-[#D97706]" : "text-gray-800"}`}>{a.name}</div>
                                  <div className="text-[10px] text-gray-400 leading-tight">{a.role}</div>
                                </div>
                              </button>
                            ))}
                            {agentTeams.map((team) => (
                              <button
                                key={`team-${team.id}`}
                                onClick={() => setMeetingProcessAgent(-team.id)}
                                className={`px-3 py-2.5 rounded-lg border text-sm flex items-center gap-2.5 transition ${
                                  meetingProcessAgent === -team.id
                                    ? "border-[#D97706] bg-[#D97706]/5 shadow-sm"
                                    : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                                }`}
                              >
                                <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-500">{team.members.length}</span>
                                <div className="text-left">
                                  <div className={`text-sm font-medium ${meetingProcessAgent === -team.id ? "text-[#D97706]" : "text-gray-800"}`}>{team.name}</div>
                                  <div className="text-[10px] text-gray-400 leading-tight">{lang === "ko" ? "팀" : "Team"}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Step 2: Select action (only shown after agent selected) */}
                        {meetingProcessAgent && (
                          <div>
                            <p className="text-xs text-gray-400 mb-2">{lang === "ko" ? "무엇을 할까요?" : "What should they do?"}</p>
                            <div className="grid grid-cols-2 gap-2">
                              {([
                                { type: "summary", ko: "요약하기", en: "Summarize" },
                                { type: "action_items", ko: "액션 아이템 추출", en: "Action Items" },
                                { type: "follow_up_email", ko: "팔로업 메일 작성", en: "Follow-up Email" },
                                { type: "proposal", ko: "제안서 초안", en: "Draft Proposal" },
                              ] as const).map((action) => (
                                <button
                                  key={action.type}
                                  disabled={meetingProcessing}
                                  onClick={async () => {
                                    const agentId = meetingProcessAgent > 0 ? meetingProcessAgent : null;
                                    const agent = agentId ? agents.find((a) => a.id === agentId) : agents.find((a) => a.status === "active");
                                    if (!agent) { alert(lang === "ko" ? "에이전트를 찾을 수 없습니다" : "Agent not found"); return; }
                                    setMeetingProcessing(true);
                                    try {
                                      const resp = await processMeeting(meeting.id, { agent_id: agent.id, processing_type: action.type });
                                      sendToChat(agent, meeting.title, action.type, resp.prompt);
                                    } catch (e) {
                                      alert(`${lang === "ko" ? "처리 실패" : "Failed"}: ${e}`);
                                    } finally {
                                      setMeetingProcessing(false);
                                    }
                                  }}
                                  className="p-3 bg-white border border-gray-200 rounded-lg hover:border-[#D97706] hover:bg-[#D97706]/5 text-sm text-left disabled:opacity-50 transition"
                                >
                                  {lang === "ko" ? action.ko : action.en}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Results link to chat */}
                  </div>
                );
              })() : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <p className="text-sm">{lang === "ko" ? "회의를 녹음하거나 선택하세요" : "Record or select a meeting"}</p>
                  <p className="text-xs mt-1 text-gray-300">Cmd+Shift+R</p>
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* ═══ SETTINGS ═══ */}
        {currentPage === "settings" && (
          <div className="p-6">
            {/* Update banner */}
            {updateAvailable && (
              <div className="mb-4 flex items-center justify-between bg-gradient-to-r from-[#D97706]/10 to-[#B45309]/10 border border-[#D97706]/20 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#D97706] flex items-center justify-center flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[#374151]">
                      {lang === "ko" ? `새 버전 ${updateAvailable.version} 사용 가능` : `Version ${updateAvailable.version} available`}
                    </div>
                    {updateAvailable.body && (
                      <div className="text-xs text-[#6B7280] mt-0.5 line-clamp-1">{updateAvailable.body}</div>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleUpdate}
                  disabled={updating}
                  className="px-4 py-1.5 bg-[#D97706] text-white text-xs font-medium rounded-lg hover:bg-[#B45309] disabled:opacity-50 transition flex-shrink-0"
                >
                  {updating ? (lang === "ko" ? "업데이트 중..." : "Updating...") : (lang === "ko" ? "업데이트" : "Update")}
                </button>
              </div>
            )}
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
                { key: "memory" as const, ko: "메모리", en: "Memory" },
                { key: "meeting" as const, ko: "회의", en: "Meeting" },
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

              {/* Drive Folders */}
              {enabledIntegrations.includes("gws") && (
                <div className="p-4 bg-white rounded-lg border border-gray-200">
                  <h3 className="text-sm font-medium mb-1">Drive {lang === "ko" ? "폴더" : "Folders"}</h3>
                  <p className="text-[10px] text-[#9CA3AF] mb-3">
                    {lang === "ko"
                      ? "자주 사용하는 Google Drive 폴더 링크를 등록하면 팀원이 정확한 위치에 파일을 저장합니다."
                      : "Paste Google Drive folder links so agents save files to the right location."}
                  </p>

                  {driveFolders.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {driveFolders.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 rounded border border-gray-100">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={f.driveId ? "#3B82F6" : "#D97706"} strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                          <span className="text-xs font-medium text-[#374151] min-w-0 truncate flex-1">{f.label}</span>
                          {f.driveId && <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{lang === "ko" ? "공유" : "Shared"}</span>}
                          <button
                            onClick={() => setDriveFolders((prev) => prev.filter((_, j) => j !== i))}
                            className="p-0.5 text-[#9CA3AF] hover:text-red-500"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2 p-2.5 bg-gray-50/50 rounded border border-dashed border-gray-200">
                    <div className="flex items-center gap-2">
                      <input id="df-label" type="text" placeholder={lang === "ko" ? "이름 (예: 영업팀 공유)" : "Label"}
                        className="w-1/3 px-2 py-1.5 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:border-[#D97706]" />
                      <input id="df-url" type="text" placeholder={lang === "ko" ? "Google Drive 폴더 링크 붙여넣기" : "Paste Google Drive folder link"}
                        className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:border-[#D97706]" />
                      <button
                        onClick={() => {
                          const label = (document.getElementById("df-label") as HTMLInputElement).value.trim();
                          const url = (document.getElementById("df-url") as HTMLInputElement).value.trim();
                          if (!label || !url) return;

                          // Extract folder ID from various Google Drive URL formats
                          // drive.google.com/drive/folders/FOLDER_ID
                          // drive.google.com/drive/u/0/folders/FOLDER_ID
                          const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
                          // Shared drive: drive.google.com/drive/u/0/team-drives/DRIVE_ID or /drive/DRIVE_ID
                          const driveMatch = url.match(/\/(?:team-drives|drive\/drives)\/([a-zA-Z0-9_-]+)/);

                          const folderId = folderMatch?.[1] || url; // fallback: treat whole input as ID
                          const driveId = driveMatch?.[1];

                          setDriveFolders((prev) => [...prev, { label, folderId, driveId: driveId || undefined }]);
                          (document.getElementById("df-label") as HTMLInputElement).value = "";
                          (document.getElementById("df-url") as HTMLInputElement).value = "";
                        }}
                        className="px-3 py-1.5 text-[11px] font-medium text-white bg-[#D97706] rounded hover:bg-[#B45309]"
                      >
                        {lang === "ko" ? "추가" : "Add"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Default File Save Path */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-1">{lang === "ko" ? "파일 저장 경로" : "File Save Path"}</h3>
                <p className="text-[10px] text-[#9CA3AF] mb-2">
                  {lang === "ko"
                    ? "팀원이 보고서, 문서 등 파일을 만들 때 이 경로에 저장합니다. 비어있으면 아무 곳에나 저장될 수 있습니다."
                    : "Agents will save reports and files to this path. If empty, files may be saved anywhere."}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={defaultSavePath}
                    onChange={(e) => setDefaultSavePath(e.target.value)}
                    placeholder={lang === "ko" ? "예: ~/Documents/Flaude" : "e.g. ~/Documents/Flaude"}
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-gray-200 rounded bg-gray-50 focus:outline-none focus:border-[#D97706]"
                  />
                  {defaultSavePath && (
                    <button
                      onClick={() => setDefaultSavePath("")}
                      className="p-1.5 text-[#9CA3AF] hover:text-red-500"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </div>
                {!defaultSavePath && (
                  <div className="flex gap-1.5 mt-2">
                    {[
                      { label: "~/Documents/Flaude", path: "~/Documents/Flaude" },
                      { label: "~/Desktop/Flaude", path: "~/Desktop/Flaude" },
                    ].map((p) => (
                      <button
                        key={p.path}
                        onClick={() => setDefaultSavePath(p.path)}
                        className="px-2 py-1 text-[10px] text-[#6B7280] border border-gray-200 rounded hover:border-[#D97706] hover:text-[#D97706] transition"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Data Storage Path */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-1">{lang === "ko" ? "대화 저장 위치" : "Chat Storage Location"}</h3>
                <p className="text-[10px] text-[#9CA3AF] mb-2">
                  {lang === "ko" ? "대화 내용, 세션 등이 이 폴더에 저장됩니다." : "Conversations and sessions are stored in this folder."}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={dataDir}
                    onChange={(e) => setDataDir(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-gray-200 rounded bg-gray-50 focus:outline-none focus:border-[#D97706]"
                  />
                  <button
                    onClick={async () => {
                      try {
                        await invoke("set_data_path", { path: dataDir });
                        const newDir = await invoke<string>("get_data_path");
                        setDataDir(newDir);
                      } catch (e) { console.error(e); }
                    }}
                    className="px-3 py-1.5 text-[11px] font-medium text-[#D97706] border border-[#D97706]/20 rounded hover:bg-[#D97706]/5"
                  >
                    {lang === "ko" ? "변경" : "Change"}
                  </button>
                </div>
              </div>

              {/* Server Status */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-2">{t("settings.server")}</h3>
                <div className="flex justify-between text-xs">
                  <span className="text-[#6B7280]">flaude.team</span>
                  <span className={error ? "text-red-500" : "text-[#059669]"}>
                    {error ? t("settings.disconnected") : t("settings.connected")}
                  </span>
                </div>
              </div>

              {/* Discord Link Token */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-2">Discord 연결</h3>
                <p className="text-xs text-[#6B7280] mb-2">
                  Discord에서 <code className="bg-gray-100 px-1 rounded">/link</code> 명령어에 아래 토큰을 입력하면 연결됩니다.
                </p>
                {getAuthToken() ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-gray-100 px-2 py-1.5 rounded font-mono text-[#374151] select-all overflow-hidden text-ellipsis">
                      {getAuthToken()}
                    </code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(getAuthToken()!); }}
                      className="px-2 py-1.5 text-xs bg-[#D97706] text-white rounded hover:bg-[#B45309] transition shrink-0"
                    >
                      복사
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-red-500">로그인 후 사용 가능</span>
                )}
                <div className="flex justify-between text-xs mt-2">
                  <span className="text-[#6B7280]">WebSocket</span>
                  <span className={wsConnected ? "text-[#059669]" : wsError ? "text-red-500" : "text-[#6B7280]"}>
                    {wsConnected ? "연결됨" : wsError ? `실패: ${wsError}` : "대기 중"}
                  </span>
                </div>
                {!wsConnected && (
                  <button
                    onClick={() => connectWebSocket()}
                    className="mt-2 px-3 py-1 text-xs bg-[#D97706] text-white rounded hover:bg-[#B45309] transition"
                  >
                    재연결
                  </button>
                )}
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

                            return (
                              <div key={integ.id} className="px-4 py-3 hover:bg-gray-50/50 transition">
                                <div className="flex items-center gap-3">
                                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    enabled ? "bg-[#D97706]/5" : "bg-gray-50"
                                  }`}>
                                    <IntegrationLogo id={integ.id} size={22} />
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[13px] font-medium text-[#1A1A1A]">{integ.name}</span>
                                      {integ.id === "slack" && (
                                        <span className="px-1.5 py-0.5 text-[9px] font-medium bg-violet-100 text-violet-600 rounded-full">Beta</span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-[#9CA3AF] mt-0.5">{integ.description}</p>
                                  </div>

                                  <button
                                    onClick={() =>
                                      setEnabledIntegrations(
                                        enabled
                                          ? enabledIntegrations.filter((i) => i !== integ.id)
                                          : [...enabledIntegrations, integ.id]
                                      )
                                    }
                                    className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                                      enabled ? "bg-[#D97706]" : "bg-gray-200"
                                    }`}
                                  >
                                    <span className={`absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
                                      enabled ? "left-[19px]" : "left-[3px]"
                                    }`} />
                                  </button>
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
                        <input type="text" placeholder={lang === "ko" ? "예: 매일 아침 리서치" : "e.g. Daily research"} value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} className="w-full px-3 py-1.5 text-sm" />
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
                          className="w-full px-3 py-1.5 text-sm"
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
                        }} className="w-full px-3 py-1.5 text-sm">
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
                      <textarea value={scheduleForm.prompt} onChange={(e) => setScheduleForm({ ...scheduleForm, prompt: e.target.value })} placeholder={lang === "ko" ? "예: 오늘의 주요 뉴스를 조사해서 보고해줘" : "e.g. Research today's key news and report"} className="w-full px-3 py-1.5 text-sm" rows={2} />
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
                            className="text-[10px] px-1.5 py-0.5"
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
                      className="px-2 py-1.5 text-xs"
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

              {/* ── Memory Tab ── */}
              {settingsTab === "memory" && (<>
              {/* Toggle + Info */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-[#1A1A1A]">{lang === "ko" ? "지식 메모리" : "Knowledge Memory"}</h3>
                    <p className="text-xs text-[#6B7280] mt-0.5">{lang === "ko" ? "대화에서 중요한 정보를 자동 추출하여 저장합니다" : "Auto-extracts important info from conversations"}</p>
                  </div>
                  <button
                    onClick={() => setMemoryEnabled(!memoryEnabled)}
                    className={`relative w-10 h-5 rounded-full transition ${memoryEnabled ? "bg-[#1A1A1A]" : "bg-gray-300"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition ${memoryEnabled ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
                {memoryEnabled && (
                  <div className="text-xs text-[#6B7280] bg-gray-50 rounded-md p-2.5 flex items-start gap-2">
                    <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>{lang === "ko" ? "Sonnet 4.6으로 백그라운드 추출 — 답변 속도 영향 없음" : "Sonnet 4.6 background extraction — no impact on response speed"}</span>
                  </div>
                )}
              </div>

              {knowledgeMemory.length > 0 ? (() => {
                const categoryIcon: Record<string, string> = { client: "\u{1F464}", project: "\u{1F4C1}", person: "\u{1F9D1}", decision: "\u26A1", fact: "\u{1F4A1}" };
                const categoryDot: Record<string, string> = { client: "bg-blue-400", project: "bg-purple-400", person: "bg-green-400", decision: "bg-amber-400", fact: "bg-gray-400" };
                const categoryColor: Record<string, string> = {
                  client: "bg-blue-50 text-blue-700 border-blue-200",
                  project: "bg-purple-50 text-purple-700 border-purple-200",
                  person: "bg-green-50 text-green-700 border-green-200",
                  decision: "bg-amber-50 text-amber-700 border-amber-200",
                  fact: "bg-gray-50 text-gray-700 border-gray-200",
                };
                const categoryLabel: Record<string, string> = { client: "고객", project: "프로젝트", person: "인물", decision: "결정", fact: "사실" };
                const categories = ["client", "project", "person", "decision", "fact"] as const;
                const counts = Object.fromEntries(categories.map((c) => [c, knowledgeMemory.filter((m) => m.category === c).length]));

                // Build relation graph edges
                const edges: Array<{ from: string; to: string }> = [];
                knowledgeMemory.forEach((node) => {
                  if (!node.relations) return;
                  node.relations.forEach((rel) => {
                    const target = knowledgeMemory.find((n) => n.subject === rel || n.relations?.includes(node.subject));
                    if (target && target.id !== node.id) {
                      const key = [node.id, target.id].sort().join("-");
                      if (!edges.find((e) => [e.from, e.to].sort().join("-") === key)) {
                        edges.push({ from: node.id, to: target.id });
                      }
                    }
                  });
                });

                return (<>
                {/* Category overview cards */}
                <div className="grid grid-cols-5 gap-2">
                  {categories.map((cat) => (
                    <div key={cat} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                      <div className="text-lg mb-0.5">{categoryIcon[cat]}</div>
                      <div className="text-base font-semibold text-[#1A1A1A]">{counts[cat]}</div>
                      <div className="text-[10px] text-[#6B7280]">{lang === "ko" ? categoryLabel[cat] : cat}</div>
                    </div>
                  ))}
                </div>

                {/* Mini knowledge graph visualization */}
                {knowledgeMemory.length >= 2 && (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-100">
                      <h3 className="text-xs font-medium text-[#6B7280]">{lang === "ko" ? "관계 그래프" : "Relation Graph"}</h3>
                    </div>
                    <div className="p-4">
                      <svg viewBox="0 0 600 300" className="w-full h-48">
                        {/* Draw edges first */}
                        {edges.map((edge, i) => {
                          const nodes = knowledgeMemory.slice(-20); // Show last 20
                          const fromIdx = nodes.findIndex((n) => n.id === edge.from);
                          const toIdx = nodes.findIndex((n) => n.id === edge.to);
                          if (fromIdx < 0 || toIdx < 0) return null;
                          const total = nodes.length;
                          const fx = 300 + 220 * Math.cos((fromIdx / total) * 2 * Math.PI - Math.PI / 2);
                          const fy = 150 + 120 * Math.sin((fromIdx / total) * 2 * Math.PI - Math.PI / 2);
                          const tx = 300 + 220 * Math.cos((toIdx / total) * 2 * Math.PI - Math.PI / 2);
                          const ty = 150 + 120 * Math.sin((toIdx / total) * 2 * Math.PI - Math.PI / 2);
                          return <line key={i} x1={fx} y1={fy} x2={tx} y2={ty} stroke="#E5E7EB" strokeWidth="1" />;
                        })}
                        {/* Draw nodes */}
                        {knowledgeMemory.slice(-20).map((node, i, arr) => {
                          const angle = (i / arr.length) * 2 * Math.PI - Math.PI / 2;
                          const x = 300 + 220 * Math.cos(angle);
                          const y = 150 + 120 * Math.sin(angle);
                          const dotColor: Record<string, string> = { client: "#60A5FA", project: "#A78BFA", person: "#34D399", decision: "#FBBF24", fact: "#9CA3AF" };
                          const hasEdge = edges.some((e) => e.from === node.id || e.to === node.id);
                          return (
                            <g key={node.id}>
                              <circle cx={x} cy={y} r={hasEdge ? 6 : 4} fill={dotColor[node.category] || "#9CA3AF"} opacity={0.9} />
                              <text x={x} y={y + 16} textAnchor="middle" className="text-[8px] fill-[#6B7280]" style={{ fontSize: "8px" }}>
                                {node.subject.length > 8 ? node.subject.slice(0, 8) + ".." : node.subject}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                )}

                {/* Memory list */}
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-[#1A1A1A]">
                      {lang === "ko" ? `저장된 기억 (${knowledgeMemory.length})` : `Stored memories (${knowledgeMemory.length})`}
                    </h3>
                    <button
                      onClick={() => { if (confirm(lang === "ko" ? "모든 기억을 삭제하시겠습니까?" : "Delete all memories?")) setKnowledgeMemory([]); }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      {lang === "ko" ? "전체 삭제" : "Clear all"}
                    </button>
                  </div>
                  <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                    {[...knowledgeMemory].reverse().map((mem) => (
                      <div key={mem.id} className="px-4 py-3 hover:bg-gray-50 group">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${categoryDot[mem.category] || "bg-gray-400"}`} />
                              <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${categoryColor[mem.category] || categoryColor.fact}`}>
                                {lang === "ko" ? categoryLabel[mem.category] || mem.category : mem.category}
                              </span>
                              <span className="text-xs font-medium text-[#1A1A1A] truncate">{mem.subject}</span>
                            </div>
                            <p className="text-xs text-[#6B7280] leading-relaxed pl-3.5">{mem.content}</p>
                            <div className="flex items-center gap-1.5 mt-1.5 pl-3.5 flex-wrap">
                              <span className="text-[10px] text-[#9CA3AF]">{mem.source}</span>
                              <span className="text-[10px] text-[#D1D5DB]">|</span>
                              <span className="text-[10px] text-[#9CA3AF]">{new Date(mem.createdAt).toLocaleDateString()}</span>
                              {mem.relations && mem.relations.length > 0 && (
                                <>
                                  <span className="text-[10px] text-[#D1D5DB]">|</span>
                                  {mem.relations.map((r, i) => (
                                    <span key={i} className="text-[10px] bg-gray-100 text-[#6B7280] px-1.5 py-0.5 rounded-full">{r}</span>
                                  ))}
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => setKnowledgeMemory((prev) => prev.filter((m) => m.id !== mem.id))}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#9CA3AF] hover:text-red-500 transition"
                            title={lang === "ko" ? "삭제" : "Delete"}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                </>);
              })() : (
                <div className="p-8 bg-white rounded-lg border border-gray-200 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  </div>
                  <p className="text-sm font-medium text-[#6B7280]">{lang === "ko" ? "아직 저장된 기억이 없습니다" : "No memories stored yet"}</p>
                  <p className="text-xs text-[#9CA3AF] mt-1">{lang === "ko" ? "대화를 하면 자동으로 중요한 정보가 추출됩니다" : "Important info will be auto-extracted from conversations"}</p>
                </div>
              )}
              </>)}

              {/* ── Meeting Tab ── */}
              {settingsTab === "meeting" && (<>
              {/* Enable toggle */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">{t("settings.meetingEnabled")}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{t("settings.meetingEnabledDesc")}</p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !meetingEnabled;
                      setMeetingEnabled(next);
                      localStorage.setItem("flaude_meeting_enabled", String(next));
                      if (next) {
                        // Check dependencies
                        invoke<boolean>("check_whisper_installed").then(setWhisperInstalled);
                        invoke<boolean>("check_ffmpeg_installed").then(setFfmpegInstalled);
                        // system audio capture is built-in (ScreenCaptureKit/WASAPI)
                        invoke<string>("list_whisper_models").then((r) => setWhisperModels(JSON.parse(r))).catch(() => {});
                      }
                    }}
                    className={`relative w-10 h-5 rounded-full transition ${meetingEnabled ? "bg-[#1A1A1A]" : "bg-gray-300"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition ${meetingEnabled ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
              </div>

              {meetingEnabled && (<>
              {/* Auto-check deps on render */}
              {whisperInstalled === null && (() => {
                invoke<boolean>("check_whisper_installed").then(setWhisperInstalled).catch(() => setWhisperInstalled(false));
                invoke<boolean>("check_ffmpeg_installed").then(setFfmpegInstalled).catch(() => setFfmpegInstalled(false));
                // system audio is built-in
                invoke<string>("list_whisper_models").then((r) => setWhisperModels(JSON.parse(r))).catch(() => {});
                return null;
              })()}

              {/* Setup status — simple checklist */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-2">{lang === "ko" ? "준비 상태" : "Setup Status"}</h3>
                <p className="text-xs text-gray-400 mb-3">{lang === "ko" ? "회의 녹음에 필요한 것들이에요" : "Required for meeting recording"}</p>
                {([
                  { name: lang === "ko" ? "음성인식 엔진 (whisper)" : "Speech Recognition (whisper)", installed: whisperInstalled, installFn: "install_whisper", checkFn: "check_whisper_installed", required: true },
                  { name: lang === "ko" ? "오디오 변환 (ffmpeg)" : "Audio Converter (ffmpeg)", installed: ffmpegInstalled, installFn: "install_ffmpeg", checkFn: "check_ffmpeg_installed", required: true },
                  { name: lang === "ko" ? "시스템 오디오 캡처" : "System Audio Capture", installed: true, installFn: "", checkFn: "", required: false },
                ] as const).map((dep) => (
                  <div key={dep.name} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${dep.installed ? "text-green-500" : dep.required ? "text-red-400" : "text-gray-300"}`}>
                        {dep.installed ? "\u2713" : dep.required ? "\u2717" : "\u2013"}
                      </span>
                      <div>
                        <span className="text-sm">{dep.name}</span>
                        {!dep.required && <span className="text-[10px] text-gray-400 ml-1">{lang === "ko" ? "(선택)" : "(optional)"}</span>}
                      </div>
                    </div>
                    {dep.installed === null ? (
                      <span className="text-xs text-gray-300">...</span>
                    ) : dep.installed ? (
                      <span className="text-xs text-green-500">{lang === "ko" ? "준비됨" : "Ready"}</span>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            await invoke(dep.installFn);
                            const result = await invoke<boolean>(dep.checkFn);
                            if (dep.name.includes("whisper")) setWhisperInstalled(result);
                            else if (dep.name.includes("ffmpeg") || dep.name.includes("오디오 변환")) setFfmpegInstalled(result);
                            else { /* system audio built-in */ }
                          } catch (e) {
                            alert(`${lang === "ko" ? "설치 실패" : "Install failed"}: ${e}`);
                          }
                        }}
                        className="px-3 py-1 text-xs bg-[#D97706] text-white rounded-full hover:bg-[#B45309]"
                      >
                        {lang === "ko" ? "자동 설치" : "Install"}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Whisper Models — simplified */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-1">{lang === "ko" ? "음성 인식 모델" : "Speech Model"}</h3>
                <p className="text-xs text-gray-400 mb-3">{lang === "ko" ? "큰 모델일수록 정확하지만 느려요. M2에서는 medium 추천!" : "Larger = more accurate but slower. Medium recommended for M2!"}</p>
                {whisperModels.map((model) => (
                  <div key={model.name} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <span className="text-sm">{model.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{model.size_mb}MB</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {model.downloaded ? (
                        <div className="flex items-center gap-2">
                          {activeWhisperModel === model.name ? (
                            <span className="text-xs text-green-600 font-medium">{t("settings.meetingModelActive")}</span>
                          ) : (
                            <button
                              onClick={() => { setActiveWhisperModel(model.name); localStorage.setItem("flaude_meeting_model", model.name); }}
                              className="px-2 py-0.5 text-xs text-gray-500 border rounded hover:bg-gray-50"
                            >
                              {lang === "ko" ? "사용" : "Use"}
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              if (!confirm(lang === "ko" ? `${model.name} 모델(${model.size_mb}MB)을 삭제할까요?` : `Delete ${model.name} (${model.size_mb}MB)?`)) return;
                              try {
                                await invoke("delete_whisper_model", { name: model.name });
                                const models = JSON.parse(await invoke<string>("list_whisper_models"));
                                setWhisperModels(models);
                                if (activeWhisperModel === model.name) {
                                  setActiveWhisperModel("small");
                                  localStorage.setItem("flaude_meeting_model", "small");
                                }
                              } catch (e) {
                                alert(`${lang === "ko" ? "삭제 실패" : "Delete failed"}: ${e}`);
                              }
                            }}
                            className="px-1.5 py-0.5 text-xs text-gray-300 hover:text-red-500"
                            title={lang === "ko" ? "삭제" : "Delete"}
                          >
                            &#10005;
                          </button>
                        </div>
                      ) : (
                        <button
                          id={`dl-${model.name}`}
                          onClick={async () => {
                            const btn = document.getElementById(`dl-${model.name}`) as HTMLButtonElement;
                            btn.disabled = true;
                            btn.textContent = lang === "ko" ? `${model.size_mb}MB 다운로드 중...` : `Downloading ${model.size_mb}MB...`;
                            try {
                              await invoke("download_whisper_model", { name: model.name });
                              const models = JSON.parse(await invoke<string>("list_whisper_models"));
                              setWhisperModels(models);
                            } catch (e) {
                              alert(`${lang === "ko" ? "다운로드 실패" : "Download failed"}: ${e}`);
                              btn.disabled = false;
                              btn.textContent = lang === "ko" ? "다운로드" : "Download";
                            }
                          }}
                          className="px-2 py-0.5 text-xs bg-[#D97706] text-white rounded hover:bg-[#B45309] disabled:opacity-60"
                        >
                          {t("settings.meetingModelDownload")} ({model.size_mb}MB)
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Simple settings */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h3 className="text-sm font-medium mb-3">{lang === "ko" ? "녹음 설정" : "Recording Settings"}</h3>
                <div className="space-y-4">
                  {/* Audio source — visual radio */}
                  <div>
                    <p className="text-xs text-gray-500 mb-2">{lang === "ko" ? "어떤 소리를 녹음할까요?" : "What to record?"}</p>
                    <div className="flex gap-2">
                      {([
                        { value: "mic", ko: "마이크 (대면 회의)", en: "Microphone (in-person)" },
                        { value: "system", ko: "시스템 오디오 (화상 회의)", en: "System Audio (video call)" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setMeetingAudioSource(opt.value); localStorage.setItem("flaude_meeting_source", opt.value); }}
                          className={`flex-1 p-2.5 rounded-lg border text-xs text-center transition ${
                            meetingAudioSource === opt.value
                              ? "border-[#D97706] bg-[#D97706]/5 text-[#D97706] font-medium"
                              : "border-gray-200 text-gray-500 hover:border-gray-400"
                          }`}
                        >
                          {lang === "ko" ? opt.ko : opt.en}
                        </button>
                      ))}
                    </div>
                    {meetingAudioSource === "system" && (
                      <p className="text-[10px] text-gray-400 mt-1">{lang === "ko" ? "화면 녹화 권한이 필요할 수 있습니다" : "Screen recording permission may be required"}</p>
                    )}
                  </div>

                  {/* Language */}
                  <div>
                    <p className="text-xs text-gray-500 mb-2">{lang === "ko" ? "회의 언어" : "Meeting Language"}</p>
                    <div className="flex gap-2">
                      {([
                        { value: "ko", label: "한국어" },
                        { value: "en", label: "English" },
                        { value: "ja", label: "日本語" },
                        { value: "zh", label: "中文" },
                      ]).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setMeetingLanguage(opt.value); localStorage.setItem("flaude_meeting_language", opt.value); }}
                          className={`px-3 py-1.5 rounded-lg border text-xs transition ${
                            meetingLanguage === opt.value
                              ? "border-[#D97706] bg-[#D97706]/5 text-[#D97706] font-medium"
                              : "border-gray-200 text-gray-500 hover:border-gray-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Mic test */}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div>
                      <span className="text-sm">{lang === "ko" ? "마이크 테스트" : "Mic Test"}</span>
                      <span id="mic-test-result" className="text-xs ml-2"></span>
                    </div>
                    <button
                      id="mic-test-btn"
                      onClick={async () => {
                        const btn = document.getElementById("mic-test-btn") as HTMLButtonElement;
                        const result = document.getElementById("mic-test-result")!;
                        btn.disabled = true;
                        btn.textContent = "...";
                        result.textContent = "";
                        try {
                          const testPath = `/tmp/flaude_mic_test_${Date.now()}.wav`;
                          await invoke("start_recording", { source: "mic", path: testPath });
                          await new Promise((r) => setTimeout(r, 2000));
                          await invoke<string>("stop_recording");
                          result.textContent = lang === "ko" ? "OK!" : "OK!";
                          result.className = "text-xs ml-2 text-green-600";
                        } catch (e) {
                          result.textContent = `${e}`;
                          result.className = "text-xs ml-2 text-red-500";
                        } finally {
                          btn.disabled = false;
                          btn.textContent = lang === "ko" ? "테스트" : "Test";
                        }
                      }}
                      className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                    >
                      {lang === "ko" ? "테스트" : "Test"}
                    </button>
                  </div>

                  {/* Shortcut hint */}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <span className="text-sm">{lang === "ko" ? "빠른 녹음 단축키" : "Quick Record Shortcut"}</span>
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">Cmd+Shift+R</span>
                  </div>
                </div>
              </div>
              </>)}
              </>)}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
