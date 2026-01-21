import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import { useSession } from "../lib/auth-client";
import {
  projectsAPI,
  tasksAPI,
  aiProvidersAPI,
  type Project,
  type Task,
  type TaskStatus,
  type AIProvider,
  type CreateTask,
} from "../lib/api";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { KanbanBoard } from "../components/kanban/kanban-board";
import { TaskForm } from "../components/kanban/task-form";
import { ChatPanel } from "../components/chat/chat-panel";
import { AgentPanel, WorkingDirectorySetup, ExecutionHistoryPanel, ExecutionDetailView } from "../components/agent";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { ArrowLeft, Settings, MessageSquare, Kanban, Sparkles, Loader2, Bot, History } from "lucide-react";

export function ProjectPage() {
  const { projectId } = useParams({ from: "/project/$projectId" });
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<"kanban" | "chat">("kanban");

  // Dialog states
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>("backlog");
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasShownOnboarding, setHasShownOnboarding] = useState(false);

  // Agent states
  const [agentTask, setAgentTask] = useState<Task | null>(null);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [showWorkingDirSetup, setShowWorkingDirSetup] = useState(false);

  // Execution history states
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) {
      navigate({ to: "/login" });
    }
  }, [session, isPending, navigate]);

  useEffect(() => {
    if (session && projectId) {
      loadData();
    }
  }, [session, projectId]);

  const loadData = async () => {
    try {
      const [projectData, tasksData, providersData] = await Promise.all([
        projectsAPI.get(projectId),
        tasksAPI.list(projectId),
        aiProvidersAPI.list(),
      ]);
      setProject(projectData);
      setTasks(tasksData);
      setProviders(providersData);
    } catch (err) {
      console.error("Failed to load data:", err);
      navigate({ to: "/dashboard" });
    } finally {
      setLoading(false);
    }
  };

  // Show onboarding or settings when project has no tasks
  useEffect(() => {
    if (!loading && project && tasks.length === 0 && !hasShownOnboarding) {
      if (project.aiProviderId) {
        // Has AI provider - show onboarding to generate tasks
        setShowOnboarding(true);
      } else if (providers.length > 0) {
        // No AI provider configured but providers exist - show settings to configure
        setShowSettings(true);
      }
      setHasShownOnboarding(true);
    }
  }, [loading, project, tasks.length, providers.length, hasShownOnboarding]);

  const loadTasks = async () => {
    try {
      const tasksData = await tasksAPI.list(projectId);
      setTasks(tasksData);
    } catch (err) {
      console.error("Failed to load tasks:", err);
    }
  };

  const handleTaskMove = async (taskId: string, status: TaskStatus, position: number) => {
    const task = tasks.find((t) => t.id === taskId);
    const wasNotInProgress = task?.status !== "in_progress";

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status, position } : t))
    );

    try {
      await tasksAPI.reorder(projectId, taskId, { status, position });
      await loadTasks();

      // If task was moved to "in_progress" and wasn't already there, show agent panel
      if (status === "in_progress" && wasNotInProgress && project?.aiProviderId) {
        const updatedTask = tasks.find((t) => t.id === taskId);
        if (updatedTask) {
          setAgentTask({ ...updatedTask, status, position });
          setShowAgentPanel(true);
        }
      }
    } catch (err) {
      console.error("Failed to move task:", err);
      await loadTasks();
    }
  };

  const handleCreateTask = async (data: CreateTask) => {
    await tasksAPI.create(projectId, data);
    await loadTasks();
  };

  const handleUpdateTask = async (data: CreateTask) => {
    if (!editingTask) return;
    await tasksAPI.update(projectId, editingTask.id, data);
    await loadTasks();
  };

  const handleDeleteTask = async () => {
    if (!editingTask) return;
    await tasksAPI.delete(projectId, editingTask.id);
    await loadTasks();
  };

  const handleAddTask = (status: TaskStatus) => {
    setEditingTask(null);
    setNewTaskStatus(status);
    setShowTaskForm(true);
  };

  const handleTaskClick = (task: Task) => {
    setEditingTask(task);
    setShowTaskForm(true);
  };

  if (isPending || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="font-semibold">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-muted-foreground truncate">
                {project.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={activeView === "kanban" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveView("kanban")}
            >
              <Kanban className="h-4 w-4 mr-2" />
              Board
            </Button>
            <Button
              variant={activeView === "chat" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveView("chat")}
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              AI Chat
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowHistoryPanel(true);
                setSelectedExecutionId(null);
              }}
              title="Execution History"
            >
              <History className="h-4 w-4 mr-2" />
              History
            </Button>
            <Button variant="outline" size="icon" onClick={() => setShowSettings(true)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex">
        <div className={`flex-1 overflow-hidden transition-all ${showAgentPanel ? "mr-96" : ""}`}>
          {activeView === "kanban" ? (
            <div className="h-full p-4 overflow-auto">
              <KanbanBoard
                tasks={tasks}
                onTaskMove={handleTaskMove}
                onTaskClick={handleTaskClick}
                onAddTask={handleAddTask}
              />
            </div>
          ) : (
            <ChatPanel
              projectId={projectId}
              hasAIProvider={!!project.aiProviderId}
              onTasksChanged={loadTasks}
            />
          )}
        </div>

        {/* Agent Panel */}
        {showAgentPanel && agentTask && project && (
          <div className="fixed right-0 top-[57px] bottom-0 w-96 border-l bg-background overflow-hidden">
            <AgentPanel
              project={project}
              task={agentTask}
              onClose={() => {
                setShowAgentPanel(false);
                setAgentTask(null);
              }}
              onTaskUpdated={loadTasks}
              onSetupWorkingDirectory={() => setShowWorkingDirSetup(true)}
            />
          </div>
        )}

        {/* Execution History Panel */}
        {showHistoryPanel && project && (
          <div className="fixed right-0 top-[57px] bottom-0 w-96 border-l bg-background overflow-hidden">
            {selectedExecutionId ? (
              <ExecutionDetailView
                executionId={selectedExecutionId}
                onBack={() => setSelectedExecutionId(null)}
                onClose={() => {
                  setShowHistoryPanel(false);
                  setSelectedExecutionId(null);
                }}
              />
            ) : (
              <ExecutionHistoryPanel
                projectId={project.id}
                onViewDetail={(id) => setSelectedExecutionId(id)}
                onClose={() => setShowHistoryPanel(false)}
              />
            )}
          </div>
        )}
      </main>

      {/* Task Form Dialog */}
      <TaskForm
        open={showTaskForm}
        onClose={() => {
          setShowTaskForm(false);
          setEditingTask(null);
        }}
        task={editingTask}
        defaultStatus={newTaskStatus}
        projectId={projectId}
        allTasks={tasks}
        onSubmit={editingTask ? handleUpdateTask : handleCreateTask}
        onDelete={editingTask ? handleDeleteTask : undefined}
        hasAIProvider={!!project.aiProviderId}
        onStartAgent={(task) => {
          setAgentTask(task);
          setShowAgentPanel(true);
        }}
      />

      {/* Settings Dialog */}
      <ProjectSettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        project={project}
        providers={providers}
        onSave={async (data) => {
          await projectsAPI.update(projectId, data);
          const updated = await projectsAPI.get(projectId);
          setProject(updated);
          // If AI provider was just assigned and no tasks exist, show onboarding
          if (data.aiProviderId && !project.aiProviderId && tasks.length === 0) {
            setShowOnboarding(true);
          }
        }}
        onDelete={async () => {
          await projectsAPI.delete(projectId);
          navigate({ to: "/dashboard" });
        }}
      />

      {/* Onboarding Dialog */}
      <ProjectOnboardingDialog
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        project={project}
        onTasksGenerated={async () => {
          await loadTasks();
          setActiveView("kanban");
        }}
      />

      {/* Working Directory Setup Dialog */}
      <WorkingDirectorySetup
        project={project}
        open={showWorkingDirSetup}
        onOpenChange={setShowWorkingDirSetup}
        onComplete={async () => {
          // Refresh project to get updated working directory
          const updated = await projectsAPI.get(projectId);
          setProject(updated);
        }}
      />
    </div>
  );
}

