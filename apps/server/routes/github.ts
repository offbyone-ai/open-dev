/**
 * GitHub Integration Routes
 *
 * Handles GitHub integration configuration, issue sync, and webhooks.
 */

import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Session } from "../auth";
import type {
  GitHubIntegration as GitHubIntegrationType,
  GitHubIssueMapping as GitHubIssueMappingType,
  GitHubSyncLog as GitHubSyncLogType,
  GitHubImportResult,
  GitHubExportResult,
  TaskStatus,
} from "@open-dev/shared";
import {
  DEFAULT_STATUS_MAPPING,
  DEFAULT_REVERSE_STATUS_MAPPING,
} from "@open-dev/shared";
import {
  createGitHubClient,
} from "../github/client";
import { createTask, getTasks, updateTask } from "./tasks";

// Transform DB integration to API type (hide sensitive fields)
function transformIntegration(
  integration: typeof schema.githubIntegrations.$inferSelect
): GitHubIntegrationType {
  return {
    id: integration.id,
    projectId: integration.projectId,
    owner: integration.owner,
    repo: integration.repo,
    hasAccessToken: !!integration.accessToken,
    hasWebhookSecret: !!integration.webhookSecret,
    enabled: integration.enabled,
    syncDirection: integration.syncDirection,
    autoSync: integration.autoSync,
    lastSyncAt: integration.lastSyncAt?.toISOString() || null,
    createdAt: integration.createdAt.toISOString(),
    updatedAt: integration.updatedAt.toISOString(),
  };
}

// Transform DB mapping to API type
function transformMapping(
  mapping: typeof schema.githubIssueMappings.$inferSelect
): GitHubIssueMappingType {
  return {
    ...mapping,
    lastSyncedAt: mapping.lastSyncedAt?.toISOString() || null,
    createdAt: mapping.createdAt.toISOString(),
    updatedAt: mapping.updatedAt.toISOString(),
  };
}

// Transform DB log to API type
function transformLog(
  log: typeof schema.githubSyncLogs.$inferSelect
): GitHubSyncLogType {
  return {
    ...log,
    itemsProcessed: log.itemsProcessed || 0,
    createdAt: log.createdAt.toISOString(),
  };
}

// Helper to verify project access
async function verifyProjectAccess(session: Session, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, session.user.id)
    ),
  });
  if (!project) {
    throw new Error("Project not found");
  }
  return project;
}

// Get integration for a project
async function getIntegration(session: Session, projectId: string) {
  await verifyProjectAccess(session, projectId);
  const integration = await db.query.githubIntegrations.findFirst({
    where: eq(schema.githubIntegrations.projectId, projectId),
  });
  return integration ? transformIntegration(integration) : null;
}

// Get integration with token (internal use only)
async function getIntegrationWithToken(session: Session, projectId: string) {
  await verifyProjectAccess(session, projectId);
  return db.query.githubIntegrations.findFirst({
    where: eq(schema.githubIntegrations.projectId, projectId),
  });
}

// Create or update GitHub integration
async function upsertIntegration(
  session: Session,
  projectId: string,
  data: {
    owner: string;
    repo: string;
    accessToken?: string;
    webhookSecret?: string;
    syncDirection?: "import_only" | "export_only" | "bidirectional";
    autoSync?: boolean;
    enabled?: boolean;
  }
) {
  await verifyProjectAccess(session, projectId);

  const existing = await db.query.githubIntegrations.findFirst({
    where: eq(schema.githubIntegrations.projectId, projectId),
  });

  if (existing) {
    // Update existing
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (data.owner !== undefined) updateData.owner = data.owner;
    if (data.repo !== undefined) updateData.repo = data.repo;
    if (data.accessToken !== undefined) updateData.accessToken = data.accessToken;
    if (data.webhookSecret !== undefined) updateData.webhookSecret = data.webhookSecret;
    if (data.syncDirection !== undefined) updateData.syncDirection = data.syncDirection;
    if (data.autoSync !== undefined) updateData.autoSync = data.autoSync;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    await db
      .update(schema.githubIntegrations)
      .set(updateData)
      .where(eq(schema.githubIntegrations.id, existing.id));

    return { id: existing.id, updated: true };
  } else {
    // Create new
    const id = nanoid();
    await db.insert(schema.githubIntegrations).values({
      id,
      projectId,
      owner: data.owner,
      repo: data.repo,
      accessToken: data.accessToken,
      webhookSecret: data.webhookSecret,
      syncDirection: data.syncDirection || "bidirectional",
      autoSync: data.autoSync ?? false,
    });

    return { id, created: true };
  }
}

