import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import {
  executionHistoryAPI,
  type ExecutionHistoryItem,
  type ExecutionHistoryStats,
  type AgentExecutionStatus,
} from "../../lib/api";
import {
  History,
  RefreshCw,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  X,
  Bot,
} from "lucide-react";

interface ExecutionHistoryPanelProps {
  projectId: string;
  onViewDetail: (executionId: string) => void;
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

const STATUS_BADGES: Record<AgentExecutionStatus, { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"; icon: React.ReactNode }> = {
  pending: { variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  analyzing: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  awaiting_approval: { variant: "warning", icon: <Clock className="h-3 w-3" /> },
  executing: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed: { variant: "success", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  cancelled: { variant: "outline", icon: <AlertCircle className="h-3 w-3" /> },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

export function ExecutionHistoryPanel({
  projectId,
  onViewDetail,
  onClose,
}: ExecutionHistoryPanelProps) {
  const [executions, setExecutions] = useState<ExecutionHistoryItem[]>([]);
  const [stats, setStats] = useState<ExecutionHistoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AgentExecutionStatus | "all">("all");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [executionsData, statsData] = await Promise.all([
        executionHistoryAPI.list(projectId, {
          status: statusFilter === "all" ? undefined : statusFilter,
          limit: 50,
        }),
        executionHistoryAPI.getStats(projectId),
      ]);
      setExecutions(executionsData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const filterOptions: Array<{ value: AgentExecutionStatus | "all"; label: string }> = [
    { value: "all", label: "All" },
    { value: "completed", label: "Completed" },
    { value: "failed", label: "Failed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "executing", label: "Running" },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="p-4 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5" />
            <CardTitle className="text-base">Execution History</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={loadHistory}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Stats summary */}
        {stats && stats.totalExecutions > 0 && (
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{stats.totalExecutions} total</span>
            <span className="text-green-600">{stats.completedExecutions} completed</span>
            <span className="text-red-600">{stats.failedExecutions} failed</span>
            {stats.avgDuration && (
              <span>Avg: {formatDuration(stats.avgDuration)}</span>
            )}
          </div>
        )}

        {/* Filter buttons */}
        <div className="flex flex-wrap gap-1 mt-3">
          {filterOptions.map((option) => (
            <Button
              key={option.value}
              variant={statusFilter === option.value ? "default" : "outline"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setStatusFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2 flex-1 overflow-y-auto">
        {error && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded-md">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {loading && executions.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && executions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">No Executions Yet</h3>
            <p className="text-sm text-muted-foreground">
              Start working on tasks to see agent execution history here.
            </p>
          </div>
        )}

        {executions.length > 0 && (
          <div className="space-y-2">
            {executions.map((execution) => {
              const statusConfig = STATUS_BADGES[execution.status];
              const duration =
                execution.completedAt && execution.createdAt
                  ? new Date(execution.completedAt).getTime() -
                    new Date(execution.createdAt).getTime()
                  : null;

              return (
                <button
                  key={execution.id}
                  className="w-full p-3 bg-muted/50 hover:bg-muted rounded-lg transition-colors text-left group"
                  onClick={() => onViewDetail(execution.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {execution.taskTitle}
                        </span>
                        <Badge variant={statusConfig.variant} className="gap-1">
                          {statusConfig.icon}
                          {STATUS_LABELS[execution.status]}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{formatDate(execution.createdAt)}</span>
                        {duration && <span>{formatDuration(duration)}</span>}
                        <span>
                          {execution.actionsCount} action{execution.actionsCount !== 1 ? "s" : ""}
                        </span>
                        {execution.failedActionsCount > 0 && (
                          <span className="text-red-600">
                            {execution.failedActionsCount} failed
                          </span>
                        )}
                      </div>
                      {execution.errorMessage && (
                        <p className="text-xs text-red-600 mt-1 truncate">
                          {execution.errorMessage}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0 mt-1" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
