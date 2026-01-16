import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Task, TaskStatus } from "../../lib/api";
import { KanbanColumn } from "./kanban-column";
import { TaskCard } from "./task-card";

interface KanbanBoardProps {
  tasks: Task[];
  onTaskMove: (taskId: string, status: TaskStatus, position: number) => void;
  onTaskClick: (task: Task) => void;
  onAddTask: (status: TaskStatus) => void;
}

const columns: { id: TaskStatus; title: string }[] = [
  { id: "backlog", title: "Backlog" },
  { id: "in_progress", title: "In Progress" },
  { id: "validation", title: "Validation" },
  { id: "done", title: "Done" },
];

export function KanbanBoard({ tasks, onTaskMove, onTaskClick, onAddTask }: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Custom collision detection for kanban board
  const collisionDetection: CollisionDetection = (args) => {
    // Get all collisions using rect intersection (more reliable for columns)
    const rectCollisions = rectIntersection(args);

    if (rectCollisions.length === 0) {
      return [];
    }

    // Get the active task's current status
    const activeId = args.active.id;
    const activeTaskData = tasks.find(t => t.id === activeId);
    const activeStatus = activeTaskData?.status;

    // Find column collisions
    const columnCollisions = rectCollisions.filter(c =>
      columns.some(col => col.id === c.id)
    );

    // Find task collisions
    const taskCollisions = rectCollisions.filter(c =>
      !columns.some(col => col.id === c.id)
    );

    // If we're over a different column, prefer the column as the drop target
    const differentColumnCollision = columnCollisions.find(c => c.id !== activeStatus);
    if (differentColumnCollision && taskCollisions.length === 0) {
      return [differentColumnCollision];
    }

    // If we have task collisions, return them for reordering within column
    if (taskCollisions.length > 0) {
      // Check if any of these tasks are in a different column
      const crossColumnTask = taskCollisions.find(c => {
        const task = tasks.find(t => t.id === c.id);
        return task && task.status !== activeStatus;
      });

      if (crossColumnTask) {
        return [crossColumnTask];
      }

      return taskCollisions;
    }

    // Fall back to any collision
    return rectCollisions;
  };

  const getTasksByStatus = (status: TaskStatus) => {
    return tasks
      .filter((t) => t.status === status)
      .sort((a, b) => a.position - b.position);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    // Handle drag over if needed for visual feedback
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeTaskId = active.id as string;
    const overData = over.data.current as { type: string; status?: TaskStatus; task?: Task } | undefined;

    // Determine target status
    let targetStatus: TaskStatus;
    let targetPosition: number;

    // Check if dropped on a column (using data.type)
    if (overData?.type === "column" && overData.status) {
      targetStatus = overData.status;
      const columnTasks = getTasksByStatus(targetStatus);
      targetPosition = columnTasks.length;
    } else if (overData?.type === "task" && overData.task) {
      // Dropped on another task
      const overTask = overData.task;
      targetStatus = overTask.status;
      const columnTasks = getTasksByStatus(targetStatus);
      const overIndex = columnTasks.findIndex((t) => t.id === overTask.id);
      targetPosition = overIndex >= 0 ? overIndex : columnTasks.length;
    } else {
      // Fallback: check by ID
      const overId = over.id as string;
      const isColumn = columns.some((c) => c.id === overId);

      if (isColumn) {
        targetStatus = overId as TaskStatus;
        const columnTasks = getTasksByStatus(targetStatus);
        targetPosition = columnTasks.length;
      } else {
        const overTask = tasks.find((t) => t.id === overId);
        if (!overTask) return;

        targetStatus = overTask.status;
        const columnTasks = getTasksByStatus(targetStatus);
        const overIndex = columnTasks.findIndex((t) => t.id === overId);
        targetPosition = overIndex >= 0 ? overIndex : columnTasks.length;
      }
    }

    const activeTaskData = tasks.find((t) => t.id === activeTaskId);
    if (!activeTaskData) return;

    // Only move if something changed
    if (activeTaskData.status !== targetStatus || activeTaskData.position !== targetPosition) {
      onTaskMove(activeTaskId, targetStatus, targetPosition);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            id={column.id}
            title={column.title}
            tasks={getTasksByStatus(column.id)}
            onTaskClick={onTaskClick}
            onAddTask={() => onAddTask(column.id)}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
