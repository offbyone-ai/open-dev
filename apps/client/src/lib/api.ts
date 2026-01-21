// Re-export all types from shared package
export type {
  TaskStatus,
  TaskPriority,
  Task,
  CreateTask,
  TaskWithDependencyInfo,
  DependencyValidationResult,
  TaskExecutionOrder,
  DependencyGraph,
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
  AgentQuestion,
  AgentQuestionEvent,
  AgentQuestionAnsweredEvent,
  StartingPath,
  DirectoryEntry,
  BrowseResult,
  TestProviderResult,
  ModelInfo,
  TaskTemplate,
  CreateTaskTemplate,
  // File watcher types
  FileChangeType,
  FileChangeEvent,
  FileWatcherOptions,
  FileWatcherStatus,
  FileWatcherStatusEvent,
  FileWatcherChangeEvent,
  FileWatcherHeartbeatEvent,
  FileWatcherErrorEvent,
  // Execution history types
  ExecutionHistoryItem,
  ExecutionHistoryDetail,
  ExecutionHistoryFilters,
  ExecutionHistoryStats,
  // GitHub integration types
  GitHubSyncDirection,
  GitHubIssueState,
  GitHubIntegration,
  CreateGitHubIntegration,
  UpdateGitHubIntegration,
  GitHubIssueMapping,
  GitHubIssue,
  GitHubSyncLog,
  GitHubImportResult,
  GitHubExportResult,
  GitHubConnectionTestResult,
} from "@open-dev/shared";

export { DEFAULT_TOOL_APPROVAL_SETTINGS } from "@open-dev/shared";

