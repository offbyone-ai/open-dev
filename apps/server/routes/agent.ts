import { db, schema, sqlite } from "../db";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import type {
  ExecutionHistoryItem,
  ExecutionHistoryDetail,
  ExecutionHistoryFilters,
  ExecutionHistoryStats,
  AgentActionType,
  AgentActionParsed,
} from "@open-dev/shared";
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
import type { ReasoningStepType, AgentReasoningStep, SandboxLimits } from "@open-dev/shared";
import { SandboxLimitsTracker, LimitExceededError, DEFAULT_SANDBOX_LIMITS } from "../ai/sandbox-limits";

// Parse reasoning markers from agent text and return structured reasoning steps
function parseReasoningFromText(text: string): AgentReasoningStep[] {
  const steps: AgentReasoningStep[] = [];
  const patterns: { marker: string; type: ReasoningStepType }[] = [
    { marker: "[THINKING]", type: "thinking" },
    { marker: "[PLANNING]", type: "planning" },
    { marker: "[DECISION]", type: "decision" },
    { marker: "[OBSERVATION]", type: "observation" },
    { marker: "[REFLECTION]", type: "reflection" },
  ];

  // Find all reasoning markers and their positions
  const matches: { type: ReasoningStepType; start: number; markerLength: number }[] = [];

  for (const { marker, type } of patterns) {
    let pos = 0;
    while ((pos = text.indexOf(marker, pos)) !== -1) {
      matches.push({ type, start: pos, markerLength: marker.length });
      pos += marker.length;
    }
  }

  // Sort by position
  matches.sort((a, b) => a.start - b.start);

  // Extract content for each marker
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const contentStart = current.start + current.markerLength;
    const contentEnd = i < matches.length - 1 ? matches[i + 1]!.start : text.length;

    const content = text.slice(contentStart, contentEnd).trim();
    if (content) {
      steps.push({
        id: nanoid(),
        type: current.type,
        content,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return steps;
}

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

  // Parse sandbox limits from project (with safe fallback)
  let sandboxLimits: SandboxLimits = DEFAULT_SANDBOX_LIMITS;
  try {
    if (project.sandboxLimits) {
      sandboxLimits = JSON.parse(project.sandboxLimits);
    }
  } catch {
    console.warn(`Invalid sandboxLimits JSON for project ${projectId}`);
  }

  // Create sandbox limits tracker
  const limitsTracker = new SandboxLimitsTracker(sandboxLimits);

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial status
        sendSSEEvent(controller, "status", {
          executionId,
          status: "analyzing",
        });

        // Send initial limits info
        sendSSEEvent(controller, "sandboxLimits", {
          limits: limitsTracker.getLimits(),
          usage: limitsTracker.getUsage(),
        });

        // Create AI model
        const model = createAIProvider(aiProvider);
        const systemPrompt = createAgentSystemPrompt(project, task);

        // Parse tool approval settings from project (with safe fallback)
        let approvalSettings: ToolApprovalSettings = DEFAULT_TOOL_APPROVAL_SETTINGS;
        try {
          if (project.toolApprovalSettings) {
            approvalSettings = JSON.parse(project.toolApprovalSettings);
          }
        } catch {
          console.warn(`Invalid toolApprovalSettings JSON for project ${projectId}`);
        }

        // Helper to create an immediate execution callback with sandbox limit tracking
        const createImmediateCallback = <T extends keyof ActionParams>(
          actionType: T,
          executeFn: (workingDir: string, params: ActionParams[T]) => Promise<{ success: boolean; output?: string; error?: string }>
        ) => async (params: ActionParams[T]) => {
          // Check time limit before execution
          limitsTracker.checkTimeLimit();

          // Track file operations
          if (["readFile", "writeFile", "editFile", "deleteFile", "listDirectory"].includes(actionType)) {
            limitsTracker.trackFileOperation();
          }

          // Track commands
          if (actionType === "executeCommand") {
            limitsTracker.trackCommand();
          }

          // Validate file size for write operations
          if (actionType === "writeFile" && "content" in params) {
            const content = (params as ActionParams["writeFile"]).content;
            limitsTracker.validateFileSize(new TextEncoder().encode(content).length);
          }

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

          // Send updated usage info
          sendSSEEvent(controller, "sandboxUsage", limitsTracker.getUsageSummary());

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

          // Handle askQuestion - pauses execution until user responds
          onAskQuestion: async (params) => {
            const questionId = nanoid();
            actionSequence++;

            // Store the question in the database
            await db.insert(schema.agentQuestions).values({
              id: questionId,
              executionId,
              question: params.question,
              context: params.context || null,
              status: "pending",
            });

            // Also store as an action for the activity log
            await db.insert(schema.agentActions).values({
              id: nanoid(),
              executionId,
              actionType: "askQuestion",
              actionParams: JSON.stringify(params),
              status: "completed",
              result: JSON.stringify({ success: true, output: `Question asked: ${params.question}` }),
              sequence: actionSequence,
            });

            // Update execution status to awaiting_question
            await db
              .update(schema.agentExecutions)
              .set({
                status: "awaiting_question",
                updatedAt: new Date(),
              })
              .where(eq(schema.agentExecutions.id, executionId));

            // Send question event to the client
            sendSSEEvent(controller, "question", {
              id: questionId,
              question: params.question,
              context: params.context,
            });

            sendSSEEvent(controller, "status", {
              executionId,
              status: "awaiting_question",
            });

            // Return a message that will be used by the AI to know it needs to wait
            // The AI will receive this as the tool result
            return `WAITING_FOR_USER_RESPONSE: Your question "${params.question}" has been sent to the user. The execution is now paused. Once the user responds, the conversation will continue with their answer.`;
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

        // Use sandbox limits for max steps, default to 20 if not configured
        const maxSteps = sandboxLimits.maxSteps > 0 ? sandboxLimits.maxSteps : 20;

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
          stopWhen: stepCountIs(maxSteps),
          onStepFinish: async (step) => {
            // Track each AI interaction step
            limitsTracker.trackStep();

            // Check time limit after each step
            limitsTracker.checkTimeLimit();

            // Track token usage if available
            if (step.usage) {
              limitsTracker.trackTokens(step.usage.promptTokens || 0, step.usage.completionTokens || 0);
            }

            // Send updated usage info
            sendSSEEvent(controller, "sandboxUsage", limitsTracker.getUsageSummary());
          },
        });

        console.log("[Agent] generateText completed");
        console.log("[Agent] Text:", result.text?.slice(0, 200));
        console.log("[Agent] Steps:", result.steps?.length);
        console.log("[Agent] Tool calls:", result.toolCalls?.length);

        // Send text response if any
        if (result.text) {
          sendSSEEvent(controller, "text", { content: result.text });

          // Parse and send reasoning steps from the text
          const reasoningSteps = parseReasoningFromText(result.text);
          for (const step of reasoningSteps) {
            sendSSEEvent(controller, "reasoning", { step });
          }
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

        // Check if this is a limit exceeded error
        if (error instanceof LimitExceededError) {
          sendSSEEvent(controller, "limitExceeded", {
            executionId,
            limitType: error.limitType,
            limitValue: error.limitValue,
            currentValue: error.currentValue,
            message: error.message,
          });
        }

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

        // Send final usage summary
        sendSSEEvent(controller, "sandboxUsage", limitsTracker.getUsageSummary());

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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Get execution history for a project
export async function getExecutionHistory(
  session: Session,
  projectId: string,
  filters: ExecutionHistoryFilters = {}
): Promise<ExecutionHistoryItem[]> {
  await verifyProjectAccess(session, projectId);

  const { status, limit = 50, offset = 0 } = filters;

  // Build query with joins to get task title and action counts
  const queryStr = status
    ? `
    SELECT
      e.id,
      e.task_id as taskId,
      t.title as taskTitle,
      e.project_id as projectId,
      e.status,
      e.error_message as errorMessage,
      e.created_at as createdAt,
      e.updated_at as updatedAt,
      e.completed_at as completedAt,
      (SELECT COUNT(*) FROM agent_actions a WHERE a.execution_id = e.id) as actionsCount,
      (SELECT COUNT(*) FROM agent_actions a WHERE a.execution_id = e.id AND a.status = 'completed') as completedActionsCount,
      (SELECT COUNT(*) FROM agent_actions a WHERE a.execution_id = e.id AND a.status = 'failed') as failedActionsCount
    FROM agent_executions e
    LEFT JOIN tasks t ON e.task_id = t.id
    WHERE e.project_id = ? AND e.status = ?
    ORDER BY e.created_at DESC
    LIMIT ?
    OFFSET ?
  `
    : `
    SELECT
      e.id,
      e.task_id as taskId,
      t.title as taskTitle,
      e.project_id as projectId,
      e.status,
      e.error_message as errorMessage,
      e.created_at as createdAt,
      e.updated_at as updatedAt,
      e.completed_at as completedAt,
      (SELECT COUNT(*) FROM agent_actions a WHERE a.execution_id = e.id) as actionsCount,
      (SELECT COUNT(*) FROM agent_actions a WHERE a.execution_id = e.id AND a.status = 'completed') as completedActionsCount,
      (SELECT COUNT(*) FROM agent_actions a WHERE a.execution_id = e.id AND a.status = 'failed') as failedActionsCount
    FROM agent_executions e
    LEFT JOIN tasks t ON e.task_id = t.id
    WHERE e.project_id = ?
    ORDER BY e.created_at DESC
    LIMIT ?
    OFFSET ?
  `;

  const params = status
    ? [projectId, status, limit, offset]
    : [projectId, limit, offset];

  const results = sqlite.prepare(queryStr).all(...params) as Array<{
    id: string;
    taskId: string;
    taskTitle: string;
    projectId: string;
    status: string;
    errorMessage: string | null;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    actionsCount: number;
    completedActionsCount: number;
    failedActionsCount: number;
  }>;

  return results.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle || "Unknown Task",
    projectId: row.projectId,
    status: row.status as ExecutionHistoryItem["status"],
    errorMessage: row.errorMessage,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    actionsCount: row.actionsCount,
    completedActionsCount: row.completedActionsCount,
    failedActionsCount: row.failedActionsCount,
  }));
}

// Get detailed execution history for a specific execution
export async function getExecutionHistoryDetail(
  session: Session,
  executionId: string
): Promise<ExecutionHistoryDetail> {
  const { execution, actions } = await getExecution(session, executionId);

  // Get task details
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, execution.taskId),
  });

  // Parse actions
  const parsedActions: AgentActionParsed[] = actions.map((action) => ({
    id: action.id,
    executionId: action.executionId,
    actionType: action.actionType as AgentActionType,
    actionParams: JSON.parse(action.actionParams),
    status: action.status as AgentActionParsed["status"],
    result: action.result ? JSON.parse(action.result) : null,
    sequence: action.sequence,
    createdAt: action.createdAt instanceof Date
      ? action.createdAt.toISOString()
      : new Date(action.createdAt).toISOString(),
    updatedAt: action.updatedAt instanceof Date
      ? action.updatedAt.toISOString()
      : new Date(action.updatedAt).toISOString(),
  }));

  // Calculate summary
  const actionBreakdown: Record<AgentActionType, number> = {
    readFile: 0,
    writeFile: 0,
    editFile: 0,
    deleteFile: 0,
    listDirectory: 0,
    executeCommand: 0,
    completeTask: 0,
  };

  for (const action of parsedActions) {
    actionBreakdown[action.actionType]++;
  }

  const completedActions = parsedActions.filter((a) => a.status === "completed").length;
  const failedActions = parsedActions.filter((a) => a.status === "failed").length;

  const createdAt = execution.createdAt instanceof Date
    ? execution.createdAt.getTime()
    : new Date(execution.createdAt).getTime();
  const completedAt = execution.completedAt
    ? (execution.completedAt instanceof Date
        ? execution.completedAt.getTime()
        : new Date(execution.completedAt).getTime())
    : null;

  const duration = completedAt ? completedAt - createdAt : null;

  return {
    execution: {
      id: execution.id,
      taskId: execution.taskId,
      projectId: execution.projectId,
      status: execution.status as ExecutionHistoryDetail["execution"]["status"],
      errorMessage: execution.errorMessage,
      createdAt: execution.createdAt instanceof Date
        ? execution.createdAt.toISOString()
        : new Date(execution.createdAt).toISOString(),
      updatedAt: execution.updatedAt instanceof Date
        ? execution.updatedAt.toISOString()
        : new Date(execution.updatedAt).toISOString(),
      completedAt: execution.completedAt
        ? (execution.completedAt instanceof Date
            ? execution.completedAt.toISOString()
            : new Date(execution.completedAt).toISOString())
        : null,
    },
    task: {
      id: task?.id || execution.taskId,
      title: task?.title || "Unknown Task",
      description: task?.description || null,
    },
    actions: parsedActions,
    summary: {
      totalActions: parsedActions.length,
      completedActions,
      failedActions,
      duration,
      actionBreakdown,
    },
  };
}

