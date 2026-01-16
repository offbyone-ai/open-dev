import type { ToolCall } from "../../lib/api";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Check, X, Pencil, Plus, Trash2, Edit3 } from "lucide-react";

interface ProposedChangesProps {
  changes: ToolCall[];
  onApprove?: () => void;
  onDeny?: () => void;
  onEdit?: () => void;
}

const toolIcons: Record<string, typeof Plus> = {
  createTask: Plus,
  updateTask: Edit3,
  deleteTask: Trash2,
};

const toolLabels: Record<string, string> = {
  createTask: "Create Task",
  updateTask: "Update Task",
  deleteTask: "Delete Task",
  listTasks: "List Tasks",
};

export function ProposedChanges({ changes, onApprove, onDeny, onEdit }: ProposedChangesProps) {
  if (changes.length === 0) return null;

  return (
    <Card className="mt-2">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          Proposed Changes
          <Badge variant="secondary" className="text-xs">
            {changes.length} action{changes.length > 1 ? "s" : ""}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2 px-4 space-y-2">
        {changes.map((change, index) => {
          const Icon = toolIcons[change.toolName] || Edit3;
          return (
            <div
              key={change.toolCallId || index}
              className="flex items-start gap-2 p-2 rounded bg-muted/50"
            >
              <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {toolLabels[change.toolName] || change.toolName}
                </p>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {Object.entries(change.args).map(([key, value]) => (
                    <p key={key} className="truncate">
                      <span className="font-medium">{key}:</span>{" "}
                      {typeof value === "string" ? value : JSON.stringify(value)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <div className="flex gap-2 pt-2">
          <Button size="sm" onClick={onApprove} className="flex-1">
            <Check className="h-4 w-4 mr-1" />
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={onDeny}>
            <X className="h-4 w-4 mr-1" />
            Deny
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
