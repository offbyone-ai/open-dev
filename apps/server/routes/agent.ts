import { db, schema, sqlite } from "../db";
import { eq, and, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { generateText, stepCountIs } from "ai";
import type { Session } from "../auth";
import { createAIProvider } from "../ai";
import { createAgentTools, type ActionParams, type ToolApprovalSettings, DEFAULT_TOOL_APPROVAL_SETTINGS } from "../ai/agent-tools";
import { createAgentSystemPrompt } from "../ai/agent-prompts";
import {
  executeReadFile,
  executeListDirectory,
  executeWriteFile,
  executeEditFile,
  executeDeleteFile,
  executeCommand,
  executeAction,
  validatePath,
} from "../ai/agent-executor";
import type { AgentAction, AgentExecution, Task, Project } from "../db/schema";

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

// Get task and verify access
async function getTask(session: Session, projectId: string, taskId: string) {
  await verifyProjectAccess(session, projectId);
  const task = await db.query.tasks.findFirst({
    where: and(
      eq(schema.tasks.id, taskId),
      eq(schema.tasks.projectId, projectId)
    ),
  });
  if (!task) {
    throw new Error("Task not found");
  }
  return task;
}

// Update working directory
export async function updateWorkingDirectory(
  session: Session,
  projectId: string,
  workingDirectory: string,
  confirmed: boolean
) {
  console.log("[updateWorkingDirectory] Called with:", { projectId, workingDirectory, confirmed });

  await verifyProjectAccess(session, projectId);

  // Validate the path exists
  const file = Bun.file(workingDirectory);
  // Check if directory exists by trying to access it
  try {
    const glob = new Bun.Glob("*");
    // Just try to access - will throw if path doesn't exist
    for await (const _ of glob.scan({ cwd: workingDirectory, onlyFiles: false })) {
      break; // Only need to check first entry
    }
  } catch {
    console.log("[updateWorkingDirectory] Directory validation failed");
    throw new Error("Directory does not exist or is not accessible");
  }

  console.log("[updateWorkingDirectory] Updating database with raw SQL...");
  console.log("[updateWorkingDirectory] workingDirectory:", workingDirectory);
  console.log("[updateWorkingDirectory] confirmed:", confirmed);
  console.log("[updateWorkingDirectory] projectId:", projectId);

  // Use raw SQL to debug the issue
  const stmt = sqlite.prepare(
    "UPDATE projects SET working_directory = ?, working_directory_confirmed = ?, updated_at = ? WHERE id = ?"
  );
  const updateResult = stmt.run(workingDirectory, confirmed ? 1 : 0, Date.now(), projectId);
  console.log("[updateWorkingDirectory] Update result (changes):", updateResult.changes);

  // Verify the update worked
  const verifyStmt = sqlite.prepare("SELECT working_directory, working_directory_confirmed FROM projects WHERE id = ?");
  const row = verifyStmt.get(projectId);
  console.log("[updateWorkingDirectory] After update, row:", row);

  return { success: true };
}

// Get execution with actions
export async function getExecution(session: Session, executionId: string) {
  const execution = await db.query.agentExecutions.findFirst({
    where: eq(schema.agentExecutions.id, executionId),
  });

  if (!execution) {
    throw new Error("Execution not found");
  }

  await verifyProjectAccess(session, execution.projectId);

  const actions = await db.query.agentActions.findMany({
    where: eq(schema.agentActions.executionId, executionId),
    orderBy: [asc(schema.agentActions.sequence)],
  });

  return { execution, actions };
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

// Start agent execution - streams progress via SSE
export async function startAgentExecution(
  session: Session,
  projectId: string,
  taskId: string
): Promise<Response> {
  const project = await verifyProjectAccess(session, projectId);
  const task = await getTask(session, projectId, taskId);

  // Verify working directory is configured and confirmed
  if (!project.workingDirectory || !project.workingDirectoryConfirmed) {
    return Response.json(
      { error: "Working directory not configured or confirmed" },
      { status: 400 }
    );
  }

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

  // Create execution record
  const executionId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: executionId,
    taskId,
    projectId,
    status: "analyzing",
  });

  let actionSequence = 0;

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial status
        sendSSEEvent(controller, "status", {
          executionId,
          status: "analyzing",
        });

        // Create AI model
        const model = createAIProvider(aiProvider);
        const systemPrompt = createAgentSystemPrompt(project, task);

        // Parse tool approval settings from project
        const approvalSettings: ToolApprovalSettings = project.toolApprovalSettings
          ? JSON.parse(project.toolApprovalSettings)
          : DEFAULT_TOOL_APPROVAL_SETTINGS;

        // Helper to create an immediate execution callback
        const createImmediateCallback = <T extends keyof ActionParams>(
          actionType: T,
          executeFn: (workingDir: string, params: ActionParams[T]) => Promise<{ success: boolean; output?: string; error?: string }>
        ) => async (params: ActionParams[T]) => {
          const result = await executeFn(project.workingDirectory!, params);

          // Store action as completed
          const actionId = nanoid();
          actionSequence++;
          await db.insert(schema.agentActions).values({
            id: actionId,
            executionId,
            actionType,
            actionParams: JSON.stringify(params),
            status: "completed",
            result: JSON.stringify(result),
            sequence: actionSequence,
          });

          sendSSEEvent(controller, "action", {
            id: actionId,
            type: actionType,
            params,
            status: "completed",
            result,
          });

          return result.success ? result.output! : `Error: ${result.error}`;
        };

        // Create tools with callbacks
        const tools = createAgentTools({
          // All tool callbacks - will be called based on approval settings
          onReadFile: createImmediateCallback("readFile", executeReadFile),
          onListDirectory: createImmediateCallback("listDirectory", executeListDirectory),
          onWriteFile: createImmediateCallback("writeFile", executeWriteFile),
          onEditFile: createImmediateCallback("editFile", executeEditFile),
          onDeleteFile: createImmediateCallback("deleteFile", executeDeleteFile),
          onExecuteCommand: createImmediateCallback("executeCommand", executeCommand),
          onCompleteTask: async (params) => {
            // For completeTask, we need to update the task status immediately
            const actionId = nanoid();
            actionSequence++;
            await db.insert(schema.agentActions).values({
              id: actionId,
              executionId,
              actionType: "completeTask",
              actionParams: JSON.stringify(params),
              status: "completed",
              result: JSON.stringify({ success: true, output: params.summary }),
              sequence: actionSequence,
            });

            // Update task status to validation (user needs to review agent's work)
            await db
              .update(schema.tasks)
              .set({
                status: "validation",
                updatedAt: new Date(),
              })
              .where(eq(schema.tasks.id, task.id));

            sendSSEEvent(controller, "action", {
              id: actionId,
              type: "completeTask",
              params,
              status: "completed",
              result: { success: true, output: params.summary },
            });

            sendSSEEvent(controller, "taskCompleted", { taskId: task.id });

            return `Task moved to validation: ${params.summary}`;
          },

          // Propose action - for tools that require approval
          onProposeAction: async (actionType, params) => {
            const actionId = nanoid();
            actionSequence++;
            await db.insert(schema.agentActions).values({
              id: actionId,
              executionId,
              actionType,
              actionParams: JSON.stringify(params),
              status: "proposed",
              sequence: actionSequence,
            });

            sendSSEEvent(controller, "action", {
              id: actionId,
              type: actionType,
              params,
              status: "proposed",
            });
          },

          // Pass approval settings
          approvalSettings,
        });

        // Run the agent (non-streaming for better LM Studio compatibility)
        console.log("[Agent] Starting generateText...");
        const result = await generateText({
          model,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: `Please complete this task: ${task.title}\n\n${task.description || ""}`,
            },
          ],
          tools,
          stopWhen: stepCountIs(20), // Allow up to 20 tool call rounds
        });

        console.log("[Agent] generateText completed");
        console.log("[Agent] Text:", result.text?.slice(0, 200));
        console.log("[Agent] Steps:", result.steps?.length);
        console.log("[Agent] Tool calls:", result.toolCalls?.length);

        // Send text response if any
        if (result.text) {
          sendSSEEvent(controller, "text", { content: result.text });
        }

        // Check if we got any response
        const hasContent = result.text || (result.toolCalls && result.toolCalls.length > 0) || actionSequence > 0;
        if (!hasContent) {
          throw new Error("No response from AI model - the model may not support tool calling or there was an API error");
        }

        // Update execution status
        await db
          .update(schema.agentExecutions)
          .set({
            status: "awaiting_approval",
            updatedAt: new Date(),
          })
          .where(eq(schema.agentExecutions.id, executionId));

        sendSSEEvent(controller, "status", {
          executionId,
          status: "awaiting_approval",
        });

        sendSSEEvent(controller, "done", { executionId });
        controller.close();
      } catch (error) {
        console.error("Agent execution error:", error);

        // Update execution status to failed
        await db
          .update(schema.agentExecutions)
          .set({
            status: "failed",
            errorMessage: String(error),
            updatedAt: new Date(),
          })
          .where(eq(schema.agentExecutions.id, executionId));

        sendSSEEvent(controller, "error", {
          executionId,
          error: String(error),
        });

        controller.close();
      }
    },
  });

  return createSSEResponse(stream);
}