function ProjectSettingsDialog({
  open,
  onClose,
  project,
  providers,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  providers: AIProvider[];
  onSave: (data: { name?: string; description?: string; guidelines?: string; aiProviderId?: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [guidelines, setGuidelines] = useState(project.guidelines || "");
  const [aiProviderId, setAiProviderId] = useState(project.aiProviderId || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description || "");
    setGuidelines(project.guidelines || "");
    setAiProviderId(project.aiProviderId || "");
  }, [project, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await onSave({
        name,
        description: description || undefined,
        guidelines: guidelines || undefined,
        aiProviderId: aiProviderId || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="settings-name">Project Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-provider">AI Provider</Label>
            <Select
              id="settings-provider"
              value={aiProviderId}
              onChange={(e) => setAiProviderId(e.target.value)}
              options={[
                { value: "", label: "None" },
                ...providers.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-guidelines">AI Guidelines</Label>
            <Textarea
              id="settings-guidelines"
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              placeholder="Instructions for how the AI should help plan tasks..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              These guidelines will be included in the AI's system prompt to guide its behavior.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Settings"}
            </Button>
          </DialogFooter>

          {/* Delete Project Section */}
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-destructive">Delete Project</p>
                <p className="text-xs text-muted-foreground">
                  Permanently delete this project and all its tasks.
                </p>
              </div>
              {!showDeleteConfirm ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await onDelete();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to delete");
                        setDeleting(false);
                        setShowDeleteConfirm(false);
                      }
                    }}
                  >
                    {deleting ? "Deleting..." : "Confirm Delete"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectOnboardingDialog({
  open,
  onClose,
  project,
  onTasksGenerated,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  onTasksGenerated: () => void;
}) {
  const [description, setDescription] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const [createdTasks, setCreatedTasks] = useState<Task[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/projects/${project.id}/chat` }),
    [project.id]
  );

  const [isComplete, setIsComplete] = useState(false);

  const loadCreatedTasks = async () => {
    try {
      const tasks = await tasksAPI.list(project.id);
      setCreatedTasks(tasks);
    } catch (err) {
      console.error("Failed to load tasks:", err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await tasksAPI.delete(project.id, taskId);
      setCreatedTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  };

  const {
    messages,
    sendMessage,
    status,
    error,
  } = useChat({
    transport,
    onFinish: async () => {
      // AI has finished, load created tasks for review
      await loadCreatedTasks();
      setIsComplete(true);
      setIsReviewing(true);
    },
  });

  const handleGenerate = () => {
    if (!description.trim()) return;

    setHasStarted(true);
    const prompt = `I'm starting a new project called "${project.name}"${project.description ? ` - ${project.description}` : ""}.

Here's what I want to build:
${description}

Please analyze this and create an initial set of tasks to help me get started. Break down the work into manageable tasks with appropriate priorities. Focus on the most important first steps.`;

    sendMessage({ text: prompt });
  };

  const handleSkip = () => {
    onClose();
  };

  const isLoading = status === "streaming" || status === "submitted";

  // Get tool invocations from the latest assistant message
  const latestAssistantMessage = messages.filter(m => m.role === "assistant").pop();

  // Extract text content from message parts
  const getTextContent = (msg: typeof latestAssistantMessage) => {
    if (!msg?.parts) return "";
    return msg.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map(p => p.text)
      .join("");
  };

  const textContent = getTextContent(latestAssistantMessage);

  // Tool parts have type like "tool-createTask", "tool-updateTask", etc.
  // Extract tool parts from the message
  const createTaskCalls = (latestAssistantMessage?.parts || [])
    .filter(p => p.type === "tool-createTask" || (typeof p.type === "string" && p.type.includes("createTask")))
    .map(p => {
      const toolPart = p as {
        type: string;
        toolCallId: string;
        state: string;
        input?: Record<string, unknown>;
        output?: unknown;
      };
      return toolPart;
    });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Let's Plan Your Project
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
            Error: {error.message}
          </div>
        )}

        {hasStarted ? (
          // Show AI response and tool calls
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {textContent && (
              <div className="p-4 bg-muted rounded-lg text-sm max-h-48 overflow-y-auto">
                <p className="whitespace-pre-wrap">{textContent}</p>
              </div>
            )}

            {isLoading && !textContent && (
              <div className="p-4 bg-muted rounded-lg text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-muted-foreground">AI is analyzing your project...</span>
                </div>
              </div>
            )}

            {createTaskCalls.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {isComplete ? "Created tasks:" : "Creating tasks:"}
                </p>
                <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                  {createTaskCalls.map((tool, i) => {
                    const input = tool.input as { title: string; priority?: string } | undefined;
                    const state = tool.state;
                    const errorText = (tool as { errorText?: string }).errorText;

                    // Handle error state with helpful message
                    if (state === "output-error") {
                      return (
                        <div key={i} className="p-3 text-sm text-destructive">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="h-4 w-4 rounded-full bg-red-500 flex items-center justify-center">
                              <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </div>
                            <span>Tool call failed</span>
                          </div>
                          {errorText?.includes("invalid_type") && (
                            <p className="text-xs text-muted-foreground ml-6">
                              The AI model may not support tool calling. Try a different model like Devstral or Llama 3.
                            </p>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={i} className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {state === "output-available" ? (
                            <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                              <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          ) : (
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          )}
                          <span className="text-sm">{input?.title || "Creating task..."}</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          input?.priority === "high" ? "bg-red-100 text-red-800" :
                          input?.priority === "medium" ? "bg-yellow-100 text-yellow-800" :
                          "bg-green-100 text-green-800"
                        }`}>
                          {input?.priority || "medium"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {isComplete && isReviewing && createdTasks.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">Review Created Tasks</h4>
                  <span className="text-xs text-muted-foreground">{createdTasks.length} tasks</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Remove any tasks you don't want before continuing to the board.
                </p>
                <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                  {createdTasks.map((task) => (
                    <div key={task.id} className="p-3 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        {task.description && (
                          <p className="text-xs text-muted-foreground truncate">{task.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          task.priority === "high" ? "bg-red-100 text-red-800" :
                          task.priority === "medium" ? "bg-yellow-100 text-yellow-800" :
                          "bg-green-100 text-green-800"
                        }`}>
                          {task.priority}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteTask(task.id)}
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isComplete && (
              <DialogFooter>
                <Button onClick={() => { onTasksGenerated(); onClose(); }}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {createdTasks.length > 0 ? `Continue with ${createdTasks.length} Tasks` : "Done - View Board"}
                </Button>
              </DialogFooter>
            )}
          </div>
        ) : (
          // Show input form
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Describe what you want to build and I'll help you create an initial set of tasks to get started.
            </p>

            <div className="space-y-2">
              <Label htmlFor="project-description">What are you building?</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., A mobile app for tracking daily habits with reminders, statistics, and social features..."
                rows={4}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleSkip}>
                Skip for Now
              </Button>
              <Button onClick={handleGenerate} disabled={!description.trim()}>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Tasks
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
