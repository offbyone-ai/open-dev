import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Auth tables managed by better-auth
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").unique().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Application tables
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  guidelines: text("guidelines"),
  aiProviderId: text("ai_provider_id"),
  workingDirectory: text("working_directory"),
  workingDirectoryConfirmed: integer("working_directory_confirmed", { mode: "boolean" }).default(false),
  // JSON object storing which tools require approval: { writeFile: true, editFile: true, ... }
  // If not set, defaults to requiring approval for write operations
  toolApprovalSettings: text("tool_approval_settings"),
  // JSON object storing sandbox limits: { maxExecutionTimeSeconds, maxTokens, ... }
  // If not set, defaults to DEFAULT_SANDBOX_LIMITS
  sandboxLimits: text("sandbox_limits"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const aiProviders = sqliteTable("ai_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key"),
  model: text("model").notNull().default("gpt-4"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["backlog", "in_progress", "validation", "done"] }).notNull().default("backlog"),
  priority: text("priority", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  position: integer("position").notNull().default(0),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // JSON array of task IDs that must be completed before this task can start
  dependsOn: text("depends_on").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  proposedChanges: text("proposed_changes"),
  changeStatus: text("change_status", { enum: ["pending", "approved", "denied", "edited"] }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Agent execution tables
export const agentExecutions = sqliteTable("agent_executions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["pending", "analyzing", "awaiting_approval", "awaiting_question", "executing", "completed", "failed", "cancelled"]
  }).notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const agentActions = sqliteTable("agent_actions", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => agentExecutions.id, { onDelete: "cascade" }),
  actionType: text("action_type", {
    enum: ["readFile", "writeFile", "editFile", "deleteFile", "listDirectory", "executeCommand", "completeTask", "askQuestion"]
  }).notNull(),
  actionParams: text("action_params").notNull(), // JSON
  status: text("status", {
    enum: ["proposed", "approved", "rejected", "executing", "completed", "failed"]
  }).notNull().default("proposed"),
  result: text("result"), // JSON
  sequence: integer("sequence").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Agent questions for conversational mode
export const agentQuestions = sqliteTable("agent_questions", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => agentExecutions.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  context: text("context"), // Additional context about why the question is being asked
  response: text("response"), // User's response to the question
  status: text("status", { enum: ["pending", "answered"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// GitHub integration for syncing issues
export const githubIntegrations = sqliteTable("github_integrations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(), // GitHub owner (user or org)
  repo: text("repo").notNull(), // Repository name
  accessToken: text("access_token"), // Personal access token (encrypted in production)
  webhookSecret: text("webhook_secret"), // Secret for verifying webhook signatures
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  syncDirection: text("sync_direction", { enum: ["import_only", "export_only", "bidirectional"] }).notNull().default("bidirectional"),
  autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(false), // Auto-sync on webhook events
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Mapping between local tasks and GitHub issues
export const githubIssueMappings = sqliteTable("github_issue_mappings", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  integrationId: text("integration_id").notNull().references(() => githubIntegrations.id, { onDelete: "cascade" }),
  githubIssueNumber: integer("github_issue_number").notNull(),
  githubIssueId: integer("github_issue_id").notNull(), // GitHub's internal issue ID
  githubIssueUrl: text("github_issue_url").notNull(),
  lastLocalStatus: text("last_local_status", { enum: ["backlog", "in_progress", "validation", "done"] }),
  lastGithubState: text("last_github_state", { enum: ["open", "closed"] }),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Sync operation logs for debugging and auditing
export const githubSyncLogs = sqliteTable("github_sync_logs", {
  id: text("id").primaryKey(),
  integrationId: text("integration_id").notNull().references(() => githubIntegrations.id, { onDelete: "cascade" }),
  operation: text("operation", { enum: ["import", "export", "webhook"] }).notNull(),
  status: text("status", { enum: ["success", "failed", "partial"] }).notNull(),
  details: text("details"), // JSON with operation details
  errorMessage: text("error_message"),
  itemsProcessed: integer("items_processed").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Task templates for rapid task creation
export const taskTemplates = sqliteTable("task_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  acceptanceCriteria: text("acceptance_criteria"),
  defaultPriority: text("default_priority", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  category: text("category"),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type AIProvider = typeof aiProviders.$inferSelect;
export type NewAIProvider = typeof aiProviders.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type AgentExecution = typeof agentExecutions.$inferSelect;
export type NewAgentExecution = typeof agentExecutions.$inferInsert;
export type AgentAction = typeof agentActions.$inferSelect;
export type NewAgentAction = typeof agentActions.$inferInsert;
export type AgentQuestion = typeof agentQuestions.$inferSelect;
export type NewAgentQuestion = typeof agentQuestions.$inferInsert;
export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type NewTaskTemplate = typeof taskTemplates.$inferInsert;
export type GitHubIntegration = typeof githubIntegrations.$inferSelect;
export type NewGitHubIntegration = typeof githubIntegrations.$inferInsert;
export type GitHubIssueMapping = typeof githubIssueMappings.$inferSelect;
export type NewGitHubIssueMapping = typeof githubIssueMappings.$inferInsert;
export type GitHubSyncLog = typeof githubSyncLogs.$inferSelect;
export type NewGitHubSyncLog = typeof githubSyncLogs.$inferInsert;
