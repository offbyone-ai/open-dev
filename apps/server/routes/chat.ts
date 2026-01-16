import { db, schema } from "../db";
import { eq, and, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import type { Session } from "../auth";
import { createAIProvider } from "../ai";
import { createTaskTools, type TaskToolCall } from "../ai/tools";
import { buildSystemPrompt } from "../ai/prompts";
import { createTask, updateTask, deleteTask, getTasks } from "./tasks";

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

export async function getChatMessages(session: Session, projectId: string) {
  await verifyProjectAccess(session, projectId);
  return db.query.chatMessages.findMany({
    where: eq(schema.chatMessages.projectId, projectId),
    orderBy: [asc(schema.chatMessages.createdAt)],
  });
}

export async function saveChatMessage(
  projectId: string,
  data: {
    role: "user" | "assistant";
    content: string;
    proposedChanges?: string;
    changeStatus?: "pending" | "approved" | "denied" | "edited";
  }
) {
  const id = nanoid();
  await db.insert(schema.chatMessages).values({
    id,
    projectId,
    role: data.role,
    content: data.content,
    proposedChanges: data.proposedChanges,
    changeStatus: data.changeStatus,
  });
  return { id };
}

export async function updateMessageStatus(
  messageId: string,
  status: "approved" | "denied" | "edited"
) {
  await db
    .update(schema.chatMessages)
    .set({ changeStatus: status, updatedAt: new Date() })
    .where(eq(schema.chatMessages.id, messageId));
}

export async function handleChat(
  session: Session,
  projectId: string,
  incomingMessages: UIMessage[]
): Promise<Response> {
  const project = await verifyProjectAccess(session, projectId);

  // Get AI provider
  if (!project.aiProviderId) {
    return Response.json(
      { error: "No AI provider configured for this project" },
      { status: 400 }
    );
  }

  const aiProvider = await db.query.aiProviders.findFirst({
    where: and(
      eq(schema.aiProviders.id, project.aiProviderId),
      eq(schema.aiProviders.userId, session.user.id)
    ),
  });

  if (!aiProvider) {
    return Response.json({ error: "AI provider not found" }, { status: 400 });
  }

  // Get tasks for context
  const tasks = await getTasks(session, projectId);

  // Create AI provider and stream
  const model = createAIProvider(aiProvider);
  const systemPrompt = buildSystemPrompt(project.guidelines, tasks);

  // Create tools with execute functions bound to this session/project
  const tools = createTaskTools(session, projectId, {
    createTask,
    updateTask,
    deleteTask,
    getTasks,
  });

  // Convert UI messages to model messages
  const modelMessages = await convertToModelMessages(incomingMessages);

  const result = streamText({
    model,
    system: systemPrompt,
    messages: modelMessages,
    tools,
  });

  // Return streaming response in UI message stream format
  return result.toUIMessageStreamResponse();
}

export async function executeToolCalls(
  session: Session,
  projectId: string,
  toolCalls: TaskToolCall[]
) {
  const results: Array<{ toolCallId: string; success: boolean; result?: unknown; error?: string }> = [];

  for (const call of toolCalls) {
    try {
      let result: unknown;

      switch (call.toolName) {
        case "createTask":
          result = await createTask(session, projectId, call.args as {
            title: string;
            description?: string;
            status?: "backlog" | "in_progress" | "done";
            priority?: "low" | "medium" | "high";
          });
          break;

        case "updateTask":
          const updateArgs = call.args as {
            taskId: string;
            title?: string;
            description?: string;
            status?: "backlog" | "in_progress" | "done";
            priority?: "low" | "medium" | "high";
          };
          result = await updateTask(session, projectId, updateArgs.taskId, {
            title: updateArgs.title,
            description: updateArgs.description,
            status: updateArgs.status,
            priority: updateArgs.priority,
          });
          break;

        case "deleteTask":
          const deleteArgs = call.args as { taskId: string };
          result = await deleteTask(session, projectId, deleteArgs.taskId);
          break;

        case "listTasks":
          result = await getTasks(session, projectId);
          break;
      }

      results.push({ toolCallId: call.toolCallId, success: true, result });
    } catch (err) {
      results.push({
        toolCallId: call.toolCallId,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return results;
}

export function handleChatRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/projects/:projectId/chat
  const chatMatch = path.match(/^\/api\/projects\/([^/]+)\/chat$/);
  if (chatMatch && method === "GET") {
    const projectId = chatMatch[1]!;
    return getChatMessages(session, projectId)
      .then((messages) => Response.json(messages))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // POST /api/projects/:projectId/chat
  if (chatMatch && method === "POST") {
    const projectId = chatMatch[1]!;
    return req.json().then((data) => handleChat(session, projectId, data.messages));
  }

  // POST /api/projects/:projectId/chat/execute
  const executeMatch = path.match(/^\/api\/projects\/([^/]+)\/chat\/execute$/);
  if (executeMatch && method === "POST") {
    const projectId = executeMatch[1]!;
    return req.json().then((data) =>
      executeToolCalls(session, projectId, data.toolCalls)
        .then((results) => Response.json(results))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }))
    );
  }

  // POST /api/projects/:projectId/chat/save-assistant
  const saveMatch = path.match(/^\/api\/projects\/([^/]+)\/chat\/save-assistant$/);
  if (saveMatch && method === "POST") {
    const projectId = saveMatch[1]!;
    return req.json().then((data) =>
      saveChatMessage(projectId, {
        role: "assistant",
        content: data.content,
        proposedChanges: data.proposedChanges,
        changeStatus: data.proposedChanges ? "pending" : undefined,
      })
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }))
    );
  }

  // PUT /api/projects/:projectId/chat/:messageId/status
  const statusMatch = path.match(/^\/api\/projects\/([^/]+)\/chat\/([^/]+)\/status$/);
  if (statusMatch && method === "PUT") {
    const messageId = statusMatch[2]!;
    return req.json().then((data) =>
      updateMessageStatus(messageId, data.status)
        .then(() => Response.json({ success: true }))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }))
    );
  }

  return null;
}
