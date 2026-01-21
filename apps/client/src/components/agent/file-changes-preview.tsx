import { useState, useEffect, useMemo } from "react";
import { agentAPI, type AgentActionType, type AgentActionStatus } from "../../lib/api";
import { MultiFileDiffPreview, type FileChange, type FileChangeOperation } from "../diff";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Loader2, FileCode, List } from "lucide-react";

interface ActionState {
  id: string;
  type: AgentActionType;
  params: Record<string, unknown>;
  status: AgentActionStatus;
  result?: { success: boolean; output?: string; error?: string };
}

interface FileChangesPreviewProps {
  projectId: string;
  actions: ActionState[];
  isAwaitingApproval: boolean;
  onApprove: (actionId: string) => void;
  onReject: (actionId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  className?: string;
}

type ViewMode = "diff" | "list";

/**
 * FileChangesPreview component
 * Displays file changes from agent actions with diff view support
 * Fetches original file content for comparison when showing diffs
 */
export function FileChangesPreview({
  projectId,
  actions,
  isAwaitingApproval,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
  className,
}: FileChangesPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("diff");
  const [originalContents, setOriginalContents] = useState<
    Record<string, { content: string; exists: boolean }>
  >({});
  const [isLoadingContents, setIsLoadingContents] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter to only file-changing actions (writeFile, editFile, deleteFile)
  const fileActions = useMemo(
    () =>
      actions.filter((a) =>
        ["writeFile", "editFile", "deleteFile"].includes(a.type)
      ),
    [actions]
  );

  // Get unique file paths that need original content fetched
  const filePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const action of fileActions) {
      const path = action.params.path as string;
      if (path) {
        paths.add(path);
      }
    }
    return Array.from(paths);
  }, [fileActions]);

  // Fetch original file contents when file paths change
  useEffect(() => {
    if (filePaths.length === 0) return;

    const fetchContents = async () => {
      setIsLoadingContents(true);
      setLoadError(null);

      try {
        const contents = await agentAPI.readFileContents(projectId, filePaths);
        setOriginalContents(contents);
      } catch (err) {
        console.error("Failed to fetch file contents:", err);
        setLoadError(
          err instanceof Error ? err.message : "Failed to load file contents"
        );
        // Initialize with empty contents on error
        const emptyContents: Record<string, { content: string; exists: boolean }> = {};
        for (const path of filePaths) {
          emptyContents[path] = { content: "", exists: false };
        }
        setOriginalContents(emptyContents);
      } finally {
        setIsLoadingContents(false);
      }
    };

    fetchContents();
  }, [projectId, filePaths]);

  // Convert actions to FileChange format for diff preview
  const fileChanges: FileChange[] = useMemo(() => {
    return fileActions.map((action) => {
      const path = action.params.path as string;
      const original = originalContents[path] || { content: "", exists: false };

      let operation: FileChangeOperation;
      let newContent: string;

      switch (action.type) {
        case "writeFile":
          operation = original.exists ? "modify" : "create";
          newContent = action.params.content as string;
          break;
        case "editFile":
          operation = "modify";
          // Apply the search/replace to get new content
          const search = action.params.search as string;
          const replace = action.params.replace as string;
          newContent = original.content.replace(search, replace);
          break;
        case "deleteFile":
          operation = "delete";
          newContent = "";
          break;
        default:
          operation = "modify";
          newContent = "";
      }

      // Map action status to FileChange status
      let status: FileChange["status"];
      switch (action.status) {
        case "proposed":
          status = "pending";
          break;
        case "approved":
          status = "approved";
          break;
        case "rejected":
          status = "rejected";
          break;
        default:
          status = "pending";
      }

      return {
        id: action.id,
        path,
        operation,
        originalContent: original.content,
        newContent,
        status,
      };
    });
  }, [fileActions, originalContents]);

  // Handle approve for a specific file change
  const handleApprove = (id: string) => {
    onApprove(id);
  };

  // Handle reject for a specific file change
  const handleReject = (id: string) => {
    onReject(id);
  };

  // Handle approve all file changes
  const handleApproveAll = () => {
    onApproveAll();
  };

  // Handle reject all file changes
  const handleRejectAll = () => {
    const pendingIds = fileChanges
      .filter((c) => c.status === "pending")
      .map((c) => c.id);
    for (const id of pendingIds) {
      onReject(id);
    }
  };

  // If no file actions, return null
  if (fileActions.length === 0) {
    return null;
  }

  // Loading state
  if (isLoadingContents) {
    return (
      <div className={cn("flex items-center justify-center p-4", className)}>
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm text-muted-foreground">
          Loading file contents for diff preview...
        </span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* View mode toggle and stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {fileChanges.length} file{fileChanges.length !== 1 ? "s" : ""}
          </Badge>
          {loadError && (
            <span className="text-xs text-yellow-600 dark:text-yellow-400">
              (Some content unavailable)
            </span>
          )}
        </div>
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

      {/* Render based on view mode */}
      {viewMode === "diff" ? (
        <MultiFileDiffPreview
          changes={fileChanges}
          onApprove={handleApprove}
          onReject={handleReject}
          onApproveAll={handleApproveAll}
          onRejectAll={handleRejectAll}
          isReadOnly={!isAwaitingApproval}
        />
      ) : (
        // List view - render original ActionCards through parent
        <div className="text-sm text-muted-foreground text-center p-2">
          Showing list view. Switch to "Diff" for side-by-side comparison.
        </div>
      )}
    </div>
  );
}
