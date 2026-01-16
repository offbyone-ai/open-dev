import { z } from "zod";
import { tool, zodSchema } from "ai";
import type { Session } from "../auth";

// Tool input schemas
const createTaskSchema = z.object({
  title: z.string().describe("The title of the task"),
  description: z.string().optional().describe("A detailed description of what needs to be done"),
  status: z.enum(["backlog", "in_progress", "done"]).default("backlog").describe("The initial status of the task"),
  priority: z.enum(["low", "medium", "high"]).default("medium").describe("The priority level of the task"),
});

const updateTaskSchema = z.object({
  taskId: z.string().describe("The ID of the task to update"),
  title: z.string().optional().describe("New title for the task"),
  description: z.string().optional().describe("New description for the task"),
  status: z.enum(["backlog", "in_progress", "done"]).optional().describe("New status for the task"),
  priority: z.enum(["low", "medium", "high"]).optional().describe("New priority level"),
});

const deleteTaskSchema = z.object({
  taskId: z.string().describe("The ID of the task to delete"),
});

const listTasksSchema = z.object({});

type CreateTaskInput = z.infer<typeof createTaskSchema>;
type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;

// Function to create tools with execute functions bound to session/projectId
export function createTaskTools(
  session: Session,
  projectId: string,
  taskOperations: {
    createTask: (session: Session, projectId: string, data: CreateTaskInput) => Promise<{ id: string }>;
    updateTask: (session: Session, projectId: string, taskId: string, data: Partial<CreateTaskInput>) => Promise<{ success: boolean }>;
    deleteTask: (session: Session, projectId: string, taskId: string) => Promise<{ success: boolean }>;
    getTasks: (session: Session, projectId: string) => Promise<unknown[]>;
  }
) {
  return {
    createTask: tool({
      description: "Create a new task in the project. Use this to add tasks to the project backlog or any status column.",
      inputSchema: zodSchema(createTaskSchema),
      execute: async (input: CreateTaskInput) => {
        const result = await taskOperations.createTask(session, projectId, input);
        return { success: true, id: result.id, message: `Created task: ${input.title}` };
      },
    }),

    updateTask: tool({
      description: "Update an existing task. Use this to modify task title, description, status, or priority.",
      inputSchema: zodSchema(updateTaskSchema),
      execute: async (input: UpdateTaskInput) => {
        const { taskId, ...updates } = input;
        await taskOperations.updateTask(session, projectId, taskId, updates);
        return { success: true, message: `Updated task ${taskId}` };
      },
    }),

    deleteTask: tool({
      description: "Delete a task from the project. Use this to remove tasks that are no longer needed.",
      inputSchema: zodSchema(deleteTaskSchema),
      execute: async (input: DeleteTaskInput) => {
        await taskOperations.deleteTask(session, projectId, input.taskId);
        return { success: true, message: `Deleted task ${input.taskId}` };
      },
    }),

    listTasks: tool({
      description: "List all current tasks in the project to understand the current state before making changes.",
      inputSchema: zodSchema(listTasksSchema),
      execute: async () => {
        const tasks = await taskOperations.getTasks(session, projectId);
        return { success: true, tasks };
      },
    }),
  };
}

// Keep old export for backwards compatibility with executeToolCalls
export const taskToolSchemas = {
  createTask: tool({
    description: "Create a new task in the project.",
    inputSchema: zodSchema(createTaskSchema),
  }),
  updateTask: tool({
    description: "Update an existing task.",
    inputSchema: zodSchema(updateTaskSchema),
  }),
  deleteTask: tool({
    description: "Delete a task from the project.",
    inputSchema: zodSchema(deleteTaskSchema),
  }),
  listTasks: tool({
    description: "List all current tasks in the project.",
    inputSchema: zodSchema(listTasksSchema),
  }),
};

export type TaskToolCall = {
  toolName: keyof typeof taskToolSchemas;
  args: Record<string, unknown>;
  toolCallId: string;
};
