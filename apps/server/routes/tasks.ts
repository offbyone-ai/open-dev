import { db, schema } from "../db";
import { eq, and, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Session } from "../auth";
import type { Task } from "@open-dev/shared";
import {
  validateDependencies,
  buildDependencyGraph,
  getSuggestedExecutionOrder,
  canTaskStart,
} from "@open-dev/shared";

// Helper to transform DB task to API task with parsed dependsOn
function transformTask(dbTask: typeof schema.tasks.$inferSelect): Task {
  // Safely parse dependsOn - handle invalid JSON gracefully
  let dependsOn: string[] = [];
  try {
    const raw = dbTask.dependsOn;
    if (raw && raw.startsWith('[')) {
      dependsOn = JSON.parse(raw) as string[];
    }
  } catch {
    // If parsing fails, default to empty array
    console.warn(`Invalid dependsOn JSON for task ${dbTask.id}: ${dbTask.dependsOn}`);
  }

  return {
    ...dbTask,
    dependsOn,
    createdAt: dbTask.createdAt.toISOString(),
    updatedAt: dbTask.updatedAt.toISOString(),
  };
}

async function verifyProjectAccess(session: Session, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, session.user.id)
    ),
  });
  if (!project) {
    throw new Error("Project not found");
  }
  return project;
}

export async function getTasks(session: Session, projectId: string): Promise<Task[]> {
  await verifyProjectAccess(session, projectId);
  const dbTasks = await db.query.tasks.findMany({
    where: eq(schema.tasks.projectId, projectId),
    orderBy: (tasks, { asc }) => [asc(tasks.position)],
  });
  return dbTasks.map(transformTask);
}

export async function getTask(session: Session, projectId: string, taskId: string): Promise<Task | null> {
  await verifyProjectAccess(session, projectId);
  const dbTask = await db.query.tasks.findFirst({
    where: and(
      eq(schema.tasks.id, taskId),
      eq(schema.tasks.projectId, projectId)
    ),
  });
  return dbTask ? transformTask(dbTask) : null;
}

export async function createTask(
  session: Session,
  projectId: string,
  data: {
    title: string;
    description?: string;
    status?: "backlog" | "in_progress" | "done";
    priority?: "low" | "medium" | "high";
    dependsOn?: string[];
  }
) {
  await verifyProjectAccess(session, projectId);

  const dependsOn = data.dependsOn || [];

  // Validate dependencies if any
  if (dependsOn.length > 0) {
    const allTasks = await getTasks(session, projectId);
    // Create a temporary task object for validation
    const tempTask: Task = {
      id: "temp-" + nanoid(),
      title: data.title,
      description: data.description || null,
      status: data.status || "backlog",
      priority: data.priority || "medium",
      position: 0,
      projectId,
      dependsOn,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const validation = validateDependencies(tempTask.id, dependsOn, [...allTasks, tempTask]);
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid dependencies");
    }
  }

  // Get max position for the status column
  const status = data.status || "backlog";
  const result = await db
    .select({ maxPos: max(schema.tasks.position) })
    .from(schema.tasks)
    .where(and(
      eq(schema.tasks.projectId, projectId),
      eq(schema.tasks.status, status)
    ));

  const maxPosition = result[0]?.maxPos ?? -1;

  const id = nanoid();
  await db.insert(schema.tasks).values({
    id,
    title: data.title,
    description: data.description,
    status,
    priority: data.priority || "medium",
    position: maxPosition + 1,
    projectId,
    dependsOn: JSON.stringify(dependsOn),
  });

  return { id };
}

export async function updateTask(
  session: Session,
  projectId: string,
  taskId: string,
  data: {
    title?: string;
    description?: string;
    status?: "backlog" | "in_progress" | "done";
    priority?: "low" | "medium" | "high";
    dependsOn?: string[];
  }
) {
  const task = await getTask(session, projectId, taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  // Validate dependencies if being updated
  if (data.dependsOn !== undefined) {
    const allTasks = await getTasks(session, projectId);
    const validation = validateDependencies(taskId, data.dependsOn, allTasks);
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid dependencies");
    }
  }

  // Build update object
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.dependsOn !== undefined) updateData.dependsOn = JSON.stringify(data.dependsOn);

  await db
    .update(schema.tasks)
    .set(updateData)
    .where(eq(schema.tasks.id, taskId));

  return { success: true };
}

