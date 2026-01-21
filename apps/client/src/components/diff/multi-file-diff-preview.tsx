import { useState, useMemo } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { DiffView, SplitDiffView, DiffStats } from "./diff-view";
import { computeDiff, computeDiffStats, type DiffLine } from "../../lib/diff";
import {
  Check,
  X,
  ChevronDown,
  ChevronUp,
  FilePlus,
  FileEdit,
  Trash2,
  SplitSquareVertical,
  AlignJustify,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";

export type FileChangeOperation = "create" | "modify" | "delete";

export interface FileChange {
  id: string;
  path: string;
  operation: FileChangeOperation;
  originalContent: string;
  newContent: string;
  status: "pending" | "approved" | "rejected";
}

interface MultiFileDiffPreviewProps {
  changes: FileChange[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  className?: string;
  isReadOnly?: boolean;
}

const operationIcons: Record<FileChangeOperation, typeof FilePlus> = {
  create: FilePlus,
  modify: FileEdit,
  delete: Trash2,
};

const operationLabels: Record<FileChangeOperation, string> = {
  create: "New File",
  modify: "Modified",
  delete: "Deleted",
};

const operationColors: Record<FileChangeOperation, string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  modify: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  delete: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

/**
 * Individual file change card with diff view
 */
function FileChangeCard({
  change,
  onApprove,
  onReject,
  isReadOnly,
  defaultExpanded,
  viewMode,
}: {
  change: FileChange;
  onApprove: () => void;
  onReject: () => void;
  isReadOnly?: boolean;
  defaultExpanded: boolean;
  viewMode: "unified" | "split";
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = operationIcons[change.operation];

  const diffLines = useMemo(
    () => computeDiff(change.originalContent, change.newContent),
    [change.originalContent, change.newContent]
  );

  const isActioned = change.status !== "pending";

  return (
    <Card
      className={cn(
        "transition-all",
        change.status === "rejected" && "opacity-60",
        change.status === "approved" && "border-green-400 dark:border-green-600"
      )}
    >
      <CardHeader className="p-3 pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <CardTitle className="text-sm font-medium truncate" title={change.path}>
              {change.path}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge
              variant="secondary"
              className={cn("text-xs", operationColors[change.operation])}
            >
              {operationLabels[change.operation]}
            </Badge>
            {change.status !== "pending" && (
              <Badge
                variant="secondary"
                className={cn("text-xs", statusColors[change.status])}
              >
                {change.status === "approved" && (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                )}
                {change.status === "rejected" && (
                  <XCircle className="h-3 w-3 mr-1" />
                )}
                {change.status}
              </Badge>
            )}
            <DiffStats lines={diffLines} />
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
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        {expanded && (
          <div className="mt-2">
            {viewMode === "unified" ? (
              <DiffView
                lines={diffLines}
                path={change.path}
                maxHeight="300px"
              />
            ) : (
              <SplitDiffView
                lines={diffLines}
                path={change.path}
                maxHeight="300px"
              />
            )}
          </div>
        )}

        {!isReadOnly && change.status === "pending" && (
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

/**
 * Multi-file diff preview component
 * Displays all proposed file changes with unified diff views
 * and approve/reject controls for each file and batch operations
 */
export function MultiFileDiffPreview({
  changes,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
  className,
  isReadOnly = false,
}: MultiFileDiffPreviewProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [expandAll, setExpandAll] = useState(true);
  const [showRejected, setShowRejected] = useState(true);

  // Compute overall stats
  const stats = useMemo(() => {
    let totalAdditions = 0;
    let totalDeletions = 0;

    changes.forEach((change) => {
      const lines = computeDiff(change.originalContent, change.newContent);
      const s = computeDiffStats(lines);
      totalAdditions += s.additions;
      totalDeletions += s.deletions;
    });

    return {
      files: changes.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      pending: changes.filter((c) => c.status === "pending").length,
      approved: changes.filter((c) => c.status === "approved").length,
      rejected: changes.filter((c) => c.status === "rejected").length,
    };
  }, [changes]);

  // Filter changes based on showRejected
  const visibleChanges = showRejected
    ? changes
    : changes.filter((c) => c.status !== "rejected");

  if (changes.length === 0) {
    return (
      <div className={cn("text-center text-muted-foreground p-4", className)}>
        No file changes to preview
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">{stats.files} files changed</span>
          <span className="text-green-600 dark:text-green-400">
            +{stats.additions}
          </span>
          <span className="text-red-600 dark:text-red-400">
            -{stats.deletions}
          </span>
          {stats.approved > 0 && (
            <Badge variant="success" className="text-xs">
              {stats.approved} approved
            </Badge>
          )}
          {stats.rejected > 0 && (
            <Badge variant="secondary" className="text-xs text-gray-500">
              {stats.rejected} rejected
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center border rounded-md">
            <Button
              variant={viewMode === "unified" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 rounded-r-none"
              onClick={() => setViewMode("unified")}
              title="Unified view"
            >
              <AlignJustify className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "split" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 rounded-l-none"
              onClick={() => setViewMode("split")}
              title="Split view"
            >
              <SplitSquareVertical className="h-4 w-4" />
            </Button>
          </div>

          {/* Expand/collapse all */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => setExpandAll(!expandAll)}
            title={expandAll ? "Collapse all" : "Expand all"}
          >
            {expandAll ? (
              <EyeOff className="h-4 w-4 mr-1" />
            ) : (
              <Eye className="h-4 w-4 mr-1" />
            )}
            {expandAll ? "Collapse" : "Expand"}
          </Button>

          {/* Show/hide rejected */}
          {stats.rejected > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => setShowRejected(!showRejected)}
            >
              {showRejected ? "Hide rejected" : "Show rejected"}
            </Button>
          )}
        </div>
      </div>

      {/* File changes list */}
      <div className="space-y-3">
        {visibleChanges.map((change) => (
          <FileChangeCard
            key={change.id}
            change={change}
            onApprove={() => onApprove(change.id)}
            onReject={() => onReject(change.id)}
            isReadOnly={isReadOnly}
            defaultExpanded={expandAll}
            viewMode={viewMode}
          />
        ))}
      </div>

      {/* Batch actions footer */}
      {!isReadOnly && stats.pending > 0 && (
        <div className="flex gap-2 p-3 bg-muted/30 rounded-lg border">
          <Button variant="outline" className="flex-1" onClick={onRejectAll}>
            <X className="h-4 w-4 mr-2" />
            Reject All ({stats.pending})
          </Button>
          <Button className="flex-1" onClick={onApproveAll}>
            <Check className="h-4 w-4 mr-2" />
            Approve All ({stats.pending})
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Export types for use in other components
 */
export type { FileChange as FileChangeType };
