import { useState, useEffect, useMemo } from "react";
import type { Task, TaskStatus, TaskPriority, CreateTask, TaskTemplate } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Select } from "../ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Bot, Link2, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { TemplateSelector } from "./template-selector";
import { TemplateManager } from "./template-manager";
import { Badge } from "../ui/badge";

interface TaskFormProps {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaultStatus?: TaskStatus;
  projectId: string;
  allTasks: Task[]; // All tasks in the project for dependency selection
  onSubmit: (data: CreateTask) => Promise<void>;
  onDelete?: () => Promise<void>;
  onStartAgent?: (task: Task) => void;
  hasAIProvider?: boolean;
}

const statusOptions = [
  { value: "backlog", label: "Backlog" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function TaskForm({ open, onClose, task, defaultStatus, projectId, allTasks, onSubmit, onDelete, onStartAgent, hasAIProvider }: TaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [showDependencies, setShowDependencies] = useState(false);

  // Get available tasks for dependencies (exclude current task)
  const availableTasks = useMemo(() => {
    return allTasks.filter(t => t.id !== task?.id);
  }, [allTasks, task?.id]);

  // Check if selecting a dependency would create a cycle
  const wouldCreateCycle = (depId: string, newDeps: string[]): boolean => {
    // Simple DFS to check for cycles
    const visited = new Set<string>();
    const toVisit = [...newDeps, depId];
    const currentId = task?.id;

    while (toVisit.length > 0) {
      const id = toVisit.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const depTask = allTasks.find(t => t.id === id);
      if (!depTask) continue;

      // If any dependency depends on our current task, it would create a cycle
      if (depTask.dependsOn.includes(currentId || "")) {
        return true;
      }

      // Add this task's dependencies to check
      toVisit.push(...depTask.dependsOn);
    }

    return false;
  };

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setStatus(task.status);
      setPriority(task.priority);
      setDependsOn(task.dependsOn || []);
      setShowDependencies((task.dependsOn || []).length > 0);
    } else {
      setTitle("");
      setDescription("");
      setStatus(defaultStatus || "backlog");
      setPriority("medium");
      setDependsOn([]);
      setShowDependencies(false);
    }
  }, [task, defaultStatus, open]);

  const handleSelectTemplate = (template: TaskTemplate) => {
    // Build description from template description and acceptance criteria
    let fullDescription = template.description || "";
    if (template.acceptanceCriteria) {
      if (fullDescription) {
        fullDescription += "\n\n## Acceptance Criteria\n" + template.acceptanceCriteria;
      } else {
        fullDescription = "## Acceptance Criteria\n" + template.acceptanceCriteria;
      }
    }

    setTitle(template.name);
    setDescription(fullDescription);
    setPriority(template.defaultPriority);
  };

  const toggleDependency = (depId: string) => {
    setDependsOn(prev => {
      if (prev.includes(depId)) {
        return prev.filter(id => id !== depId);
      }
      // Check for cycles before adding
      if (task && wouldCreateCycle(depId, prev)) {
        setError("Cannot add this dependency - it would create a circular dependency");
        return prev;
      }
      return [...prev, depId];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await onSubmit({ title, description: description || undefined, status, priority, dependsOn });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !confirm("Are you sure you want to delete this task?")) return;
    setLoading(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{task ? "Edit Task" : "Create Task"}</span>
              {!task && (
                <TemplateSelector
                  projectId={projectId}
                  onSelectTemplate={handleSelectTemplate}
                  onManageTemplates={() => setTemplateManagerOpen(true)}
                />
              )}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Task description..."
                rows={5}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  id="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  options={statusOptions}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  options={priorityOptions}
                />
              </div>
            </div>

            {/* Dependencies Section */}
            {availableTasks.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowDependencies(!showDependencies)}
                  className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                >
                  <Link2 className="h-4 w-4" />
                  <span>Dependencies</span>
                  {dependsOn.length > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {dependsOn.length}
                    </Badge>
                  )}
                  {showDependencies ? (
                    <ChevronUp className="h-4 w-4 ml-auto" />
                  ) : (
                    <ChevronDown className="h-4 w-4 ml-auto" />
                  )}
                </button>

                {showDependencies && (
                  <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                    <p className="text-xs text-muted-foreground mb-2">
                      Select tasks that must be completed before this task can start:
                    </p>
                    {availableTasks.map((t) => {
                      const isSelected = dependsOn.includes(t.id);
                      const isBlocked = t.status !== "done";
                      return (
                        <label
                          key={t.id}
                          className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleDependency(t.id)}
                            className="rounded border-input"
                          />
                          <span className="flex-1 text-sm truncate">{t.title}</span>
                          {isBlocked && isSelected && (
                            <AlertCircle className="h-3 w-3 text-yellow-500" title="This task is not yet done" />
                          )}
                          <Badge
                            variant="outline"
                            className="text-xs shrink-0"
                          >
                            {t.status.replace("_", " ")}
                          </Badge>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <DialogFooter className="gap-2">
              {task && onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  Delete
                </Button>
              )}
              <div className="flex-1" />
              {task && hasAIProvider && onStartAgent && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    onStartAgent(task);
                    onClose();
                  }}
                >
                  <Bot className="h-4 w-4 mr-2" />
                  Start Agent
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : task ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TemplateManager
        projectId={projectId}
        open={templateManagerOpen}
        onClose={() => setTemplateManagerOpen(false)}
      />
    </>
  );
}