// Get execution history stats for a project
export async function getExecutionHistoryStats(
  session: Session,
  projectId: string
): Promise<ExecutionHistoryStats> {
  await verifyProjectAccess(session, projectId);

  // Get execution counts by status
  const statusQuery = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
      AVG(CASE WHEN completed_at IS NOT NULL THEN completed_at - created_at ELSE NULL END) as avgDuration
    FROM agent_executions
    WHERE project_id = ?
  `;

  const statusResult = sqlite.prepare(statusQuery).get(projectId) as {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    avgDuration: number | null;
  };

  // Get action breakdown across all executions
  const actionQuery = `
    SELECT
      action_type as actionType,
      COUNT(*) as count
    FROM agent_actions a
    JOIN agent_executions e ON a.execution_id = e.id
    WHERE e.project_id = ?
    GROUP BY action_type
  `;

  const actionResults = sqlite.prepare(actionQuery).all(projectId) as Array<{
    actionType: string;
    count: number;
  }>;

  const actionBreakdown: Record<AgentActionType, number> = {
    readFile: 0,
    writeFile: 0,
    editFile: 0,
    deleteFile: 0,
    listDirectory: 0,
    executeCommand: 0,
    completeTask: 0,
  };

  for (const row of actionResults) {
    actionBreakdown[row.actionType as AgentActionType] = row.count;
  }

  return {
    totalExecutions: statusResult.total || 0,
    completedExecutions: statusResult.completed || 0,
    failedExecutions: statusResult.failed || 0,
    cancelledExecutions: statusResult.cancelled || 0,
    avgDuration: statusResult.avgDuration,
    actionBreakdown,
  };
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

  let settings: ToolApprovalSettings = DEFAULT_TOOL_APPROVAL_SETTINGS;
  try {
    if (project.toolApprovalSettings) {
      settings = JSON.parse(project.toolApprovalSettings);
    }
  } catch {
    console.warn(`Invalid toolApprovalSettings JSON for project ${projectId}`);
  }

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

// Read file content for diff preview
export async function readFileContent(
  session: Session,
  projectId: string,
  filePath: string
): Promise<{ content: string; exists: boolean }> {
  const project = await verifyProjectAccess(session, projectId);

  if (!project.workingDirectory) {
    throw new Error("Working directory not configured");
  }

  // Validate path is within working directory
  const absolutePath = validatePath(project.workingDirectory, filePath);
  const file = Bun.file(absolutePath);

  if (!(await file.exists())) {
    return { content: "", exists: false };
  }

  const content = await file.text();
  return { content, exists: true };
}

// Read multiple files for diff preview (batch)
export async function readMultipleFileContents(
  session: Session,
  projectId: string,
  filePaths: string[]
): Promise<Record<string, { content: string; exists: boolean }>> {
  const project = await verifyProjectAccess(session, projectId);

  if (!project.workingDirectory) {
    throw new Error("Working directory not configured");
  }

  const results: Record<string, { content: string; exists: boolean }> = {};

  for (const filePath of filePaths) {
    try {
      const absolutePath = validatePath(project.workingDirectory, filePath);
      const file = Bun.file(absolutePath);

      if (!(await file.exists())) {
        results[filePath] = { content: "", exists: false };
      } else {
        const content = await file.text();
        results[filePath] = { content, exists: true };
      }
    } catch (error) {
      // If path validation fails, treat as non-existent
      results[filePath] = { content: "", exists: false };
    }
  }

  return results;
}

// Get pending questions for an execution
export async function getPendingQuestions(session: Session, executionId: string) {
  const { execution } = await getExecution(session, executionId);

  const questions = await db.query.agentQuestions.findMany({
    where: and(
      eq(schema.agentQuestions.executionId, executionId),
      eq(schema.agentQuestions.status, "pending")
    ),
  });

  return questions;
}

// Answer a question and resume execution
export async function answerQuestion(
  session: Session,
  executionId: string,
  questionId: string,
  response: string
) {
  const { execution } = await getExecution(session, executionId);

  if (execution.status !== "awaiting_question") {
    throw new Error("Execution is not waiting for a question response");
  }

  // Update the question with the response
  await db
    .update(schema.agentQuestions)
    .set({
      response,
      status: "answered",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.agentQuestions.id, questionId),
        eq(schema.agentQuestions.executionId, executionId)
      )
    );

  // Check if there are any more pending questions
  const pendingQuestions = await db.query.agentQuestions.findMany({
    where: and(
      eq(schema.agentQuestions.executionId, executionId),
      eq(schema.agentQuestions.status, "pending")
    ),
  });

  if (pendingQuestions.length === 0) {
    // No more pending questions, update execution status back to analyzing
    // The agent will resume with the answer in context
    await db
      .update(schema.agentExecutions)
      .set({
        status: "analyzing",
        updatedAt: new Date(),
      })
      .where(eq(schema.agentExecutions.id, executionId));
  }

  return { success: true, response };
}

// Resume agent execution after question was answered - streams progress via SSE
export async function resumeAgentExecution(
  session: Session,
  executionId: string
): Promise<Response> {
  const { execution, actions } = await getExecution(session, executionId);
  const project = await verifyProjectAccess(session, execution.projectId);

  // Get the task
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, execution.taskId),
  });

  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // Get all answered questions to include in context
  const answeredQuestions = await db.query.agentQuestions.findMany({
    where: and(
      eq(schema.agentQuestions.executionId, executionId),
      eq(schema.agentQuestions.status, "answered")
    ),
  });

  // Get AI provider
  if (!project.aiProviderId) {
    return Response.json({ error: "No AI provider configured" }, { status: 400 });
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

  let actionSequence = actions.length;

  // Parse sandbox limits from project (with safe fallback)
  let sandboxLimits: SandboxLimits = DEFAULT_SANDBOX_LIMITS;
  try {
    if (project.sandboxLimits) {
      sandboxLimits = JSON.parse(project.sandboxLimits);
    }
  } catch {
    console.warn(`Invalid sandboxLimits JSON for project ${projectId}`);
  }

  // Create sandbox limits tracker
  const limitsTracker = new SandboxLimitsTracker(sandboxLimits);

  // Create SSE stream for resumed execution
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Update status to analyzing
        await db
          .update(schema.agentExecutions)
          .set({
            status: "analyzing",
            updatedAt: new Date(),
          })
          .where(eq(schema.agentExecutions.id, executionId));

        sendSSEEvent(controller, "status", {
          executionId,
          status: "analyzing",
        });

        // Build conversation history including previous actions and Q&A
        const conversationHistory: { role: "user" | "assistant"; content: string }[] = [
          {
            role: "user",
            content: `Please complete this task: ${task.title}\n\n${task.description || ""}`,
          },
        ];

        // Add Q&A context
        if (answeredQuestions.length > 0) {
          const qaContext = answeredQuestions.map(q =>
            `Question: ${q.question}\nUser's Answer: ${q.response}`
          ).join("\n\n");

          conversationHistory.push({
            role: "assistant",
            content: `I asked clarifying questions and received the following answers:\n\n${qaContext}\n\nI will now continue with the task based on these clarifications.`,
          });
        }

        // Create AI model
        const model = createAIProvider(aiProvider);
        const systemPrompt = createAgentSystemPrompt(project, task);

        // Parse tool approval settings (with safe fallback)
        let approvalSettings: ToolApprovalSettings = DEFAULT_TOOL_APPROVAL_SETTINGS;
        try {
          if (project.toolApprovalSettings) {
            approvalSettings = JSON.parse(project.toolApprovalSettings);
          }
        } catch {
          console.warn(`Invalid toolApprovalSettings JSON for project ${projectId}`);
        }

        // Helper to create an immediate execution callback
        const createImmediateCallback = <T extends keyof ActionParams>(
          actionType: T,
          executeFn: (workingDir: string, params: ActionParams[T]) => Promise<{ success: boolean; output?: string; error?: string }>
        ) => async (params: ActionParams[T]) => {
          limitsTracker.checkTimeLimit();

          if (["readFile", "writeFile", "editFile", "deleteFile", "listDirectory"].includes(actionType)) {
            limitsTracker.trackFileOperation();
          }

          if (actionType === "executeCommand") {
            limitsTracker.trackCommand();
          }

          if (actionType === "writeFile" && "content" in params) {
            const content = (params as ActionParams["writeFile"]).content;
            limitsTracker.validateFileSize(new TextEncoder().encode(content).length);
          }

          const result = await executeFn(project.workingDirectory!, params);

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

          sendSSEEvent(controller, "sandboxUsage", limitsTracker.getUsageSummary());

          return result.success ? result.output! : `Error: ${result.error}`;
        };

        // Create tools with callbacks
        const tools = createAgentTools({
          onReadFile: createImmediateCallback("readFile", executeReadFile),
          onListDirectory: createImmediateCallback("listDirectory", executeListDirectory),
          onWriteFile: createImmediateCallback("writeFile", executeWriteFile),
          onEditFile: createImmediateCallback("editFile", executeEditFile),
          onDeleteFile: createImmediateCallback("deleteFile", executeDeleteFile),
          onExecuteCommand: createImmediateCallback("executeCommand", executeCommand),
          onCompleteTask: async (params) => {
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

          onAskQuestion: async (params) => {
            const questionId = nanoid();
            actionSequence++;

            await db.insert(schema.agentQuestions).values({
              id: questionId,
              executionId,
              question: params.question,
              context: params.context || null,
              status: "pending",
            });

            await db.insert(schema.agentActions).values({
              id: nanoid(),
              executionId,
              actionType: "askQuestion",
              actionParams: JSON.stringify(params),
              status: "completed",
              result: JSON.stringify({ success: true, output: `Question asked: ${params.question}` }),
              sequence: actionSequence,
            });

            await db
              .update(schema.agentExecutions)
              .set({
                status: "awaiting_question",
                updatedAt: new Date(),
              })
              .where(eq(schema.agentExecutions.id, executionId));

            sendSSEEvent(controller, "question", {
              id: questionId,
              question: params.question,
              context: params.context,
            });

            sendSSEEvent(controller, "status", {
              executionId,
              status: "awaiting_question",
            });

            return `WAITING_FOR_USER_RESPONSE: Your question "${params.question}" has been sent to the user. The execution is now paused.`;
          },

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

          approvalSettings,
        });

        const maxSteps = sandboxLimits.maxSteps > 0 ? sandboxLimits.maxSteps : 20;

        const result = await generateText({
          model,
          system: systemPrompt,
          messages: conversationHistory,
          tools,
          stopWhen: stepCountIs(maxSteps),
          onStepFinish: async (step) => {
            limitsTracker.trackStep();
            limitsTracker.checkTimeLimit();

            if (step.usage) {
              limitsTracker.trackTokens(step.usage.promptTokens || 0, step.usage.completionTokens || 0);
            }

            sendSSEEvent(controller, "sandboxUsage", limitsTracker.getUsageSummary());
          },
        });

        if (result.text) {
          sendSSEEvent(controller, "text", { content: result.text });
        }

        // If we're now awaiting a question, don't mark as complete
        const currentExecution = await db.query.agentExecutions.findFirst({
          where: eq(schema.agentExecutions.id, executionId),
        });

        if (currentExecution?.status === "awaiting_question") {
          sendSSEEvent(controller, "done", { executionId });
          controller.close();
          return;
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
        console.error("Resume agent execution error:", error);

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

// Get sandbox limits for a project
export async function getSandboxLimits(
  session: Session,
  projectId: string
): Promise<SandboxLimits> {
  const project = await verifyProjectAccess(session, projectId);

  let limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS;
  try {
    if (project.sandboxLimits) {
      limits = JSON.parse(project.sandboxLimits);
    }
  } catch {
    console.warn(`Invalid sandboxLimits JSON for project ${projectId}`);
  }

  return limits;
}

// Update sandbox limits for a project
export async function updateSandboxLimits(
  session: Session,
  projectId: string,
  limits: Partial<SandboxLimits>
) {
  console.log("[updateSandboxLimits] Called with:", { projectId, limits });

  await verifyProjectAccess(session, projectId);

  // Merge with defaults to ensure all fields are present
  const currentLimits = await getSandboxLimits(session, projectId);
  const newLimits: SandboxLimits = {
    ...currentLimits,
    ...limits,
  };

  // Validate limits (must be non-negative)
  for (const [key, value] of Object.entries(newLimits)) {
    if (typeof value === "number" && value < 0) {
      throw new Error(`Invalid limit value for ${key}: must be non-negative`);
    }
  }

  const result = await db
    .update(schema.projects)
    .set({
      sandboxLimits: JSON.stringify(newLimits),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  console.log("[updateSandboxLimits] Update result:", result);

  return { success: true, limits: newLimits };
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

  // GET/POST /api/projects/:projectId/sandbox-limits
  const sandboxLimitsMatch = path.match(/^\/api\/projects\/([^/]+)\/sandbox-limits$/);
  if (sandboxLimitsMatch) {
    const projectId = sandboxLimitsMatch[1]!;
    console.log("[handleAgentRoutes] Matched sandbox-limits, method:", method, "projectId:", projectId);

    if (method === "GET") {
      return getSandboxLimits(session, projectId)
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }));
    }

    if (method === "POST") {
      return req.json().then((data) => {
        console.log("[handleAgentRoutes] POST sandbox-limits data:", data);
        return updateSandboxLimits(session, projectId, data)
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

  // GET /api/projects/:projectId/file-content - Read single file content for diff preview
  const fileContentMatch = path.match(/^\/api\/projects\/([^/]+)\/file-content$/);
  if (fileContentMatch && method === "GET") {
    const projectId = fileContentMatch[1]!;
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return Promise.resolve(
        Response.json({ error: "path parameter required" }, { status: 400 })
      );
    }
    return readFileContent(session, projectId, filePath)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 400 }));
  }

  // POST /api/projects/:projectId/file-contents - Read multiple file contents for diff preview (batch)
  const fileContentsMatch = path.match(/^\/api\/projects\/([^/]+)\/file-contents$/);
  if (fileContentsMatch && method === "POST") {
    const projectId = fileContentsMatch[1]!;
    return req.json().then((data) => {
      if (!data.paths || !Array.isArray(data.paths)) {
        return Response.json({ error: "paths array required" }, { status: 400 });
      }
      return readMultipleFileContents(session, projectId, data.paths)
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }));
    });
  }

  // GET /api/projects/:projectId/executions - List execution history
  const historyMatch = path.match(/^\/api\/projects\/([^/]+)\/executions$/);
  if (historyMatch && method === "GET") {
    const projectId = historyMatch[1]!;
    const params = url.searchParams;
    const filters: ExecutionHistoryFilters = {
      status: params.get("status") as ExecutionHistoryFilters["status"] || undefined,
      limit: params.get("limit") ? parseInt(params.get("limit")!, 10) : undefined,
      offset: params.get("offset") ? parseInt(params.get("offset")!, 10) : undefined,
    };
    return getExecutionHistory(session, projectId, filters)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 400 }));
  }

  // GET /api/projects/:projectId/executions/stats - Get execution stats
  const statsMatch = path.match(/^\/api\/projects\/([^/]+)\/executions\/stats$/);
  if (statsMatch && method === "GET") {
    const projectId = statsMatch[1]!;
    return getExecutionHistoryStats(session, projectId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 400 }));
  }

  // GET /api/agent/executions/:executionId/detail - Get detailed execution history
  const detailMatch = path.match(/^\/api\/agent\/executions\/([^/]+)\/detail$/);
  if (detailMatch && method === "GET") {
    const executionId = detailMatch[1]!;
    return getExecutionHistoryDetail(session, executionId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // GET /api/agent/executions/:executionId/questions - Get pending questions
  const questionsMatch = path.match(/^\/api\/agent\/executions\/([^/]+)\/questions$/);
  if (questionsMatch && method === "GET") {
    const executionId = questionsMatch[1]!;
    return getPendingQuestions(session, executionId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 400 }));
  }

  // POST /api/agent/executions/:executionId/questions/:questionId/answer - Answer a question
  const answerMatch = path.match(/^\/api\/agent\/executions\/([^/]+)\/questions\/([^/]+)\/answer$/);
  if (answerMatch && method === "POST") {
    const executionId = answerMatch[1]!;
    const questionId = answerMatch[2]!;
    return req.json().then((data) =>
      answerQuestion(session, executionId, questionId, data.response)
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }))
    );
  }

  // POST /api/agent/executions/:executionId/resume - Resume execution after answering questions
  const resumeMatch = path.match(/^\/api\/agent\/executions\/([^/]+)\/resume$/);
  if (resumeMatch && method === "POST") {
    const executionId = resumeMatch[1]!;
    return resumeAgentExecution(session, executionId);
  }

  return null;
}
