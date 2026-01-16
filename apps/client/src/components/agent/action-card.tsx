import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import type { AgentActionType, AgentActionStatus } from "../../lib/api";
import {
  FileText,
  FolderOpen,
  FilePlus,
  FileEdit,
  Trash2,
  Terminal,
  CheckCircle2,
  Check,
  X,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface ActionCardProps {
  id: string;
  type: AgentActionType;
  params: Record<string, unknown>;
  status: AgentActionStatus;
  result?: { success: boolean; output?: string; error?: string } | null;
  onApprove?: () => void;
  onReject?: () => void;
  isAwaitingApproval?: boolean;
}

const actionIcons: Record<AgentActionType, React.ComponentType<{ className?: string }>> = {
  readFile: FileText,
  listDirectory: FolderOpen,
  writeFile: FilePlus,
  editFile: FileEdit,
  deleteFile: Trash2,
  executeCommand: Terminal,
  completeTask: CheckCircle2,
};

const actionLabels: Record<AgentActionType, string> = {
  readFile: "Read File",
  listDirectory: "List Directory",
  writeFile: "Write File",
  editFile: "Edit File",
  deleteFile: "Delete File",
  executeCommand: "Execute Command",
  completeTask: "Complete Task",
};

const statusColors: Record<AgentActionStatus, string> = {
  proposed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  rejected: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  executing: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export function ActionCard({
  id,
  type,
  params,
  status,
  result,
  onApprove,
  onReject,
  isAwaitingApproval,
}: ActionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = actionIcons[type];

  const renderParams = () => {
    switch (type) {
      case "readFile":
      case "deleteFile":
        return <code className="text-xs">{params.path as string}</code>;
      case "listDirectory":
        return <code className="text-xs">{params.path as string}</code>;
      case "writeFile":
        return (
          <div className="space-y-2">
            <code className="text-xs block">{params.path as string}</code>
            {expanded && (
              <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-48">
                {params.content as string}
              </pre>
            )}
          </div>
        );
      case "editFile":
        return (
          <div className="space-y-2">
            <code className="text-xs block">{params.path as string}</code>
            {expanded && (
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-muted-foreground">Search:</span>
                  <pre className="text-xs bg-red-50 dark:bg-red-900/20 p-2 rounded overflow-x-auto">
                    {params.search as string}
                  </pre>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Replace:</span>
                  <pre className="text-xs bg-green-50 dark:bg-green-900/20 p-2 rounded overflow-x-auto">
                    {params.replace as string}
                  </pre>
                </div>
              </div>
            )}
          </div>
        );
      case "executeCommand":
        return (
          <div className="space-y-1">
            <code className="text-xs block bg-muted p-1 rounded">
              {params.command as string}
            </code>
            <p className="text-xs text-muted-foreground">{params.description as string}</p>
          </div>
        );
      case "completeTask":
        return <p className="text-xs">{params.summary as string}</p>;
      default:
        return <pre className="text-xs">{JSON.stringify(params, null, 2)}</pre>;
    }
  };

  const hasExpandableContent = type === "writeFile" || type === "editFile";

  return (
    <Card className={cn(
      "transition-all",
      status === "proposed" && isAwaitingApproval && "border-yellow-400 dark:border-yellow-600",
      status === "failed" && "border-red-400 dark:border-red-600"
    )}>
      <CardHeader className="p-3 pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">
              {actionLabels[type]}
            </CardTitle>
            <Badge variant="secondary" className={cn("text-xs", statusColors[status])}>
              {status === "executing" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {status}
            </Badge>
          </div>
          {hasExpandableContent && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        {renderParams()}

        {result && (
          <div className={cn(
            "mt-2 p-2 rounded text-xs",
            result.success
              ? "bg-green-50 dark:bg-green-900/20"
              : "bg-red-50 dark:bg-red-900/20"
          )}>
            {result.success ? (
              <div className="flex items-start gap-2">
                <Check className="h-3 w-3 text-green-600 dark:text-green-400 mt-0.5" />
                <span className="text-green-800 dark:text-green-200">
                  {result.output || "Success"}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3 w-3 text-red-600 dark:text-red-400 mt-0.5" />
                <span className="text-red-800 dark:text-red-200">{result.error}</span>
              </div>
            )}
          </div>
        )}

        {status === "proposed" && isAwaitingApproval && (
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onReject}
            >
              <X className="h-3 w-3 mr-1" />
              Reject
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={onApprove}>
              <Check className="h-3 w-3 mr-1" />
              Approve
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
