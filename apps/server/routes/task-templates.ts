import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
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

export async function getTaskTemplates(session: Session, projectId: string) {
  await verifyProjectAccess(session, projectId);
  return db.query.taskTemplates.findMany({
    where: eq(schema.taskTemplates.projectId, projectId),
    orderBy: (templates, { asc }) => [asc(templates.name)],
  });
}

export async function getTaskTemplate(session: Session, projectId: string, templateId: string) {
  await verifyProjectAccess(session, projectId);
  return db.query.taskTemplates.findFirst({
    where: and(
      eq(schema.taskTemplates.id, templateId),
      eq(schema.taskTemplates.projectId, projectId)
    ),
  });
}

export async function createTaskTemplate(
  session: Session,
  projectId: string,
  data: {
    name: string;
    description?: string;
    acceptanceCriteria?: string;
    defaultPriority?: "low" | "medium" | "high";
    category?: string;
  }
) {
  await verifyProjectAccess(session, projectId);

  const id = nanoid();
  await db.insert(schema.taskTemplates).values({
    id,
    name: data.name,
    description: data.description,
    acceptanceCriteria: data.acceptanceCriteria,
    defaultPriority: data.defaultPriority || "medium",
    category: data.category,
    projectId,
  });

  return { id };
}

export async function updateTaskTemplate(
  session: Session,
  projectId: string,
  templateId: string,
  data: {
    name?: string;
    description?: string;
    acceptanceCriteria?: string;
    defaultPriority?: "low" | "medium" | "high";
    category?: string;
  }
) {
  const template = await getTaskTemplate(session, projectId, templateId);
  if (!template) {
    throw new Error("Template not found");
  }

  await db
    .update(schema.taskTemplates)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(schema.taskTemplates.id, templateId));

  return { success: true };
}

export async function deleteTaskTemplate(session: Session, projectId: string, templateId: string) {
  const template = await getTaskTemplate(session, projectId, templateId);
  if (!template) {
    throw new Error("Template not found");
  }

  await db.delete(schema.taskTemplates).where(eq(schema.taskTemplates.id, templateId));
  return { success: true };
}

export function handleTaskTemplateRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/projects/:projectId/templates
  const templatesMatch = path.match(/^\/api\/projects\/([^/]+)\/templates$/);
  if (templatesMatch && method === "GET") {
    const projectId = templatesMatch[1]!;
    return getTaskTemplates(session, projectId)
      .then((templates) => Response.json(templates))
      .catch((err) => Response.json({ error: err.message }, { status: 404 }));
  }

  // POST /api/projects/:projectId/templates
  if (templatesMatch && method === "POST") {
    const projectId = templatesMatch[1]!;
    return req.json().then((data) =>
      createTaskTemplate(session, projectId, data)
        .then((result) => Response.json(result, { status: 201 }))
        .catch((err) => Response.json({ error: err.message }, { status: 404 }))
    );
  }

  // GET/PUT/DELETE /api/projects/:projectId/templates/:templateId
  const templateMatch = path.match(/^\/api\/projects\/([^/]+)\/templates\/([^/]+)$/);
  if (templateMatch) {
    const projectId = templateMatch[1]!;
    const templateId = templateMatch[2]!;

    if (method === "GET") {
      return getTaskTemplate(session, projectId, templateId)
        .then((template) => {
          if (!template) {
            return Response.json({ error: "Template not found" }, { status: 404 });
          }
          return Response.json(template);
        })
        .catch((err) => Response.json({ error: err.message }, { status: 404 }));
    }

    if (method === "PUT") {
      return req.json().then((data) =>
        updateTaskTemplate(session, projectId, templateId, data)
          .then((result) => Response.json(result))
          .catch((err) => Response.json({ error: err.message }, { status: 404 }))
      );
    }

    if (method === "DELETE") {
      return deleteTaskTemplate(session, projectId, templateId)
        .then((result) => Response.json(result))
        .catch((err) => Response.json({ error: err.message }, { status: 404 }));
    }
  }

  return null;
}
