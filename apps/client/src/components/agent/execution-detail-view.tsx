import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import {
  executionHistoryAPI,
  type ExecutionHistoryDetail,
  type AgentExecutionStatus,
  type AgentActionType,
  type AgentActionStatus,
} from "../../lib/api";
import {
  ArrowLeft,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  X,
  FileText,
  Edit3,
  Trash2,
  Folder,
  Terminal,
  CheckSquare,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface ExecutionDetailViewProps {
  executionId: string;
  onBack: () => void;
  onClose: () => void;
}

const STATUS_LABELS: Record<AgentExecutionStatus, string> = {
  pending: "Pending",
  analyzing: "Analyzing",
  awaiting_approval: "Awaiting Approval",
  executing: "Executing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_BADGES: Record<AgentExecutionStatus, { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  pending: { variant: "secondary" },
  analyzing: { variant: "secondary" },
  awaiting_approval: { variant: "warning" },
  executing: { variant: "secondary" },
  completed: { variant: "success" },
  failed: { variant: "destructive" },
  cancelled: { variant: "outline" },
};

const ACTION_ICONS: Record<AgentActionType, React.ReactNode> = {
  readFile: <FileText className="h-4 w-4" />,
  writeFile: <FileText className="h-4 w-4" />,
  editFile: <Edit3 className="h-4 w-4" />,
  deleteFile: <Trash2 className="h-4 w-4" />,
  listDirectory: <Folder className="h-4 w-4" />,
  executeCommand: <Terminal className="h-4 w-4" />,
  completeTask: <CheckSquare className="h-4 w-4" />,
};

const ACTION_LABELS: Record<AgentActionType, string> = {
  readFile: "Read File",
  writeFile: "Write File",
  editFile: "Edit File",
  deleteFile: "Delete File",
  listDirectory: "List Directory",
  executeCommand: "Execute Command",
  completeTask: "Complete Task",
};

const ACTION_STATUS_COLORS: Record<AgentActionStatus, string> = {
  proposed: "text-yellow-600 bg-yellow-50",
  approved: "text-blue-600 bg-blue-50",
  rejected: "text-gray-600 bg-gray-50",
  executing: "text-purple-600 bg-purple-50",
  completed: "text-green-600 bg-green-50",
  failed: "text-red-600 bg-red-50",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ExecutionDetailView({
  executionId,
  onBack,
  onClose,
}: ExecutionDetailViewProps) {
  const [detail, setDetail] = useState<ExecutionHistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await executionHistoryAPI.getDetail(executionId);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load details");
    } finally {
      setLoading(false);
    }
  }, [executionId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const toggleAction = (actionId: string) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (detail) {
      setExpandedActions(new Set(detail.actions.map((a) => a.id)));
    }
  };

  const collapseAll = () => {
    setExpandedActions(new Set());
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="p-4 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="text-base">Execution Detail</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={loadDetail}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2 flex-1 overflow-y-auto">
        {error && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded-md">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {loading && !detail && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {detail && (
          <div className="space-y-4">
            {/* Task and execution info */}
            <div className="bg-muted/50 rounded-lg p-4">
              <h3 className="font-medium mb-2">{detail.task.title}</h3>
              {detail.task.description && (
                <p className="text-sm text-muted-foreground mb-3">
                  {detail.task.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant={STATUS_BADGES[detail.execution.status].variant}>
                  {STATUS_LABELS[detail.execution.status]}
                </Badge>
                <span className="text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-1" />
                  {formatDateTime(detail.execution.createdAt)}
                </span>
                {detail.summary.duration && (
                  <span className="text-muted-foreground">
                    Duration: {formatDuration(detail.summary.duration)}
                  </span>
                )}
              </div>
              {detail.execution.errorMessage && (
                <p className="text-sm text-red-600 mt-2">
                  {detail.execution.errorMessage}
                </p>
              )}
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-muted/50 rounded-lg p-2">
                <div className="text-lg font-semibold">
                  {detail.summary.totalActions}
                </div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
                <div className="text-lg font-semibold text-green-600">
                  {detail.summary.completedActions}
                </div>
                <div className="text-xs text-muted-foreground">Completed</div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                <div className="text-lg font-semibold text-red-600">
                  {detail.summary.failedActions}
                </div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            </div>

            {/* Action breakdown */}
            <div className="bg-muted/50 rounded-lg p-3">
              <h4 className="text-sm font-medium mb-2">Action Breakdown</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(detail.summary.actionBreakdown)
                  .filter(([_, count]) => count > 0)
                  .map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center gap-1 text-xs bg-background rounded px-2 py-1"
                    >
                      {ACTION_ICONS[type as AgentActionType]}
                      <span>{ACTION_LABELS[type as AgentActionType]}</span>
                      <span className="font-semibold">({count})</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Actions list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">
                  Actions ({detail.actions.length})
                </h4>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={expandAll}
                  >
                    Expand All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={collapseAll}
                  >
                    Collapse All
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {detail.actions.map((action, index) => {
                  const isExpanded = expandedActions.has(action.id);
                  const statusColor = ACTION_STATUS_COLORS[action.status];

                  return (
                    <div
                      key={action.id}
                      className="border rounded-lg overflow-hidden"
                    >
                      <button
                        className="w-full p-3 flex items-center gap-2 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => toggleAction(action.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span className="text-xs text-muted-foreground w-6">
                          #{index + 1}
                        </span>
                        <span className="flex-shrink-0">
                          {ACTION_ICONS[action.actionType]}
                        </span>
                        <span className="font-medium text-sm flex-1 truncate">
                          {ACTION_LABELS[action.actionType]}
                        </span>
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded",
                            statusColor
                          )}
                        >
                          {action.status}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-3 border-t bg-muted/30">
                          <div className="pt-3 space-y-2">
                            {/* Parameters */}
                            <div>
                              <h5 className="text-xs font-medium text-muted-foreground mb-1">
                                Parameters
                              </h5>
                              <pre className="text-xs bg-background p-2 rounded overflow-x-auto">
                                {JSON.stringify(action.actionParams, null, 2)}
                              </pre>
                            </div>

                            {/* Result */}
                            {action.result && (
                              <div>
                                <h5 className="text-xs font-medium text-muted-foreground mb-1">
                                  Result
                                </h5>
                                <div
                                  className={cn(
                                    "text-xs p-2 rounded",
                                    action.result.success
                                      ? "bg-green-50 dark:bg-green-900/20"
                                      : "bg-red-50 dark:bg-red-900/20"
                                  )}
                                >
                                  {action.result.success ? (
                                    <div className="flex items-center gap-1 text-green-700 dark:text-green-300">
                                      <CheckCircle2 className="h-3 w-3" />
                                      <span>Success</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1 text-red-700 dark:text-red-300">
                                      <XCircle className="h-3 w-3" />
                                      <span>Failed</span>
                                    </div>
                                  )}
                                  {action.result.output && (
                                    <pre className="mt-2 text-xs whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                                      {action.result.output.slice(0, 500)}
                                      {action.result.output.length > 500 && "..."}
                                    </pre>
                                  )}
                                  {action.result.error && (
                                    <p className="mt-2 text-red-600">
                                      {action.result.error}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Timestamp */}
                            <div className="text-xs text-muted-foreground">
                              {formatDateTime(action.createdAt)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
