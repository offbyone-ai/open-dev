import { db, schema } from "../db";
import { eq, and, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Session } from "../auth";

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

export async function getTasks(session: Session, projectId: string) {
  await verifyProjectAccess(session, projectId);
  return db.query.tasks.findMany({
    where: eq(schema.tasks.projectId, projectId),
    orderBy: (tasks, { asc }) => [asc(tasks.position)],
  });
}

export async function getTask(session: Session, projectId: string, taskId: string) {
  await verifyProjectAccess(session, projectId);
  return db.query.tasks.findFirst({
    where: and(
      eq(schema.tasks.id, taskId),
      eq(schema.tasks.projectId, projectId)
    ),
  });
}

export async function createTask(
  session: Session,
  projectId: string,
  data: {
    title: string;
    description?: string;
    status?: "backlog" | "in_progress" | "done";
    priority?: "low" | "medium" | "high";
  }
) {
  await verifyProjectAccess(session, projectId);

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
  }
) {
  const task = await getTask(session, projectId, taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  await db
    .update(schema.tasks)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, taskId));

  return { success: true };
}

export async function deleteTask(session: Session, projectId: string, taskId: string) {
  const task = await getTask(session, projectId, taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
  return { success: true };
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
        .catch((err) => Response.json({ error: err.message }, { status: 404 }))
    );
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
          .catch((err) => Response.json({ error: err.message }, { status: 404 }))
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

  return null;
}
