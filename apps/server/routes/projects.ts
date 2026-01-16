import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Session } from "../auth";

export async function getProjects(session: Session) {
  return db.query.projects.findMany({
    where: eq(schema.projects.userId, session.user.id),
    orderBy: (projects, { desc }) => [desc(projects.createdAt)],
  });
}

export async function getProject(session: Session, projectId: string) {
  return db.query.projects.findFirst({
    where: and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, session.user.id)
    ),
  });
}

export async function createProject(
  session: Session,
  data: { name: string; description?: string; guidelines?: string; aiProviderId?: string }
) {
  const id = nanoid();
  await db.insert(schema.projects).values({
    id,
    name: data.name,
    description: data.description,
    guidelines: data.guidelines,
    aiProviderId: data.aiProviderId,
    userId: session.user.id,
  });
  return { id };
}

export async function updateProject(
  session: Session,
  projectId: string,
  data: { name?: string; description?: string; guidelines?: string; aiProviderId?: string }
) {
  const project = await getProject(session, projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  await db
    .update(schema.projects)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  return { success: true };
}

export async function deleteProject(session: Session, projectId: string) {
  const project = await getProject(session, projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  return { success: true };
}

export function handleProjectRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/projects
  if (path === "/api/projects" && method === "GET") {
    return getProjects(session).then((projects) =>
      Response.json(projects)
    );
  }

  // POST /api/projects
  if (path === "/api/projects" && method === "POST") {
    return req.json().then((data) =>
      createProject(session, data).then((result) =>
        Response.json(result, { status: 201 })
      )
    );
  }

  // GET /api/projects/:id
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === "GET") {
    const projectId = projectMatch[1]!;
    return getProject(session, projectId).then((project) => {
      if (!project) {
        return Response.json({ error: "Project not found" }, { status: 404 });
      }
      return Response.json(project);
    });
  }

  // PUT /api/projects/:id
  if (projectMatch && method === "PUT") {
    const projectId = projectMatch[1]!;
    return req.json().then((data) =>
      updateProject(session, projectId, data)
        .then((result) => Response.json(result))
        .catch((err) =>
          Response.json({ error: err.message }, { status: 404 })
        )
    );
  }

  // DELETE /api/projects/:id
  if (projectMatch && method === "DELETE") {
    const projectId = projectMatch[1]!;
    return deleteProject(session, projectId)
      .then((result) => Response.json(result))
      .catch((err) =>
        Response.json({ error: err.message }, { status: 404 })
      );
  }

  return null;
}
