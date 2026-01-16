// Re-export all types from shared package
export type {
  TaskStatus,
  TaskPriority,
  Task,
  CreateTask,
  Project,
  CreateProject,
  AIProvider,
  CreateAIProvider,
  ChatMessage,
  ToolCall,
  ToolResult,
  AgentExecutionStatus,
  AgentActionType,
  AgentActionStatus,
  AgentExecution,
  AgentAction,
  AgentActionParsed,
  ToolApprovalSettings,
  AgentStatusEvent,
  AgentActionEvent,
  AgentTextEvent,
  AgentExecutingEvent,
  AgentActionCompleteEvent,
  AgentTaskCompletedEvent,
  AgentDoneEvent,
  AgentErrorEvent,
  StartingPath,
  DirectoryEntry,
  BrowseResult,
  TestProviderResult,
  ModelInfo,
} from "@open-dev/shared";

export { DEFAULT_TOOL_APPROVAL_SETTINGS } from "@open-dev/shared";

import type {
  Task,
  CreateTask,
  TaskStatus,
  Project,
  CreateProject,
  AIProvider,
  CreateAIProvider,
  ChatMessage,
  ToolCall,
  ToolResult,
  AgentExecution,
  AgentAction,
  AgentActionParsed,
  ToolApprovalSettings,
  StartingPath,
  BrowseResult,
  TestProviderResult,
} from "@open-dev/shared";

const API_BASE = "/api";

async function fetchAPI<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

