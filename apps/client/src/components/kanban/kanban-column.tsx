import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task, TaskStatus } from "../../lib/api";
import { TaskCard } from "./task-card";
import { cn } from "../../lib/utils";
import { Plus } from "lucide-react";
import { Button } from "../ui/button";

interface KanbanColumnProps {
  id: TaskStatus;
  title: string;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onAddTask: () => void;
}

export function KanbanColumn({ id, title, tasks, onTaskClick, onAddTask }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "column", status: id },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col bg-muted/50 rounded-lg p-3 min-h-[500px] w-80 flex-shrink-0",
        isOver && "bg-muted"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          {title}
          <span className="bg-muted-foreground/20 text-muted-foreground px-2 py-0.5 rounded-full text-xs">
            {tasks.length}
          </span>
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onAddTask}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