export async function deleteTask(session: Session, projectId: string, taskId: string) {
  const task = await getTask(session, projectId, taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  // Remove this task from other tasks' dependencies
  const allTasks = await getTasks(session, projectId);
  const tasksToUpdate = allTasks.filter(t => t.dependsOn.includes(taskId));

  for (const t of tasksToUpdate) {
    const newDeps = t.dependsOn.filter(id => id !== taskId);
    await db
      .update(schema.tasks)
      .set({
        dependsOn: JSON.stringify(newDeps),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, t.id));
  }

  await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
  return { success: true };
}

// Get dependency graph for a project
export async function getDependencyGraph(session: Session, projectId: string) {
  const tasks = await getTasks(session, projectId);
  return buildDependencyGraph(tasks);
}

// Get suggested execution order for agents
export async function getExecutionOrder(session: Session, projectId: string) {
  const tasks = await getTasks(session, projectId);
  const orderedIds = getSuggestedExecutionOrder(tasks);

  // Return tasks in order with additional info
  return orderedIds.map(id => {
    const task = tasks.find(t => t.id === id)!;
    return {
      task,
      canStart: canTaskStart(task, tasks),
    };
  });
}

// Check if a specific task can be started
export async function checkTaskCanStart(session: Session, projectId: string, taskId: string) {
  const task = await getTask(session, projectId, taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  const allTasks = await getTasks(session, projectId);
  const startable = canTaskStart(task, allTasks);

  // If blocked, find blocking tasks
  const blockingTasks: Task[] = [];
  if (!startable) {
    for (const depId of task.dependsOn) {
      const depTask = allTasks.find(t => t.id === depId);
      if (depTask && depTask.status !== "done") {
        blockingTasks.push(depTask);
      }
    }
  }

  return {
    canStart: startable,
    blockingTasks,
  };
}

export async function reorderTask(
  session: Session,
  projectId: string,
  taskId: string,
  data: { status: "backlog" | "in_progress" | "done"; position: number }
) {
  const task = await getTask(session, projectId, taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  // Get all tasks in the target status column
  const tasksInColumn = await db.query.tasks.findMany({
    where: and(
      eq(schema.tasks.projectId, projectId),
      eq(schema.tasks.status, data.status)
    ),
    orderBy: (tasks, { asc }) => [asc(tasks.position)],
  });

  // Update positions
  const updates: Promise<void>[] = [];
  let newPosition = 0;

  for (const t of tasksInColumn) {
    if (t.id === taskId) continue;

    if (newPosition === data.position) {
      newPosition++;
    }

    if (t.position !== newPosition) {
      updates.push(
        db
          .update(schema.tasks)
          .set({ position: newPosition })
          .where(eq(schema.tasks.id, t.id))
          .then(() => {})
      );
    }
    newPosition++;
  }

  // Update the moved task
  await db
    .update(schema.tasks)
    .set({
      status: data.status,
      position: data.position,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, taskId));

  await Promise.all(updates);

  return { success: true };
}

export function handleTaskRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/projects/:projectId/tasks
  const tasksMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks$/);
  if (tasksMatch && method === "GET") {
    const projectId = tasksMatch[1]!;
    return getTasks(session, projectId)
      .then((tasks) => Response.json(tasks))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // POST /api/projects/:projectId/tasks
  if (tasksMatch && method === "POST") {
    const projectId = tasksMatch[1]!;
    return req.json().then((data) =>
      createTask(session, projectId, data)
        .then((result) => Response.json(result, { status: 201 }))
        .catch((err) => Response.json({ error: err.message }, { status: 400 }))
    );
  }

  // GET /api/projects/:projectId/tasks/dependency-graph
  const depGraphMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks\/dependency-graph$/);
  if (depGraphMatch && method === "GET") {
    const projectId = depGraphMatch[1]!;
    return getDependencyGraph(session, projectId)
      .then((graph) => Response.json(graph))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // GET /api/projects/:projectId/tasks/execution-order
  const execOrderMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks\/execution-order$/);
  if (execOrderMatch && method === "GET") {
    const projectId = execOrderMatch[1]!;
    return getExecutionOrder(session, projectId)
      .then((order) => Response.json(order))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // GET/PUT/DELETE /api/projects/:projectId/tasks/:taskId
  const taskMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const projectId = taskMatch[1]!;
    const taskId = taskMatch[2]!;

    if (method === "GET") {
      return getTask(session, projectId, taskId)
        .then((task) => {
          if (!task) {
            return Response.json({ error: "Task not found" }, { status: 404 });
          }
          return Response.json(task);
        })
        .catch((err) => Response.json({ error: err.message }, { status: 404 }));
    }

    if (method === "PUT") {
      return req.json().then((data) =>
        updateTask(session, projectId, taskId, data)
          .then((result) => Response.json(result))
          .catch((err) => Response.json({ error: err.message }, { status: 400 }))
      );
    }

    if (method === "DELETE") {
      return deleteTask(session, projectId, taskId)
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 404 }));
    }
  }

  // POST /api/projects/:projectId/tasks/:taskId/reorder
  const reorderMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/reorder$/);
  if (reorderMatch && method === "POST") {
    const projectId = reorderMatch[1]!;
    const taskId = reorderMatch[2]!;
    return req.json().then((data) =>
      reorderTask(session, projectId, taskId, data)
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 404 }))
    );
  }

  // GET /api/projects/:projectId/tasks/:taskId/can-start
  const canStartMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/can-start$/);
  if (canStartMatch && method === "GET") {
    const projectId = canStartMatch[1]!;
    const taskId = canStartMatch[2]!;
    return checkTaskCanStart(session, projectId, taskId)
      .then((result) => Response.json(result))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  return null;
}
