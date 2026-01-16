// Task types
export type TaskStatus = "backlog" | "in_progress" | "validation" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTask {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
}

// Project types
export interface Project {
  id: string;
  name: string;
  description: string | null;
  userId: string;
  guidelines: string | null;
  aiProviderId: string | null;
  workingDirectory: string | null;
  workingDirectoryConfirmed: boolean | null;
  toolApprovalSettings: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProject {
  name: string;
  description?: string;
  guidelines?: string;
  aiProviderId?: string;
}

// AI Provider types
export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAIProvider {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

// Chat types
export interface ChatMessage {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  proposedChanges: string | null;
  changeStatus: "pending" | "approved" | "denied" | "edited" | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
  toolCallId: string;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// Agent types
export type AgentExecutionStatus =
  | "pending"
  | "analyzing"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentActionType =
  | "readFile"
  | "writeFile"
  | "editFile"
  | "deleteFile"
  | "listDirectory"
  | "executeCommand"
  | "completeTask";

export type AgentActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed";

export interface AgentExecution {
  id: string;
  taskId: string;
  projectId: string;
  status: AgentExecutionStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentAction {
  id: string;
  executionId: string;
  actionType: AgentActionType;
  actionParams: string;
  status: AgentActionStatus;
  result: string | null;
  sequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentActionParsed extends Omit<AgentAction, 'actionParams' | 'result'> {
  actionParams: Record<string, unknown>;
  result: { success: boolean; output?: string; error?: string } | null;
}

// Tool approval settings
export interface ToolApprovalSettings {
  readFile?: boolean;
  listDirectory?: boolean;
  writeFile?: boolean;
  editFile?: boolean;
  deleteFile?: boolean;
  executeCommand?: boolean;
  completeTask?: boolean;
}

export const DEFAULT_TOOL_APPROVAL_SETTINGS: ToolApprovalSettings = {
  readFile: false,
  listDirectory: false,
  writeFile: true,
  editFile: true,
  deleteFile: true,
  executeCommand: true,
  completeTask: true,
};

// Agent SSE event types
export interface AgentStatusEvent {
  executionId: string;
  status: AgentExecutionStatus;
}

export interface AgentActionEvent {
  id: string;
  type: AgentActionType;
  params: Record<string, unknown>;
  status: AgentActionStatus;
  result?: { success: boolean; output?: string; error?: string };
}

export interface AgentTextEvent {
  content: string;
}

export interface AgentExecutingEvent {
  actionId: string;
}

export interface AgentActionCompleteEvent {
  actionId: string;
  success: boolean;
  result: { success: boolean; output?: string; error?: string };
}

export interface AgentTaskCompletedEvent {
  taskId: string;
}

export interface AgentDoneEvent {
  executionId: string;
}

export interface AgentErrorEvent {
  executionId: string;
  error: string;
}

// Filesystem types
export interface StartingPath {
  name: string;
  path: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
}

// Test provider result
export interface TestProviderResult {
  success: boolean;
  models?: ModelInfo[];
  error?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  owned_by?: string;
}
