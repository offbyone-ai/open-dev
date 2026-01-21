import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import {
  agentAPI,
  type Task,
  type Project,
  type AgentExecutionStatus,
  type AgentActionType,
  type AgentActionStatus,
} from "../../lib/api";
import type { AgentReasoningStep } from "@open-dev/shared";
import { ActionCard } from "./action-card";
import { ReasoningDisplay } from "./reasoning-display";
import { ToolApprovalSettingsDialog } from "./tool-approval-settings";
import { FileChangesPreview } from "./file-changes-preview";
import {
  Bot,
  Play,
  X,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Settings,
  FileCode,
  List,
  MessageCircleQuestion,
  Send,
} from "lucide-react";

interface AgentPanelProps {
  project: Project;
  task: Task;
  onClose: () => void;
  onTaskUpdated: () => void;
  onSetupWorkingDirectory: () => void;
}

interface ActionState {
  id: string;
  type: AgentActionType;
  params: Record<string, unknown>;
  status: AgentActionStatus;
  result?: { success: boolean; output?: string; error?: string };
}

interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  type: "status" | "action" | "text" | "read" | "list" | "error" | "question";
  message: string;
  details?: string;
}

interface QuestionState {
  id: string;
  question: string;
  context?: string;
}

export function AgentPanel({
  project,
  task,
  onClose,
  onTaskUpdated,
  onSetupWorkingDirectory,
}: AgentPanelProps) {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentExecutionStatus | null>(null);
  const [actions, setActions] = useState<ActionState[]>([]);
  const [agentText, setAgentText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [reasoningSteps, setReasoningSteps] = useState<AgentReasoningStep[]>([]);
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<"diff" | "list">("diff");
  const [pendingQuestion, setPendingQuestion] = useState<QuestionState | null>(null);
  const [questionResponse, setQuestionResponse] = useState("");
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);

  // Check if there are file-changing actions (for diff view)
  const hasFileActions = useMemo(
    () =>
      actions.some((a) =>
        ["writeFile", "editFile", "deleteFile"].includes(a.type)
      ),
    [actions]
  );

  // Non-file actions (readFile, listDirectory, executeCommand, completeTask)
  const nonFileActions = useMemo(
    () =>
      actions.filter(
        (a) => !["writeFile", "editFile", "deleteFile"].includes(a.type)
      ),
    [actions]
  );

  // Helper to add activity log entries
  const addLogEntry = useCallback((type: ActivityLogEntry["type"], message: string, details?: string) => {
    setActivityLog((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type,
        message,
        details,
      },
    ]);
  }, []);

  // Check if working directory is configured (handle null/undefined/false)
  const needsWorkingDirectory =
    !project.workingDirectory || project.workingDirectoryConfirmed !== true;

  // Debug logging
  console.log("[AgentPanel] project.workingDirectory:", project.workingDirectory);
  console.log("[AgentPanel] project.workingDirectoryConfirmed:", project.workingDirectoryConfirmed);
  console.log("[AgentPanel] needsWorkingDirectory:", needsWorkingDirectory);

  // Start agent execution
  const startAgent = useCallback(async () => {
    if (needsWorkingDirectory) {
      onSetupWorkingDirectory();
      return;
    }

    setIsStarting(true);
    setError(null);
    setActions([]);
    setAgentText("");
    setActivityLog([]);
    setReasoningSteps([]);
    addLogEntry("status", "Starting agent execution...");

    try {
      const response = await agentAPI.startExecutionFetch(project.id, task.id);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to start agent");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const eventType = line.slice(7);
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              // Find the event type from the previous line
              const eventLine = lines[lines.indexOf(line) - 1];
              const eventType = eventLine?.startsWith("event: ")
                ? eventLine.slice(7)
                : null;

              if (!eventType) continue;

              switch (eventType) {
                case "status":
                  setExecutionId(data.executionId);
                  setStatus(data.status);
                  addLogEntry("status", `Status: ${data.status.replace("_", " ")}`);
                  break;
                case "action":
                  setActions((prev) => {
                    const existing = prev.find((a) => a.id === data.id);
                    if (existing) {
                      return prev.map((a) =>
                        a.id === data.id
                          ? { ...a, status: data.status, result: data.result }
                          : a
                      );
                    }
                    return [
                      ...prev,
                      {
                        id: data.id,
                        type: data.type,
                        params: data.params,
                        status: data.status,
                        result: data.result,
                      },
                    ];
                  });
                  // Log actions based on type and status
                  if (data.status === "proposed") {
                    const actionLabel =
                      data.type === "writeFile" ? `Proposing to write: ${data.params?.path}` :
                      data.type === "editFile" ? `Proposing to edit: ${data.params?.path}` :
                      data.type === "deleteFile" ? `Proposing to delete: ${data.params?.path}` :
                      data.type === "executeCommand" ? `Proposing command: ${data.params?.command}` :
                      data.type === "completeTask" ? `Proposing to complete task` :
                      `Action: ${data.type}`;
                    addLogEntry("action", actionLabel);
                  } else if (data.status === "completed") {
                    // Log immediate action results (readFile, listDirectory)
                    if (data.type === "readFile") {
                      const outputLen = data.result?.output?.length || 0;
                      addLogEntry("read", `Read file: ${data.params?.path} (${outputLen} chars)`);
                    } else if (data.type === "listDirectory") {
                      const items = data.result?.output?.split("\n").length || 0;
                      addLogEntry("list", `Listed directory: ${data.params?.path} (${items} items)`);
                    }
                  }
                  break;
                case "text":
                  setAgentText((prev) => prev + data.content);
                  // Log thinking snippets (only log substantial chunks to avoid noise)
                  if (data.content && data.content.trim().length > 0) {
                    addLogEntry("text", "Agent thinking...", data.content);
                  }
                  break;
                case "reasoning":
                  // Add reasoning step from the server
                  if (data.step) {
                    setReasoningSteps((prev) => [...prev, data.step]);
                    addLogEntry("text", `[${data.step.type.toUpperCase()}] ${data.step.content.slice(0, 50)}...`);
                  }
                  break;
                case "question":
                  // Agent is asking a clarifying question
                  setPendingQuestion({
                    id: data.id,
                    question: data.question,
                    context: data.context,
                  });
                  addLogEntry("question", `Question: ${data.question}`);
                  break;
                case "error":
                  setError(data.error);
                  setStatus("failed");
                  addLogEntry("error", `Error: ${data.error}`);
                  break;
                case "done":
                  addLogEntry("status", "Agent finished analyzing");
                  break;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start agent");
      setStatus("failed");
    } finally {
      setIsStarting(false);
    }
  }, [project.id, task.id, needsWorkingDirectory, onSetupWorkingDirectory, addLogEntry]);

  // Approve an action
  const approveAction = async (actionId: string) => {
    if (!executionId) return;

    setActions((prev) =>
      prev.map((a) => (a.id === actionId ? { ...a, status: "approved" } : a))
    );

    try {
      await agentAPI.updateActionStatus(executionId, [actionId], "approved");
    } catch (err) {
      console.error("Failed to approve action:", err);
    }
  };

  // Reject an action
  const rejectAction = async (actionId: string) => {
    if (!executionId) return;

    setActions((prev) =>
      prev.map((a) => (a.id === actionId ? { ...a, status: "rejected" } : a))
    );

    try {
      await agentAPI.updateActionStatus(executionId, [actionId], "rejected");
    } catch (err) {
      console.error("Failed to reject action:", err);
    }
  };

  // Approve all proposed actions
  const approveAll = async () => {
    if (!executionId) return;

    const proposedIds = actions
      .filter((a) => a.status === "proposed")
      .map((a) => a.id);

    setActions((prev) =>
      prev.map((a) =>
        a.status === "proposed" ? { ...a, status: "approved" } : a
      )
    );

    try {
      await agentAPI.updateActionStatus(executionId, proposedIds, "approved");
    } catch (err) {
      console.error("Failed to approve actions:", err);
    }
  };

  // Execute approved actions
  const executeApproved = async () => {
    if (!executionId) return;

    try {
      const response = await agentAPI.executeApproved(executionId);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to execute actions");
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              const eventLine = lines[lines.indexOf(line) - 1];
              const eventType = eventLine?.startsWith("event: ")
                ? eventLine.slice(7)
                : null;

              if (!eventType) continue;

              switch (eventType) {
                case "status":
                  setStatus(data.status);
                  break;
                case "executing":
                  setActions((prev) =>
                    prev.map((a) =>
                      a.id === data.actionId ? { ...a, status: "executing" } : a
                    )
                  );
                  break;
                case "actionComplete":
                  setActions((prev) =>
                    prev.map((a) =>
                      a.id === data.actionId
                        ? {
                            ...a,
                            status: data.success ? "completed" : "failed",
                            result: data.result,
                          }
                        : a
                    )
                  );
                  break;
                case "taskCompleted":
                  onTaskUpdated();
                  break;
                case "error":
                  setError(data.error);
                  setStatus("failed");
                  break;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute actions");
    }
  };

  // Cancel execution
  const cancelExecution = async () => {
    if (!executionId) return;

    try {
      await agentAPI.cancel(executionId);
      setStatus("cancelled");
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
  };

  // Submit answer to a question and resume execution
  const submitAnswer = async () => {
    if (!executionId || !pendingQuestion || !questionResponse.trim()) return;

    setIsSubmittingAnswer(true);
    try {
      // Submit the answer
      await agentAPI.answerQuestion(executionId, pendingQuestion.id, questionResponse.trim());

      // Clear the question state
      setPendingQuestion(null);
      setQuestionResponse("");
      addLogEntry("status", `Answered: ${questionResponse.trim().slice(0, 50)}...`);

      // Resume the execution
      const response = await agentAPI.resumeExecution(executionId);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to resume agent");
      }

      // Process the SSE stream from resumed execution
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              const eventLine = lines[lines.indexOf(line) - 1];
              const eventType = eventLine?.startsWith("event: ")
                ? eventLine.slice(7)
                : null;

              if (!eventType) continue;

              switch (eventType) {
                case "status":
                  setExecutionId(data.executionId);
                  setStatus(data.status);
                  addLogEntry("status", `Status: ${data.status.replace("_", " ")}`);
                  break;
                case "action":
                  setActions((prev) => {
                    const existing = prev.find((a) => a.id === data.id);
                    if (existing) {
                      return prev.map((a) =>
                        a.id === data.id
                          ? { ...a, status: data.status, result: data.result }
                          : a
                      );
                    }
                    return [
                      ...prev,
                      {
                        id: data.id,
                        type: data.type,
                        params: data.params,
                        status: data.status,
                        result: data.result,
                      },
                    ];
                  });
                  break;
                case "question":
                  setPendingQuestion({
                    id: data.id,
                    question: data.question,
                    context: data.context,
                  });
                  addLogEntry("question", `Question: ${data.question}`);
                  break;
                case "text":
                  setAgentText((prev) => prev + data.content);
                  break;
                case "error":
                  setError(data.error);
                  setStatus("failed");
                  break;
                case "done":
                  addLogEntry("status", "Agent finished");
                  break;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  const proposedActions = actions.filter((a) => a.status === "proposed");
  const approvedActions = actions.filter((a) => a.status === "approved");
  const hasApprovedActions = approvedActions.length > 0;
  const isAwaitingApproval = status === "awaiting_approval";
  const isAwaitingQuestion = status === "awaiting_question";

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="p-4 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            <CardTitle className="text-base">AI Agent</CardTitle>
            {status && (
              <Badge
                variant="secondary"
                className={cn(
                  "text-xs",
                  status === "analyzing" && "bg-blue-100 text-blue-800",
                  status === "awaiting_approval" && "bg-yellow-100 text-yellow-800",
                  status === "executing" && "bg-purple-100 text-purple-800",
                  status === "completed" && "bg-green-100 text-green-800",
                  status === "failed" && "bg-red-100 text-red-800",
                  status === "cancelled" && "bg-gray-100 text-gray-800"
                )}
              >
                {status === "analyzing" && (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                )}
                {status === "executing" && (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                )}
                {status.replace("_", " ")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ToolApprovalSettingsDialog
              projectId={project.id}
              trigger={
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Tool Settings">
                  <Settings className="h-4 w-4" />
                </Button>
              }
            />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Working on: {task.title}
        </p>
      </CardHeader>

      <CardContent className="p-4 pt-2 flex-1 overflow-y-auto">
        {needsWorkingDirectory && !status && (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">Working Directory Required</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Configure a working directory before the agent can access files.
            </p>
            <Button onClick={onSetupWorkingDirectory}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Configure Directory
            </Button>
          </div>
        )}

        {!needsWorkingDirectory && !status && (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">Ready to Start</h3>
            <p className="text-sm text-muted-foreground mb-4">
              The AI agent will analyze your task and propose file changes.
            </p>
            <Button onClick={startAgent} disabled={isStarting}>
              {isStarting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Start Agent
            </Button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded-md">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Agent Reasoning Display - Shows the agent's thought process */}
        {reasoningSteps.length > 0 && (
          <div className="mb-4">
            <ReasoningDisplay
              steps={reasoningSteps}
              isExpanded={isReasoningExpanded}
              onToggleExpand={() => setIsReasoningExpanded(!isReasoningExpanded)}
            />
          </div>
        )}

        {/* Activity Log - Shows during analyzing phase (when no reasoning steps yet) */}
        {status === "analyzing" && activityLog.length > 0 && reasoningSteps.length === 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Activity Log
            </div>
            <div className="bg-muted/50 rounded-md p-2 max-h-48 overflow-y-auto space-y-1">
              {activityLog.map((entry) => (
                <div key={entry.id} className="text-xs">
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground flex-shrink-0 w-16">
                      {entry.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className={cn(
                      entry.type === "error" && "text-red-600",
                      entry.type === "read" && "text-blue-600",
                      entry.type === "list" && "text-purple-600",
                      entry.type === "action" && "text-orange-600",
                      entry.type === "text" && "text-muted-foreground italic"
                    )}>
                      {entry.message}
                    </span>
                  </div>
                  {entry.details && entry.type !== "text" && (
                    <div className="ml-[4.5rem] text-muted-foreground truncate max-w-full">
                      {entry.details.slice(0, 80)}{entry.details.length > 80 ? "..." : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {actions.length > 0 && (
          <div className="space-y-4">
            {/* View mode toggle when there are file actions */}
            {hasFileActions && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Proposed Changes
                </span>
                <div className="flex items-center border rounded-md">
                  <Button
                    variant={viewMode === "diff" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 rounded-r-none"
                    onClick={() => setViewMode("diff")}
                    title="Diff view"
                  >
                    <FileCode className="h-4 w-4 mr-1" />
                    Diff
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 rounded-l-none"
                    onClick={() => setViewMode("list")}
                    title="List view"
                  >
                    <List className="h-4 w-4 mr-1" />
                    List
                  </Button>
                </div>
              </div>
            )}

            {/* File changes diff preview */}
            {hasFileActions && viewMode === "diff" && (
              <FileChangesPreview
                projectId={project.id}
                actions={actions}
                isAwaitingApproval={isAwaitingApproval}
                onApprove={approveAction}
                onReject={rejectAction}
                onApproveAll={approveAll}
                onRejectAll={async () => {
                  const ids = actions
                    .filter(
                      (a) =>
                        a.status === "proposed" &&
                        ["writeFile", "editFile", "deleteFile"].includes(a.type)
                    )
                    .map((a) => a.id);
                  for (const id of ids) {
                    await rejectAction(id);
                  }
                }}
              />
            )}

            {/* Non-file actions (always shown as cards) */}
            {nonFileActions.length > 0 && (
              <div className="space-y-3">
                {nonFileActions.map((action) => (
                  <ActionCard
                    key={action.id}
                    id={action.id}
                    type={action.type}
                    params={action.params}
                    status={action.status}
                    result={action.result}
                    isAwaitingApproval={isAwaitingApproval}
                    onApprove={() => approveAction(action.id)}
                    onReject={() => rejectAction(action.id)}
                  />
                ))}
              </div>
            )}

            {/* File actions in list view mode */}
            {hasFileActions && viewMode === "list" && (
              <div className="space-y-3">
                {actions
                  .filter((a) =>
                    ["writeFile", "editFile", "deleteFile"].includes(a.type)
                  )
                  .map((action) => (
                    <ActionCard
                      key={action.id}
                      id={action.id}
                      type={action.type}
                      params={action.params}
                      status={action.status}
                      result={action.result}
                      isAwaitingApproval={isAwaitingApproval}
                      onApprove={() => approveAction(action.id)}
                      onReject={() => rejectAction(action.id)}
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {status === "completed" && (
          <div className="flex items-center gap-2 p-3 mt-4 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 rounded-md">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">Task completed successfully!</span>
          </div>
        )}
      </CardContent>

      {isAwaitingApproval && proposedActions.length > 0 && (
        <div className="p-4 pt-0 flex-shrink-0 border-t">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={cancelExecution}>
              Cancel
            </Button>
            <Button variant="outline" className="flex-1" onClick={approveAll}>
              <Check className="h-4 w-4 mr-2" />
              Approve All ({proposedActions.length})
            </Button>
          </div>
        </div>
      )}

      {isAwaitingApproval && hasApprovedActions && proposedActions.length === 0 && (
        <div className="p-4 pt-0 flex-shrink-0 border-t">
          <Button className="w-full" onClick={executeApproved}>
            <Play className="h-4 w-4 mr-2" />
            Execute Approved ({approvedActions.length})
          </Button>
        </div>
      )}

      {(status === "completed" || status === "failed" || status === "cancelled") && (
        <div className="p-4 pt-0 flex-shrink-0 border-t">
          <Button className="w-full" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </Card>
  );
}