// Delete integration
async function deleteIntegration(session: Session, projectId: string) {
  await verifyProjectAccess(session, projectId);

  const integration = await db.query.githubIntegrations.findFirst({
    where: eq(schema.githubIntegrations.projectId, projectId),
  });

  if (!integration) {
    throw new Error("No GitHub integration found for this project");
  }

  await db
    .delete(schema.githubIntegrations)
    .where(eq(schema.githubIntegrations.id, integration.id));

  return { success: true };
}

// Test GitHub connection
async function testConnection(session: Session, projectId: string) {
  const integration = await getIntegrationWithToken(session, projectId);

  if (!integration) {
    throw new Error("No GitHub integration configured");
  }

  if (!integration.accessToken) {
    throw new Error("No access token configured");
  }

  const client = createGitHubClient({
    accessToken: integration.accessToken,
    owner: integration.owner,
    repo: integration.repo,
  });

  return client.testConnection();
}

// Map task status to GitHub issue state
function taskStatusToGitHubState(status: TaskStatus): "open" | "closed" {
  const mapping = DEFAULT_STATUS_MAPPING;
  return mapping[status];
}

// Map GitHub issue state to task status
function githubStateToTaskStatus(
  state: "open" | "closed",
  currentStatus?: TaskStatus
): TaskStatus {
  // If we have a current status and the GitHub state matches, keep it
  if (currentStatus) {
    const expectedGitHubState = taskStatusToGitHubState(currentStatus);
    if (expectedGitHubState === state) {
      return currentStatus;
    }
  }

  // Otherwise use default reverse mapping
  const mapping = DEFAULT_REVERSE_STATUS_MAPPING;
  return mapping[state];
}

