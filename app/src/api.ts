export const SERVER_URL = import.meta.env.VITE_SERVER_URL || "https://flaude.com";

function getApiBase(): string {
  return `${SERVER_URL}/api`;
}

let authToken: string | null = localStorage.getItem("flaude_token");

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem("flaude_token", token);
  } else {
    localStorage.removeItem("flaude_token");
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

function getAuthHeader(): string {
  if (authToken) return `Bearer ${authToken}`;
  return "Basic " + btoa("admin:admin"); // dev fallback
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
      ...options.headers,
    },
  });
  if (res.status === 204) return null as T;
  if (res.status === 401) {
    // Token expired or invalid — clear and force re-login
    setAuthToken(null);
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Auth ────────────────────────────────────────────

export type AuthStartResult = { url: string; state: string };
export type AuthPollResult = { status: "pending" | "ok"; token?: string; email?: string; name?: string };

export const authGoogleStart = () =>
  fetch(`${getApiBase()}/auth/google/start`).then(async (res) => {
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<AuthStartResult>;
  });

export const authGooglePoll = (state: string) =>
  fetch(`${getApiBase()}/auth/google/poll?state=${state}`).then(async (res) => {
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<AuthPollResult>;
  });

// ── Me ─────────────────────────────────────────────

export type Me = { id: number; email: string; name: string };

export const getMe = () => request<Me>("/me");

// ── Types ───────────────────────────────────────────

export type Agent = {
  id: number;
  name: string;
  role: string;
  instructions: string;
  tools: string[];
  not_allowed: string[];
  channels: string[];
  avatar_url: string;
  status: "active" | "fired";
  fired_reason: string;
  created_at: string;
  fired_at: string | null;
};

export type Workspace = {
  id: number;
  name: string;
  created_at: string;
};

export type WorkspaceMember = {
  id: number;
  user_id: number;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
};

export type WorkspaceInvite = {
  id: number;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
};

export type AgentTeam = {
  id: number;
  name: string;
  members: { agent_id: number; order: number; is_lead?: boolean; condition?: string; requires_approval?: boolean }[];
  execution_mode: "sequential" | "parallel";
  created_at: string;
};

export type Client = {
  id: number;
  company: string;
  contact_name: string;
  email: string;
  phone: string;
  department: string;
  notes: string;
  status: string;
  assigned_agent: string;
  created_at: string;
  updated_at: string;
};

export type ClientHistory = {
  id: number;
  agent_name: string;
  action: string;
  detail: string;
  created_at: string;
};

export type AgentInput = {
  name: string;
  role: string;
  instructions: string;
  tools?: string[];
  not_allowed?: string[];
  channels?: string[];
  avatar_url?: string;
};

export type AgentTeamInput = {
  name: string;
  members?: { agent_id: number; order: number; is_lead?: boolean }[];
  execution_mode?: string;
};

export type AgentTeamRunResult = {
  team_name: string;
  execution_mode: string;
  prompt: string;
  sdk_session_id?: string;
  agents: {
    agent_id: number;
    name: string;
    instructions: string;
    tools: string[];
    not_allowed: string[];
    is_lead: boolean;
    order: number;
  }[];
};

// ── Staff (Human Team Members) ────────────────────

export type Staff = {
  id: number;
  name: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  created_at: string;
};

export type StaffInput = {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

export type ClientInput = {
  company?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  department?: string;
  notes?: string;
  status?: string;
  assigned_agent?: string;
};

// ── Workspaces ─────────────────────────────────────

export const getWorkspaces = () => request<Workspace[]>("/workspaces");
export const createWorkspace = (name: string) =>
  request<Workspace>("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
export const updateWorkspace = (wsId: number, name: string) =>
  request<Workspace>(`/workspaces/${wsId}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });

// ── Workspace Members ──────────────────────────────

export const getWorkspaceMembers = (wsId: number) =>
  request<WorkspaceMember[]>(`/workspaces/${wsId}/members`);

export const updateMemberRole = (wsId: number, memberId: number, role: string) =>
  request(`/workspaces/${wsId}/members/${memberId}/role?role=${role}`, { method: "PUT" });

export const removeWorkspaceMember = (wsId: number, memberId: number) =>
  request<null>(`/workspaces/${wsId}/members/${memberId}`, { method: "DELETE" });

// ── Workspace Invites ──────────────────────────────

export const getWorkspaceInvites = (wsId: number) =>
  request<WorkspaceInvite[]>(`/workspaces/${wsId}/invites`);

export const createWorkspaceInvite = (wsId: number, email: string, role: string = "member") =>
  request<WorkspaceInvite>(`/workspaces/${wsId}/invites`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });

export const cancelInvite = (inviteId: number) =>
  request<null>(`/invites/${inviteId}`, { method: "DELETE" });

export const acceptInvite = (token: string) =>
  request<{ ok: boolean; workspace_id: number; workspace_name: string }>(`/invites/accept?token=${token}`, {
    method: "POST",
  });

// ── Agents ──────────────────────────────────────────

export const getAgents = (wsId: number) =>
  request<Agent[]>(`/workspaces/${wsId}/agents`);

export const createAgent = (wsId: number, data: AgentInput) =>
  request<Agent>(`/workspaces/${wsId}/agents`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateAgent = (agentId: number, data: AgentInput) =>
  request<Agent>(`/agents/${agentId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const fireAgent = (agentId: number, reason: string = "") =>
  request<Agent>(`/agents/${agentId}/fire`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export const rehireAgent = (agentId: number) =>
  request<Agent>(`/agents/${agentId}/rehire`, { method: "POST" });

export const deleteAgent = (agentId: number) =>
  request<null>(`/agents/${agentId}`, { method: "DELETE" });

// ── Agent Teams ─────────────────────────────────────

export const getAgentTeams = (wsId: number) =>
  request<AgentTeam[]>(`/workspaces/${wsId}/agent-teams`);

export const createAgentTeam = (wsId: number, data: AgentTeamInput) =>
  request<AgentTeam>(`/workspaces/${wsId}/agent-teams`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateAgentTeam = (atId: number, data: AgentTeamInput) =>
  request<AgentTeam>(`/agent-teams/${atId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteAgentTeam = (atId: number) =>
  request<null>(`/agent-teams/${atId}`, { method: "DELETE" });

export const runAgentTeam = (atId: number, prompt: string) =>
  request<AgentTeamRunResult>(`/agent-teams/${atId}/run`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });

// ── Staff ───────────────────────────────────────────

export const getStaff = (wsId: number) =>
  request<Staff[]>(`/workspaces/${wsId}/staff`);

export const createStaff = (wsId: number, data: StaffInput) =>
  request<Staff>(`/workspaces/${wsId}/staff`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateStaff = (staffId: number, data: StaffInput) =>
  request<Staff>(`/staff/${staffId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteStaff = (staffId: number) =>
  request<null>(`/staff/${staffId}`, { method: "DELETE" });

// ── Clients ─────────────────────────────────────────

export const getClients = (wsId: number) =>
  request<Client[]>(`/workspaces/${wsId}/clients`);

export const createClient = (wsId: number, data: ClientInput) =>
  request<Client>(`/workspaces/${wsId}/clients`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateClient = (clientId: number, data: ClientInput) =>
  request<Client>(`/clients/${clientId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteClient = (clientId: number) =>
  request<null>(`/clients/${clientId}`, { method: "DELETE" });

export const getClientHistory = (clientId: number) =>
  request<ClientHistory[]>(`/clients/${clientId}/history`);

export const createClientHistory = (
  clientId: number,
  data: { agent_name: string; action: string; detail?: string }
) =>
  request<ClientHistory>(`/clients/${clientId}/history`, {
    method: "POST",
    body: JSON.stringify(data),
  });

// ── Platform Links (Discord / Slack) ────────────────

export type PlatformLink = {
  id: number;
  platform: string;
  platform_user_id: string;
  platform_team_id: string;
  linked_at: string;
};

export const getPlatformLinks = () =>
  request<PlatformLink[]>("/me/platform-links");

export const createPlatformLink = (
  platform: string,
  platform_user_id: string,
  platform_team_id: string = ""
) =>
  request<PlatformLink>("/me/platform-links", {
    method: "POST",
    body: JSON.stringify({ platform, platform_user_id, platform_team_id }),
  });

export const deletePlatformLink = (linkId: number) =>
  request<null>(`/me/platform-links/${linkId}`, { method: "DELETE" });

// ── Client Parsing ──────────────────────────────────

export const parseClientInfo = (wsId: number, rawText: string) =>
  request<{ parsed: Record<string, string> }>(`/workspaces/${wsId}/clients/parse?raw_text=${encodeURIComponent(rawText)}`, {
    method: "POST",
  });

// ── Agent Memory ────────────────────────────────────

export type AgentMemory = {
  id: number;
  key: string;
  content: string;
  source: string;
  created_at: string;
  updated_at: string;
};

export const getAgentMemories = (agentId: number) =>
  request<AgentMemory[]>(`/agents/${agentId}/memories`);

export const createAgentMemory = (agentId: number, data: { key: string; content: string }) =>
  request<AgentMemory>(`/agents/${agentId}/memories`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const deleteAgentMemory = (memoryId: number) =>
  request<null>(`/memories/${memoryId}`, { method: "DELETE" });

// ── Team Memory ─────────────────────────────────────

export type TeamMemory = {
  id: number;
  key: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export const getTeamMemories = (teamId: number) =>
  request<TeamMemory[]>(`/agent-teams/${teamId}/memories`);

export const createTeamMemory = (teamId: number, data: { key: string; content: string }) =>
  request<TeamMemory>(`/agent-teams/${teamId}/memories`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const deleteTeamMemory = (memoryId: number) =>
  request<null>(`/team-memories/${memoryId}`, { method: "DELETE" });

// ── Client Timeline ─────────────────────────────────

export type TimelineEntry = {
  id: number;
  type: "history" | "execution";
  agent_name: string;
  action: string;
  detail: string;
  created_at: string;
};

export const getClientTimeline = (clientId: number) =>
  request<TimelineEntry[]>(`/clients/${clientId}/timeline`);

// ── Schedules ───────────────────────────────────────

export type Schedule = {
  id: number;
  name: string;
  agent_id: number | null;
  team_id: number | null;
  cron_expression: string;
  prompt: string;
  client_id: number | null;
  notification_channel: string;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
};

export const getSchedules = (wsId: number) =>
  request<Schedule[]>(`/workspaces/${wsId}/schedules`);

export const createSchedule = (wsId: number, data: Partial<Schedule>) =>
  request<Schedule>(`/workspaces/${wsId}/schedules`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateSchedule = (scheduleId: number, data: Partial<Schedule>) =>
  request<Schedule>(`/schedules/${scheduleId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteSchedule = (scheduleId: number) =>
  request<null>(`/schedules/${scheduleId}`, { method: "DELETE" });

// ── Approvals ───────────────────────────────────────

export type Approval = {
  id: number;
  team_name: string;
  agent_name: string;
  next_agent_name: string;
  result_preview: string;
  prompt: string;
  status: string;
  platform: string;
  created_at: string;
  decided_at: string | null;
};

export const getPendingApprovals = () =>
  request<Approval[]>("/approvals/pending");

export const decideApproval = (approvalId: number, decision: "approved" | "rejected") =>
  request<{ ok: boolean }>(`/approvals/${approvalId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
