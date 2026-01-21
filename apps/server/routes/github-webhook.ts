/**
 * GitHub Webhook Handler
 *
 * Handles incoming webhook events from GitHub.
 * This route does NOT require authentication - it uses webhook signature verification.
 */

import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { GitHubWebhookPayload, GitHubIssue } from "@open-dev/shared";
import { githubStateToTaskStatus, logSyncOperation } from "./github";

/**
 * Verify the webhook signature using HMAC-SHA256
 */
async function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  // GitHub sends the signature as "sha256=<hex>"
  const expectedPrefix = "sha256=";
  if (!signature.startsWith(expectedPrefix)) {
    return false;
  }

  const signatureHex = signature.slice(expectedPrefix.length);

  // Create HMAC-SHA256 hash
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  // Convert to hex
  const computedSignature = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Timing-safe comparison
  return timingSafeEqual(signatureHex, computedSignature);
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Find integration by owner/repo
 */
async function findIntegration(owner: string, repo: string) {
  return db.query.githubIntegrations.findFirst({
    where: and(
      eq(schema.githubIntegrations.owner, owner),
      eq(schema.githubIntegrations.repo, repo),
      eq(schema.githubIntegrations.enabled, true)
    ),
  });
}

/**
 * Handle issue events from GitHub
 */
async function handleIssueEvent(
  payload: GitHubWebhookPayload,
  integration: typeof schema.githubIntegrations.$inferSelect
) {
  if (!payload.issue) {
    return { processed: false, reason: "No issue in payload" };
  }

  const issue = payload.issue as GitHubIssue;
  const action = payload.action;

  // Only process if auto-sync is enabled
  if (!integration.autoSync) {
    return { processed: false, reason: "Auto-sync disabled" };
  }

  // Check sync direction allows import
  if (integration.syncDirection === "export_only") {
    return { processed: false, reason: "Import disabled (export_only mode)" };
  }

  // Find existing mapping
  const mapping = await db.query.githubIssueMappings.findFirst({
    where: and(
      eq(schema.githubIssueMappings.integrationId, integration.id),
      eq(schema.githubIssueMappings.githubIssueNumber, issue.number)
    ),
  });

  if (action === "opened" || action === "reopened") {
    // New issue or reopened - create or update task
    if (mapping) {
      // Update existing task status to backlog if reopened
      const newStatus = githubStateToTaskStatus(issue.state, mapping.lastLocalStatus || undefined);

      await db
        .update(schema.tasks)
        .set({
          title: issue.title,
          description: issue.body,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.tasks.id, mapping.taskId));

      await db
        .update(schema.githubIssueMappings)
        .set({
          lastGithubState: issue.state,
          lastLocalStatus: newStatus,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.githubIssueMappings.id, mapping.id));

      return { processed: true, action: "updated", taskId: mapping.taskId };
    } else {
      // Create new task
      const taskId = nanoid();
      const status = githubStateToTaskStatus(issue.state);

      // Get max position for backlog
      const existingTasks = await db.query.tasks.findMany({
        where: and(
          eq(schema.tasks.projectId, integration.projectId),
          eq(schema.tasks.status, status)
        ),
      });
      const maxPosition = Math.max(-1, ...existingTasks.map((t) => t.position));

      await db.insert(schema.tasks).values({
        id: taskId,
        title: issue.title,
        description: issue.body,
        status,
        priority: "medium",
        position: maxPosition + 1,
        projectId: integration.projectId,
        dependsOn: "[]",
      });

      // Create mapping
      const mappingId = nanoid();
      await db.insert(schema.githubIssueMappings).values({
        id: mappingId,
        taskId,
        projectId: integration.projectId,
        integrationId: integration.id,
        githubIssueNumber: issue.number,
        githubIssueId: issue.id,
        githubIssueUrl: issue.html_url,
        lastLocalStatus: status,
        lastGithubState: issue.state,
        lastSyncedAt: new Date(),
      });

      return { processed: true, action: "created", taskId };
    }
  } else if (action === "closed") {
    // Issue closed - update task status
    if (mapping) {
      const newStatus = githubStateToTaskStatus("closed", mapping.lastLocalStatus || undefined);

      await db
        .update(schema.tasks)
        .set({
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.tasks.id, mapping.taskId));

      await db
        .update(schema.githubIssueMappings)
        .set({
          lastGithubState: "closed",
          lastLocalStatus: newStatus,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.githubIssueMappings.id, mapping.id));

      return { processed: true, action: "closed", taskId: mapping.taskId };
    }
    return { processed: false, reason: "No mapping found for closed issue" };
  } else if (action === "edited") {
    // Issue edited - update task title/description
    if (mapping) {
      await db
        .update(schema.tasks)
        .set({
          title: issue.title,
          description: issue.body,
          updatedAt: new Date(),
        })
        .where(eq(schema.tasks.id, mapping.taskId));

      await db
        .update(schema.githubIssueMappings)
        .set({
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.githubIssueMappings.id, mapping.id));

      return { processed: true, action: "edited", taskId: mapping.taskId };
    }
    return { processed: false, reason: "No mapping found for edited issue" };
  } else if (action === "deleted") {
    // Issue deleted - optionally delete task (or just log)
    if (mapping) {
      // For safety, we'll just remove the mapping but keep the task
      await db
        .delete(schema.githubIssueMappings)
        .where(eq(schema.githubIssueMappings.id, mapping.id));

      return { processed: true, action: "mapping_removed", taskId: mapping.taskId };
    }
    return { processed: false, reason: "No mapping found for deleted issue" };
  }

  return { processed: false, reason: `Unhandled action: ${action}` };
}