// Approve or reject actions
export async function updateActionStatus(
  session: Session,
  executionId: string,
  actionIds: string[],
  status: "approved" | "rejected"
) {
  const { execution } = await getExecution(session, executionId);

  if (execution.status !== "awaiting_approval") {
    throw new Error("Execution is not awaiting approval");
  }

  for (const actionId of actionIds) {
    await db
      .update(schema.agentActions)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.agentActions.id, actionId),
          eq(schema.agentActions.executionId, executionId)
        )
      );
  }

  return { success: true };
}

// Execute approved actions - streams progress via SSE
export async function executeApprovedActions(
  session: Session,
  executionId: string
): Promise<Response> {
  const { execution, actions } = await getExecution(session, executionId);
  const project = await verifyProjectAccess(session, execution.projectId);

  if (execution.status !== "awaiting_approval") {
    return Response.json(
      { error: "Execution is not awaiting approval" },
      { status: 400 }
    );
  }

  if (!project.workingDirectory) {
    return Response.json(
      { error: "Working directory not configured" },
      { status: 400 }
    );
  }

  const approvedActions = actions.filter((a) => a.status === "approved");

  if (approvedActions.length === 0) {
    return Response.json({ error: "No approved actions to execute" }, { status: 400 });
  }

  // Update execution status
  await db
    .update(schema.agentExecutions)
    .set({
      status: "executing",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentExecutions.id, executionId));

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        sendSSEEvent(controller, "status", {
          executionId,
          status: "executing",
        });

        let allSucceeded = true;
        let hasCompleteTask = false;

        for (const action of approvedActions) {
          sendSSEEvent(controller, "executing", { actionId: action.id });

          // Update action status
          await db
            .update(schema.agentActions)
            .set({
              status: "executing",
              updatedAt: new Date(),
            })
            .where(eq(schema.agentActions.id, action.id));

          const params = JSON.parse(action.actionParams);

          if (action.actionType === "completeTask") {
            hasCompleteTask = true;
            // Mark as completed
            await db
              .update(schema.agentActions)
              .set({
                status: "completed",
                result: JSON.stringify({ success: true, output: params.summary }),
                updatedAt: new Date(),
              })
              .where(eq(schema.agentActions.id, action.id));

            sendSSEEvent(controller, "actionComplete", {
              actionId: action.id,
              success: true,
              result: { success: true, output: params.summary },
            });
          } else {
            // Execute the action
            const result = await executeAction(
              project.workingDirectory!,
              action.actionType,
              params
            );

            // Update action with result
            await db
              .update(schema.agentActions)
              .set({
                status: result.success ? "completed" : "failed",
                result: JSON.stringify(result),
                updatedAt: new Date(),
              })
              .where(eq(schema.agentActions.id, action.id));

            sendSSEEvent(controller, "actionComplete", {
              actionId: action.id,
              success: result.success,
              result,
            });

            if (!result.success) {
              allSucceeded = false;
            }
          }
        }

        // Update task status if completeTask was approved and executed
        // Move to validation instead of done - user needs to review agent's work
        if (hasCompleteTask && allSucceeded) {
          await db
            .update(schema.tasks)
            .set({
              status: "validation",
              updatedAt: new Date(),
            })
            .where(eq(schema.tasks.id, execution.taskId));

          sendSSEEvent(controller, "taskCompleted", { taskId: execution.taskId });
        }

        // Update execution status
        const finalStatus = allSucceeded ? "completed" : "failed";
        await db
          .update(schema.agentExecutions)
          .set({
            status: finalStatus,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.agentExecutions.id, executionId));

        sendSSEEvent(controller, "status", {
          executionId,
          status: finalStatus,
        });

        sendSSEEvent(controller, "done", { executionId });
        controller.close();
      } catch (error) {
        console.error("Action execution error:", error);

        await db
          .update(schema.agentExecutions)
          .set({
            status: "failed",
            errorMessage: String(error),
            updatedAt: new Date(),
          })
          .where(eq(schema.agentExecutions.id, executionId));

        sendSSEEvent(controller, "error", {
          executionId,
          error: String(error),
        });

        controller.close();
      }
    },
  });

  return createSSEResponse(stream);
}