import type {
  Task,
  CreateTask,
  TaskStatus,
  DependencyGraph,
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
  TaskTemplate,
  CreateTaskTemplate,
  FileWatcherStatus,
  ExecutionHistoryItem,
  ExecutionHistoryDetail,
  ExecutionHistoryFilters,
  ExecutionHistoryStats,
  GitHubIntegration,
  CreateGitHubIntegration,
  UpdateGitHubIntegration,
  GitHubIssueMapping,
  GitHubSyncLog,
  GitHubImportResult,
  GitHubExportResult,
  GitHubConnectionTestResult,
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
  // Dependency-related APIs
  getDependencyGraph: (projectId: string) => fetchAPI<DependencyGraph>(`/projects/${projectId}/tasks/dependency-graph`),
  getExecutionOrder: (projectId: string) => fetchAPI<Array<{ task: Task; canStart: boolean }>>(`/projects/${projectId}/tasks/execution-order`),
  canStart: (projectId: string, taskId: string) => fetchAPI<{ canStart: boolean; blockingTasks: Task[] }>(`/projects/${projectId}/tasks/${taskId}/can-start`),
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

  // Read single file content for diff preview
  readFileContent: (projectId: string, filePath: string) =>
    fetchAPI<{ content: string; exists: boolean }>(
      `/projects/${projectId}/file-content?path=${encodeURIComponent(filePath)}`
    ),

  // Read multiple file contents for diff preview (batch)
  readFileContents: (projectId: string, paths: string[]) =>
    fetchAPI<Record<string, { content: string; exists: boolean }>>(
      `/projects/${projectId}/file-contents`,
      {
        method: "POST",
        body: JSON.stringify({ paths }),
      }
    ),

  // Get pending questions for an execution
  getPendingQuestions: (executionId: string) =>
    fetchAPI<Array<{ id: string; question: string; context: string | null; status: string }>>(
      `/agent/executions/${executionId}/questions`
    ),

  // Answer a question
  answerQuestion: (executionId: string, questionId: string, response: string) =>
    fetchAPI<{ success: boolean; response: string }>(
      `/agent/executions/${executionId}/questions/${questionId}/answer`,
      {
        method: "POST",
        body: JSON.stringify({ response }),
      }
    ),

  // Resume execution after answering questions - returns fetch response for SSE
  resumeExecution: async (executionId: string): Promise<Response> => {
    const response = await fetch(
      `${API_BASE}/agent/executions/${executionId}/resume`,
      {
        method: "POST",
        credentials: "include",
      }
    );
    return response;
  },
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

// Task Templates API
export const taskTemplatesAPI = {
  list: (projectId: string) => fetchAPI<TaskTemplate[]>(`/projects/${projectId}/templates`),
  get: (projectId: string, templateId: string) => fetchAPI<TaskTemplate>(`/projects/${projectId}/templates/${templateId}`),
  create: (projectId: string, data: CreateTaskTemplate) => fetchAPI<{ id: string }>(`/projects/${projectId}/templates`, {
    method: "POST",
    body: JSON.stringify(data),
  }),
  update: (projectId: string, templateId: string, data: Partial<CreateTaskTemplate>) => fetchAPI<{ success: boolean }>(`/projects/${projectId}/templates/${templateId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),
  delete: (projectId: string, templateId: string) => fetchAPI<{ success: boolean }>(`/projects/${projectId}/templates/${templateId}`, {
    method: "DELETE",
  }),
};

// File Watcher API
export const fileWatcherAPI = {
  // Get file watcher status for a project
  getStatus: (projectId: string) =>
    fetchAPI<FileWatcherStatus>(`/projects/${projectId}/file-watcher/status`),

  // Start watching for file changes - returns fetch response for SSE
  startWatch: async (projectId: string): Promise<Response> => {
    const response = await fetch(
      `${API_BASE}/projects/${projectId}/file-watcher/watch`,
      {
        method: "GET",
        credentials: "include",
      }
    );
    return response;
  },

  // Stop watching for file changes
  stopWatch: (projectId: string) =>
    fetchAPI<{ success: boolean }>(`/projects/${projectId}/file-watcher/stop`, {
      method: "POST",
    }),
};

// Execution History API
export const executionHistoryAPI = {
  // Get list of executions for a project
  list: (projectId: string, filters?: ExecutionHistoryFilters) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.limit) params.set("limit", filters.limit.toString());
    if (filters?.offset) params.set("offset", filters.offset.toString());
    const queryString = params.toString();
    return fetchAPI<ExecutionHistoryItem[]>(
      `/projects/${projectId}/executions${queryString ? `?${queryString}` : ""}`
    );
  },

  // Get detailed execution with all actions
  getDetail: (executionId: string) =>
    fetchAPI<ExecutionHistoryDetail>(`/agent/executions/${executionId}/detail`),

  // Get execution statistics for a project
  getStats: (projectId: string) =>
    fetchAPI<ExecutionHistoryStats>(`/projects/${projectId}/executions/stats`),
};

// GitHub Integration API
export const githubAPI = {
  // Get integration configuration
  get: (projectId: string) =>
    fetchAPI<GitHubIntegration | null>(`/projects/${projectId}/github`),

  // Create or update integration
  upsert: (projectId: string, data: CreateGitHubIntegration | UpdateGitHubIntegration) =>
    fetchAPI<{ id: string; created?: boolean; updated?: boolean }>(
      `/projects/${projectId}/github`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  // Delete integration
  delete: (projectId: string) =>
    fetchAPI<{ success: boolean }>(`/projects/${projectId}/github`, {
      method: "DELETE",
    }),

  // Test connection to GitHub
  testConnection: (projectId: string) =>
    fetchAPI<GitHubConnectionTestResult>(`/projects/${projectId}/github/test`, {
      method: "POST",
    }),

  // Import issues from GitHub
  import: (
    projectId: string,
    options?: { state?: "open" | "closed" | "all"; labels?: string; since?: string }
  ) =>
    fetchAPI<GitHubImportResult>(`/projects/${projectId}/github/import`, {
      method: "POST",
      body: JSON.stringify(options || {}),
    }),

  // Export task statuses to GitHub
  export: (projectId: string, taskId?: string) =>
    fetchAPI<GitHubExportResult>(`/projects/${projectId}/github/export`, {
      method: "POST",
      body: JSON.stringify({ taskId }),
    }),

  // Get all issue mappings for a project
  getMappings: (projectId: string) =>
    fetchAPI<GitHubIssueMapping[]>(`/projects/${projectId}/github/mappings`),

  // Get mapping for a specific task
  getTaskMapping: (projectId: string, taskId: string) =>
    fetchAPI<GitHubIssueMapping | null>(
      `/projects/${projectId}/github/mappings/${taskId}`
    ),

  // Get sync logs
  getLogs: (projectId: string, limit?: number) => {
    const params = limit ? `?limit=${limit}` : "";
    return fetchAPI<GitHubSyncLog[]>(`/projects/${projectId}/github/logs${params}`);
  },
};