/**
 * Main webhook handler route
 * This is called without authentication - uses signature verification instead
 */
export async function handleWebhook(req: Request): Promise<Response> {
  // Get the raw body for signature verification
  const body = await req.text();

  // Parse the payload
  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Get event type from header
  const eventType = req.headers.get("x-github-event");
  if (!eventType) {
    return Response.json(
      { error: "Missing X-GitHub-Event header" },
      { status: 400 }
    );
  }

  // Get repository info
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;

  if (!owner || !repo) {
    return Response.json(
      { error: "Missing repository information" },
      { status: 400 }
    );
  }

  // Find the integration
  const integration = await findIntegration(owner, repo);
  if (!integration) {
    // No integration found - that's okay, just acknowledge
    return Response.json({
      ok: true,
      processed: false,
      reason: "No matching integration found",
    });
  }

  // Verify signature if webhook secret is configured
  if (integration.webhookSecret) {
    const signature = req.headers.get("x-hub-signature-256");
    const isValid = await verifyWebhookSignature(
      body,
      signature,
      integration.webhookSecret
    );

    if (!isValid) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // Handle different event types
  let result: { processed: boolean; action?: string; reason?: string; taskId?: string };

  switch (eventType) {
    case "issues":
      result = await handleIssueEvent(payload, integration);
      break;
    case "ping":
      // GitHub sends this when webhook is first configured
      result = { processed: true, action: "ping acknowledged" };
      break;
    default:
      result = { processed: false, reason: `Unhandled event type: ${eventType}` };
  }

  // Log the webhook event
  if (eventType === "issues") {
    await logSyncOperation(integration.id, "webhook", {
      success: result.processed,
      imported: result.action === "created" ? 1 : 0,
      updated: ["updated", "edited", "closed"].includes(result.action || "") ? 1 : 0,
      skipped: result.processed ? 0 : 1,
      errors: result.reason ? [result.reason] : [],
    });
  }

  return Response.json({ ok: true, ...result });
}

/**
 * Route handler for webhook endpoint
 * Note: This is called directly from index.ts before auth middleware
 */
export function handleGitHubWebhookRoutes(req: Request): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // POST /api/github/webhook
  if (path === "/api/github/webhook" && method === "POST") {
    return handleWebhook(req);
  }

  return null;
}
