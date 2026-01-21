import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import type { Session } from "../auth";
import { fileWatcherRegistry, type FileChangeEvent, type FileWatcherOptions } from "../services/file-watcher";

// Verify project access and return project
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

// Create SSE response with proper headers
function createSSEResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Send SSE event
function sendSSEEvent(
  controller: ReadableStreamDefaultController,
  event: string,
  data: unknown
) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

// Start file watching for a project - streams file changes via SSE
export async function startFileWatch(
  session: Session,
  projectId: string
): Promise<Response> {
  const project = await verifyProjectAccess(session, projectId);

  if (!project.workingDirectory) {
    return Response.json(
      { error: "Working directory not configured" },
      { status: 400 }
    );
  }

  const workingDirectory = project.workingDirectory;

  // Get or create file watcher for this project
  const watcher = fileWatcherRegistry.getOrCreate(projectId, workingDirectory);

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial status
      sendSSEEvent(controller, "status", {
        watching: true,
        workingDirectory,
        projectId,
      });

      // Subscribe to file changes
      const unsubscribe = watcher.subscribe((event: FileChangeEvent) => {
        sendSSEEvent(controller, "change", event);
      });

      // Start watching if not already
      try {
        await watcher.start();
      } catch (error) {
        sendSSEEvent(controller, "error", {
          error: String(error),
        });
        controller.close();
        return;
      }

      // Keep connection alive with heartbeat
      const heartbeatInterval = setInterval(() => {
        try {
          sendSSEEvent(controller, "heartbeat", { timestamp: Date.now() });
        } catch {
          // Connection closed
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Handle connection close
      // Note: In a real implementation, you'd want to handle client disconnect
      // For now, we rely on the heartbeat failing when the connection is closed
    },
  });

  return createSSEResponse(stream);
}

// Stop file watching for a project
export async function stopFileWatch(
  session: Session,
  projectId: string
): Promise<{ success: boolean }> {
  await verifyProjectAccess(session, projectId);
  fileWatcherRegistry.stop(projectId);
  return { success: true };
}

// Get file watcher status for a project
export async function getFileWatchStatus(
  session: Session,
  projectId: string
): Promise<{ watching: boolean; workingDirectory: string | null }> {
  const project = await verifyProjectAccess(session, projectId);
  const watcher = fileWatcherRegistry.get(projectId);

  return {
    watching: watcher?.isActive() ?? false,
    workingDirectory: watcher?.getWorkingDirectory() ?? project.workingDirectory,
  };
}

// Route handler
export function handleFileWatcherRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const urlPath = url.pathname;
  const method = req.method;

  // GET /api/projects/:projectId/file-watcher/watch - SSE endpoint
  const watchMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/file-watcher\/watch$/);
  if (watchMatch && method === "GET") {
    const projectId = watchMatch[1]!;
    return startFileWatch(session, projectId);
  }

  // POST /api/projects/:projectId/file-watcher/stop
  const stopMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/file-watcher\/stop$/);
  if (stopMatch && method === "POST") {
    const projectId = stopMatch[1]!;
    return stopFileWatch(session, projectId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 400 }));
  }

  // GET /api/projects/:projectId/file-watcher/status
  const statusMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/file-watcher\/status$/);
  if (statusMatch && method === "GET") {
    const projectId = statusMatch[1]!;
    return getFileWatchStatus(session, projectId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 400 }));
  }

  return null;
}
