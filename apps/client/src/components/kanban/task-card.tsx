import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "../../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { GripVertical, Link2, Lock } from "lucide-react";

interface TaskCardProps {
  task: Task;
  allTasks?: Task[]; // For computing blocked status
  onClick?: () => void;
}

const priorityColors = {
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export function TaskCard({ task, allTasks = [], onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Check if task has dependencies
  const hasDependencies = task.dependsOn && task.dependsOn.length > 0;

  // Check if task is blocked (has incomplete dependencies)
  const isBlocked = hasDependencies && task.dependsOn.some((depId: string) => {
    const depTask = allTasks.find((t: Task) => t.id === depId);
    return depTask && depTask.status !== "done";
  });

  // Get blocking task names for tooltip
  const blockingTaskNames = hasDependencies
    ? task.dependsOn
        .map((depId: string) => allTasks.find((t: Task) => t.id === depId))
        .filter((t): t is Task => t !== undefined && t.status !== "done")
        .map((t: Task) => t.title)
    : [];

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-pointer hover:border-primary/50 transition-colors",
        isDragging && "opacity-50",
        isBlocked && "border-yellow-500/50 bg-yellow-50/30 dark:bg-yellow-900/10"
      )}
      onClick={onClick}
    >
      <CardHeader className="p-3 pb-1 flex flex-row items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab active:cursor-grabbing touch-none"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-sm font-medium leading-tight flex items-center gap-1.5">
            {isBlocked && (
              <span title={`Blocked by: ${blockingTaskNames.join(", ")}`}>
                <Lock className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
              </span>
            )}
            <span className={cn(isBlocked && "text-muted-foreground")}>
              {task.title}
            </span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1 pl-9">
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            variant="secondary"
            className={cn("text-xs", priorityColors[task.priority])}
          >
            {task.priority}
          </Badge>
          {hasDependencies && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                isBlocked
                  ? "border-yellow-500/50 text-yellow-600 dark:text-yellow-500"
                  : "border-green-500/50 text-green-600 dark:text-green-500"
              )}
              title={isBlocked
                ? `Blocked by: ${blockingTaskNames.join(", ")}`
                : `Dependencies complete`
              }
            >
              <Link2 className="h-3 w-3 mr-1" />
              {task.dependsOn.length}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