// Import issues from GitHub
async function importIssues(
  session: Session,
  projectId: string,
  options: {
    state?: "open" | "closed" | "all";
    labels?: string;
    since?: string;
  } = {}
): Promise<GitHubImportResult> {
  const integration = await getIntegrationWithToken(session, projectId);

  if (!integration) {
    throw new Error("No GitHub integration configured");
  }

  if (!integration.accessToken) {
    throw new Error("No access token configured");
  }

  if (integration.syncDirection === "export_only") {
    throw new Error("Import is disabled for this integration (export_only mode)");
  }

  const client = createGitHubClient({
    accessToken: integration.accessToken,
    owner: integration.owner,
    repo: integration.repo,
  });

  const result: GitHubImportResult = {
    success: true,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Fetch issues from GitHub
    const issues = await client.listAllIssues({
      state: options.state || "open",
      labels: options.labels,
      since: options.since,
    });

    // Get existing mappings for this project
    const existingMappings = await db.query.githubIssueMappings.findMany({
      where: eq(schema.githubIssueMappings.projectId, projectId),
    });

    const mappingsByIssueNumber = new Map(
      existingMappings.map((m) => [m.githubIssueNumber, m])
    );

    for (const issue of issues) {
      try {
        const existingMapping = mappingsByIssueNumber.get(issue.number);

        if (existingMapping) {
          // Update existing task
          const newStatus = githubStateToTaskStatus(
            issue.state,
            existingMapping.lastLocalStatus || undefined
          );

          await updateTask(session, projectId, existingMapping.taskId, {
            title: issue.title,
            description: issue.body || undefined,
            status: newStatus,
          });

          // Update mapping
          await db
            .update(schema.githubIssueMappings)
            .set({
              lastGithubState: issue.state,
              lastLocalStatus: newStatus,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.githubIssueMappings.id, existingMapping.id));

          result.updated++;
        } else {
          // Create new task
          const status = githubStateToTaskStatus(issue.state);
          const { id: taskId } = await createTask(session, projectId, {
            title: issue.title,
            description: issue.body || undefined,
            status,
          });

          // Create mapping
          const mappingId = nanoid();
          await db.insert(schema.githubIssueMappings).values({
            id: mappingId,
            taskId,
            projectId,
            integrationId: integration.id,
            githubIssueNumber: issue.number,
            githubIssueId: issue.id,
            githubIssueUrl: issue.html_url,
            lastLocalStatus: status,
            lastGithubState: issue.state,
            lastSyncedAt: new Date(),
          });

          result.imported++;
        }
      } catch (error) {
        result.errors.push(
          `Issue #${issue.number}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    // Update last sync time
    await db
      .update(schema.githubIntegrations)
      .set({ lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.githubIntegrations.id, integration.id));

    // Log the operation
    await logSyncOperation(integration.id, "import", result);
  } catch (error) {
    result.success = false;
    result.errors.push(
      `Failed to fetch issues: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    await logSyncOperation(integration.id, "import", result);
  }

  return result;
}

// Export task status changes to GitHub
async function exportStatus(
  session: Session,
  projectId: string,
  taskId?: string
): Promise<GitHubExportResult> {
  const integration = await getIntegrationWithToken(session, projectId);

  if (!integration) {
    throw new Error("No GitHub integration configured");
  }

  if (!integration.accessToken) {
    throw new Error("No access token configured");
  }

  if (integration.syncDirection === "import_only") {
    throw new Error("Export is disabled for this integration (import_only mode)");
  }

  const client = createGitHubClient({
    accessToken: integration.accessToken,
    owner: integration.owner,
    repo: integration.repo,
  });

  const result: GitHubExportResult = {
    success: true,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Get tasks and their mappings
    const tasks = await getTasks(session, projectId);

    // Filter to specific task if provided
    const targetTasks = taskId
      ? tasks.filter((t) => t.id === taskId)
      : tasks;

    // Get all mappings for this project
    const mappings = await db.query.githubIssueMappings.findMany({
      where: eq(schema.githubIssueMappings.projectId, projectId),
    });

    const mappingsByTaskId = new Map(mappings.map((m) => [m.taskId, m]));

    for (const task of targetTasks) {
      try {
        const mapping = mappingsByTaskId.get(task.id);
        const newGitHubState = taskStatusToGitHubState(task.status);

        if (mapping) {
          // Has existing mapping - check if status changed
          const currentGitHubState = mapping.lastGithubState;

          if (currentGitHubState !== newGitHubState) {
            // Update GitHub issue state
            await client.updateIssue(mapping.githubIssueNumber, {
              state: newGitHubState,
            });

            // Update mapping
            await db
              .update(schema.githubIssueMappings)
              .set({
                lastLocalStatus: task.status,
                lastGithubState: newGitHubState,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(schema.githubIssueMappings.id, mapping.id));

            result.updated++;
          } else {
            result.skipped++;
          }
        } else {
          // No mapping - create new GitHub issue if bidirectional
          if (integration.syncDirection === "bidirectional") {
            const issue = await client.createIssue({
              title: task.title,
              body: task.description || undefined,
            });

            // Close if task is done
            if (newGitHubState === "closed") {
              await client.closeIssue(issue.number);
            }

            // Create mapping
            const mappingId = nanoid();
            await db.insert(schema.githubIssueMappings).values({
              id: mappingId,
              taskId: task.id,
              projectId,
              integrationId: integration.id,
              githubIssueNumber: issue.number,
              githubIssueId: issue.id,
              githubIssueUrl: issue.html_url,
              lastLocalStatus: task.status,
              lastGithubState: newGitHubState,
              lastSyncedAt: new Date(),
            });

            result.created++;
          } else {
            result.skipped++;
          }
        }
      } catch (error) {
        result.errors.push(
          `Task ${task.id}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    // Update last sync time
    await db
      .update(schema.githubIntegrations)
      .set({ lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.githubIntegrations.id, integration.id));

    // Log the operation
    await logSyncOperation(integration.id, "export", result);
  } catch (error) {
    result.success = false;
    result.errors.push(
      `Failed to export: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    await logSyncOperation(integration.id, "export", result);
  }

  return result;
}

// Get issue mappings for a project
async function getMappings(session: Session, projectId: string) {
  await verifyProjectAccess(session, projectId);

  const mappings = await db.query.githubIssueMappings.findMany({
    where: eq(schema.githubIssueMappings.projectId, projectId),
  });

  return mappings.map(transformMapping);
}

// Get mapping for a specific task
async function getTaskMapping(
  session: Session,
  projectId: string,
  taskId: string
) {
  await verifyProjectAccess(session, projectId);

  const mapping = await db.query.githubIssueMappings.findFirst({
    where: and(
      eq(schema.githubIssueMappings.projectId, projectId),
      eq(schema.githubIssueMappings.taskId, taskId)
    ),
  });

  return mapping ? transformMapping(mapping) : null;
}

// Get sync logs for an integration
async function getSyncLogs(
  session: Session,
  projectId: string,
  limit = 50
) {
  const integration = await getIntegration(session, projectId);

  if (!integration) {
    throw new Error("No GitHub integration configured");
  }

  const logs = await db.query.githubSyncLogs.findMany({
    where: eq(schema.githubSyncLogs.integrationId, integration.id),
    orderBy: (logs, { desc }) => [desc(logs.createdAt)],
    limit,
  });

  return logs.map(transformLog);
}

// Log a sync operation
async function logSyncOperation(
  integrationId: string,
  operation: "import" | "export" | "webhook",
  result: GitHubImportResult | GitHubExportResult
) {
  const id = nanoid();
  await db.insert(schema.githubSyncLogs).values({
    id,
    integrationId,
    operation,
    status: result.success
      ? result.errors.length > 0
        ? "partial"
        : "success"
      : "failed",
    details: JSON.stringify(result),
    errorMessage:
      result.errors.length > 0 ? result.errors.join("; ") : null,
    itemsProcessed:
      "imported" in result
        ? result.imported + result.updated
        : result.created + result.updated,
  });
}

// Route handler
export function handleGitHubRoutes(
  req: Request,
  session: Session
): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/projects/:projectId/github
  const integrationMatch = path.match(/^\/api\/projects\/([^/]+)\/github$/);
  if (integrationMatch && method === "GET") {
    const projectId = integrationMatch[1]!;
    return getIntegration(session, projectId)
      .then((integration) => Response.json(integration))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // POST /api/projects/:projectId/github
  if (integrationMatch && method === "POST") {
    const projectId = integrationMatch[1]!;
    return req
      .json()
      .then((data) =>
        upsertIntegration(session, projectId, data)
          .then((result) => Response.json(result, { status: 201 }))
          .catch((err) => Response.json({ error: err.message }, { status: 400 }))
      );
  }

  // DELETE /api/projects/:projectId/github
  if (integrationMatch && method === "DELETE") {
    const projectId = integrationMatch[1]!;
    return deleteIntegration(session, projectId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // POST /api/projects/:projectId/github/test
  const testMatch = path.match(/^\/api\/projects\/([^/]+)\/github\/test$/);
  if (testMatch && method === "POST") {
    const projectId = testMatch[1]!;
    return testConnection(session, projectId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 400 }));
  }

  // POST /api/projects/:projectId/github/import
  const importMatch = path.match(/^\/api\/projects\/([^/]+)\/github\/import$/);
  if (importMatch && method === "POST") {
    const projectId = importMatch[1]!;
    return req
      .json()
      .then((options) =>
        importIssues(session, projectId, options)
          .then((result) => Response.json(result))
          .catch((err) =>
            Response.json({ error: err.message }, { status: 400 })
          )
      )
      .catch(() =>
        importIssues(session, projectId)
          .then((result) => Response.json(result))
          .catch((err) =>
            Response.json({ error: err.message }, { status: 400 })
          )
      );
  }

  // POST /api/projects/:projectId/github/export
  const exportMatch = path.match(/^\/api\/projects\/([^/]+)\/github\/export$/);
  if (exportMatch && method === "POST") {
    const projectId = exportMatch[1]!;
    return req
      .json()
      .then((data) =>
        exportStatus(session, projectId, data.taskId)
          .then((result) => Response.json(result))
          .catch((err) =>
            Response.json({ error: err.message }, { status: 400 })
          )
      )
      .catch(() =>
        exportStatus(session, projectId)
          .then((result) => Response.json(result))
          .catch((err) =>
            Response.json({ error: err.message }, { status: 400 })
          )
      );
  }

  // GET /api/projects/:projectId/github/mappings
  const mappingsMatch = path.match(
    /^\/api\/projects\/([^/]+)\/github\/mappings$/
  );
  if (mappingsMatch && method === "GET") {
    const projectId = mappingsMatch[1]!;
    return getMappings(session, projectId)
      .then((mappings) => Response.json(mappings))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // GET /api/projects/:projectId/github/mappings/:taskId
  const taskMappingMatch = path.match(
    /^\/api\/projects\/([^/]+)\/github\/mappings\/([^/]+)$/
  );
  if (taskMappingMatch && method === "GET") {
    const projectId = taskMappingMatch[1]!;
    const taskId = taskMappingMatch[2]!;
    return getTaskMapping(session, projectId, taskId)
      .then((mapping) => Response.json(mapping))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // GET /api/projects/:projectId/github/logs
  const logsMatch = path.match(/^\/api\/projects\/([^/]+)\/github\/logs$/);
  if (logsMatch && method === "GET") {
    const projectId = logsMatch[1]!;
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    return getSyncLogs(session, projectId, limit)
      .then((logs) => Response.json(logs))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  return null;
}

// Export for use in webhook handler
export {
  getIntegrationWithToken,
  importIssues,
  exportStatus,
  logSyncOperation,
  taskStatusToGitHubState,
  githubStateToTaskStatus,
};