// Projects
export const projectsAPI = {
  list: () => fetchAPI<Project[]>("/projects"),
  get: (id: string) => fetchAPI<Project>(`/projects/${id}`),
  create: (data: CreateProject) => fetchAPI<{ id: string }>("/projects", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  update: (id: string, data: Partial<CreateProject>) => fetchAPI<{ success: boolean }>(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchAPI<{ success: boolean }>(`/projects/${id}`, {
    method: "DELETE",
  }),
};

// Tasks
export const tasksAPI = {
  list: (projectId: string) => fetchAPI<Task[]>(`/projects/${projectId}/tasks`),
  get: (projectId: string, taskId: string) => fetchAPI<Task>(`/projects/${projectId}/tasks/${taskId}`),
  create: (projectId: string, data: CreateTask) => fetchAPI<{ id: string }>(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(data),
  }),
  update: (projectId: string, taskId: string, data: Partial<CreateTask>) => fetchAPI<{ success: boolean }>(`/projects/${projectId}/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),
  delete: (projectId: string, taskId: string) => fetchAPI<{ success: boolean }>(`/projects/${projectId}/tasks/${taskId}`, {
    method: "DELETE",
  }),
  reorder: (projectId: string, taskId: string, data: { status: TaskStatus; position: number }) => fetchAPI<{ success: boolean }>(`/projects/${projectId}/tasks/${taskId}/reorder`, {
    method: "POST",
    body: JSON.stringify(data),
  }),
};

// AI Providers
export const aiProvidersAPI = {
  list: () => fetchAPI<AIProvider[]>("/ai-providers"),
  get: (id: string) => fetchAPI<AIProvider>(`/ai-providers/${id}`),
  create: (data: CreateAIProvider) => fetchAPI<{ id: string }>("/ai-providers", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  update: (id: string, data: Partial<CreateAIProvider>) => fetchAPI<{ success: boolean }>(`/ai-providers/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchAPI<{ success: boolean }>(`/ai-providers/${id}`, {
    method: "DELETE",
  }),
  test: (baseUrl: string, apiKey?: string) => fetchAPI<TestProviderResult>("/ai-providers/test", {
    method: "POST",
    body: JSON.stringify({ baseUrl, apiKey }),
  }),
};

// Chat
export const chatAPI = {
  list: (projectId: string) => fetchAPI<ChatMessage[]>(`/projects/${projectId}/chat`),
  send: async (projectId: string, message: string) => {
    const response = await fetch(`${API_BASE}/projects/${projectId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      throw new Error("Failed to send message");
    }
    return response;
  },
  saveAssistant: (projectId: string, data: { content: string; proposedChanges?: string }) =>
    fetchAPI<{ id: string }>(`/projects/${projectId}/chat/save-assistant`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  execute: (projectId: string, toolCalls: ToolCall[]) =>
    fetchAPI<ToolResult[]>(`/projects/${projectId}/chat/execute`, {
      method: "POST",
      body: JSON.stringify({ toolCalls }),
    }),
  updateStatus: (projectId: string, messageId: string, status: "approved" | "denied" | "edited") =>
    fetchAPI<{ success: boolean }>(`/projects/${projectId}/chat/${messageId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
};

// Agent API
export const agentAPI = {
  // Set working directory
  setWorkingDirectory: (projectId: string, workingDirectory: string, confirmed: boolean) =>
    fetchAPI<{ success: boolean }>(`/projects/${projectId}/working-directory`, {
      method: "POST",
      body: JSON.stringify({ workingDirectory, confirmed }),
    }),

  // Start agent execution - returns EventSource for SSE
  startExecution: (projectId: string, taskId: string): EventSource => {
    const eventSource = new EventSource(
      `${API_BASE}/projects/${projectId}/tasks/${taskId}/agent/start`,
      { withCredentials: true }
    );
    return eventSource;
  },

  // Start execution with fetch (for POST)
  startExecutionFetch: async (projectId: string, taskId: string): Promise<Response> => {
    const response = await fetch(
      `${API_BASE}/projects/${projectId}/tasks/${taskId}/agent/start`,
      {
        method: "POST",
        credentials: "include",
      }
    );
    return response;
  },

  // Get execution status and actions
  getExecution: (executionId: string) =>
    fetchAPI<{ execution: AgentExecution; actions: AgentAction[] }>(
      `/agent/executions/${executionId}`
    ),

  // Approve or reject actions
  updateActionStatus: (executionId: string, actionIds: string[], status: "approved" | "rejected") =>
    fetchAPI<{ success: boolean }>(`/agent/executions/${executionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ actionIds, status }),
    }),

  // Execute approved actions - returns fetch response for SSE
  executeApproved: async (executionId: string): Promise<Response> => {
    const response = await fetch(
      `${API_BASE}/agent/executions/${executionId}/execute`,
      {
        method: "POST",
        credentials: "include",
      }
    );
    return response;
  },

  // Cancel execution
  cancel: (executionId: string) =>
    fetchAPI<{ success: boolean }>(`/agent/executions/${executionId}/cancel`, {
      method: "POST",
    }),

  // Get tool approval settings
  getToolApprovalSettings: (projectId: string) =>
    fetchAPI<ToolApprovalSettings>(`/projects/${projectId}/tool-approval-settings`),

  // Update tool approval settings
  updateToolApprovalSettings: (projectId: string, settings: ToolApprovalSettings) =>
    fetchAPI<{ success: boolean }>(`/projects/${projectId}/tool-approval-settings`, {
      method: "POST",
      body: JSON.stringify(settings),
    }),
};

// Helper to parse agent action
export function parseAgentAction(action: AgentAction): AgentActionParsed {
  return {
    ...action,
    actionParams: JSON.parse(action.actionParams),
    result: action.result ? JSON.parse(action.result) : null,
  };
}

// Filesystem API
export const filesystemAPI = {
  getStartingPaths: () => fetchAPI<StartingPath[]>("/filesystem/starting-paths"),

  browse: (path: string) =>
    fetchAPI<BrowseResult>(`/filesystem/browse?path=${encodeURIComponent(path)}`),

  validate: (path: string) =>
    fetchAPI<{ valid: boolean; path: string }>(
      `/filesystem/validate?path=${encodeURIComponent(path)}`
    ),

  createDirectory: (path: string) =>
    fetchAPI<{ success: boolean; path: string }>("/filesystem/create-directory", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
};