// Update tool approval settings
export async function updateToolApprovalSettings(
  session: Session,
  projectId: string,
  settings: ToolApprovalSettings
) {
  console.log("[updateToolApprovalSettings] Called with:", { projectId, settings });

  await verifyProjectAccess(session, projectId);

  const result = await db
    .update(schema.projects)
    .set({
      toolApprovalSettings: JSON.stringify(settings),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  console.log("[updateToolApprovalSettings] Update result:", result);

  // Verify the update worked
  const verifyStmt = sqlite.prepare("SELECT tool_approval_settings FROM projects WHERE id = ?");
  const row = verifyStmt.get(projectId);
  console.log("[updateToolApprovalSettings] After update, row:", row);

  return { success: true };
}

// Get tool approval settings
export async function getToolApprovalSettings(
  session: Session,
  projectId: string
) {
  const project = await verifyProjectAccess(session, projectId);

  const settings: ToolApprovalSettings = project.toolApprovalSettings
    ? JSON.parse(project.toolApprovalSettings)
    : DEFAULT_TOOL_APPROVAL_SETTINGS;

  return settings;
}

// Cancel execution
export async function cancelExecution(session: Session, executionId: string) {
  const { execution } = await getExecution(session, executionId);

  if (execution.status === "completed" || execution.status === "failed") {
    throw new Error("Cannot cancel completed or failed execution");
  }

  await db
    .update(schema.agentExecutions)
    .set({
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentExecutions.id, executionId));

  return { success: true };
}

// Route handler
export function handleAgentRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  console.log("[handleAgentRoutes] Checking path:", path, "method:", method);

  // POST /api/projects/:projectId/working-directory
  const workingDirMatch = path.match(/^\/api\/projects\/([^/]+)\/working-directory$/);
  console.log("[handleAgentRoutes] workingDirMatch:", workingDirMatch);
  if (workingDirMatch && method === "POST") {
    console.log("[handleAgentRoutes] Matched working-directory route!");
    const projectId = workingDirMatch[1]!;
    return req.json().then((data) => {
      console.log("[handleAgentRoutes] Request data:", data);
      return updateWorkingDirectory(session, projectId, data.workingDirectory, data.confirmed)
        .then((result) => {
          console.log("[handleAgentRoutes] Result:", result);
          return Response.json(result);
        })
        .catch((err) => {
          console.error("[handleAgentRoutes] Error:", err);
          return Response.json({ error: err.message }, { status: 400 });
        });
    });
  }

  // GET/POST /api/projects/:projectId/tool-approval-settings
  const toolSettingsMatch = path.match(/^\/api\/projects\/([^/]+)\/tool-approval-settings$/);
  if (toolSettingsMatch) {
    const projectId = toolSettingsMatch[1]!;
    console.log("[handleAgentRoutes] Matched tool-approval-settings, method:", method, "projectId:", projectId);

    if (method === "GET") {
      return getToolApprovalSettings(session, projectId)
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }));
    }

    if (method === "POST") {
      return req.json().then((data) => {
        console.log("[handleAgentRoutes] POST tool-approval-settings data:", data);
        return updateToolApprovalSettings(session, projectId, data)
          .then((result) => Response.json(result))
          .catch((err) => Response.json({ error: err.message }, { status: 400 }));
      });
    }
  }

  // POST /api/projects/:projectId/tasks/:taskId/agent/start
  const startMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/agent\/start$/);
  if (startMatch && method === "POST") {
    const projectId = startMatch[1]!;
    const taskId = startMatch[2]!;
    return startAgentExecution(session, projectId, taskId);
  }

  // GET /api/agent/executions/:executionId
  const getExecMatch = path.match(/^\/api\/agent\/executions\/([^/]+)$/);
  if (getExecMatch && method === "GET") {
    const executionId = getExecMatch[1]!;
    return getExecution(session, executionId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // POST /api/agent/executions/:executionId/approve
  const approveMatch = path.match(/^\/api\/agent\/executions\/([^/]+)\/approve$/);
  if (approveMatch && method === "POST") {
    const executionId = approveMatch[1]!;
    return req.json().then((data) =>
      updateActionStatus(session, executionId, data.actionIds, data.status)
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }))
    );
  }

  // POST /api/agent/executions/:executionId/execute
  const executeMatch = path.match(/^\/api\/agent\/executions\/([^/]+)\/execute$/);
  if (executeMatch && method === "POST") {
    const executionId = executeMatch[1]!;
    return executeApprovedActions(session, executionId);
  }

  // POST /api/agent/executions/:executionId/cancel
  const cancelMatch = path.match(/^\/api\/agent\/executions\/([^/]+)\/cancel$/);
  if (cancelMatch && method === "POST") {
    const executionId = cancelMatch[1]!;
    return cancelExecution(session, executionId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 400 }));
  }

  return null;
}
