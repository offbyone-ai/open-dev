import type { Session } from "../auth";
import { getProject } from "./projects";
import {
  loadGuidelinesConfig,
  resolveGuidelines,
  hasGuidelinesConfig,
  createDefaultGuidelinesConfig,
  clearGuidelinesCache,
} from "../services/guidelines";

export function handleGuidelinesRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/projects/:projectId/guidelines/config - Get the guidelines config for a project
  const configMatch = path.match(/^\/api\/projects\/([^/]+)\/guidelines\/config$/);
  if (configMatch && method === "GET") {
    const projectId = configMatch[1]!;
    return handleGetGuidelinesConfig(session, projectId);
  }

  // POST /api/projects/:projectId/guidelines/config - Create/update guidelines config
  if (configMatch && method === "POST") {
    const projectId = configMatch[1]!;
    return req.json().then((data) => handleSaveGuidelinesConfig(session, projectId, data));
  }

  // GET /api/projects/:projectId/guidelines/resolve?path=... - Resolve guidelines for a file path
  const resolveMatch = path.match(/^\/api\/projects\/([^/]+)\/guidelines\/resolve$/);
  if (resolveMatch && method === "GET") {
    const projectId = resolveMatch[1]!;
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return Promise.resolve(Response.json({ error: "path parameter required" }, { status: 400 }));
    }
    return handleResolveGuidelines(session, projectId, filePath);
  }

  // POST /api/projects/:projectId/guidelines/resolve-multiple - Resolve guidelines for multiple paths
  const resolveMultipleMatch = path.match(/^\/api\/projects\/([^/]+)\/guidelines\/resolve-multiple$/);
  if (resolveMultipleMatch && method === "POST") {
    const projectId = resolveMultipleMatch[1]!;
    return req.json().then((data) => handleResolveMultipleGuidelines(session, projectId, data.paths || []));
  }

  // POST /api/projects/:projectId/guidelines/init - Initialize guidelines config with defaults
  const initMatch = path.match(/^\/api\/projects\/([^/]+)\/guidelines\/init$/);
  if (initMatch && method === "POST") {
    const projectId = initMatch[1]!;
    return handleInitGuidelinesConfig(session, projectId);
  }

  return null;
}

async function handleGetGuidelinesConfig(session: Session, projectId: string): Promise<Response> {
  const project = await getProject(session, projectId);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.workingDirectory) {
    return Response.json({ error: "Project has no working directory configured" }, { status: 400 });
  }

  const config = await loadGuidelinesConfig(project.workingDirectory);
  const hasConfig = await hasGuidelinesConfig(project.workingDirectory);

  return Response.json({
    hasConfig,
    config,
    workingDirectory: project.workingDirectory,
  });
}

async function handleSaveGuidelinesConfig(
  session: Session,
  projectId: string,
  data: { config: unknown }
): Promise<Response> {
  const project = await getProject(session, projectId);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.workingDirectory) {
    return Response.json({ error: "Project has no working directory configured" }, { status: 400 });
  }

  try {
    const configPath = `${project.workingDirectory}/.ai-guidelines.json`;
    await Bun.write(configPath, JSON.stringify(data.config, null, 2));

    // Clear cache to pick up changes
    clearGuidelinesCache();

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

async function handleResolveGuidelines(
  session: Session,
  projectId: string,
  filePath: string
): Promise<Response> {
  const project = await getProject(session, projectId);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.workingDirectory) {
    return Response.json({ error: "Project has no working directory configured" }, { status: 400 });
  }

  const resolved = await resolveGuidelines(
    project.workingDirectory,
    filePath,
    project.guidelines
  );

  return Response.json(resolved);
}

async function handleResolveMultipleGuidelines(
  session: Session,
  projectId: string,
  filePaths: string[]
): Promise<Response> {
  const project = await getProject(session, projectId);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.workingDirectory) {
    return Response.json({ error: "Project has no working directory configured" }, { status: 400 });
  }

  // Resolve guidelines for each path
  const results = await Promise.all(
    filePaths.map((fp) => resolveGuidelines(project.workingDirectory!, fp, project.guidelines))
  );

  // Merge unique guidelines
  const seenGuidelines = new Set<string>();
  const allGuidelines: string[] = [];
  const allMatchedRules: Array<{ pattern: string; priority: number }> = [];
  let includesDefault = false;

  for (const resolved of results) {
    if (resolved.includesDefault) includesDefault = true;

    const parts = resolved.guidelines.split("\n\n").filter(Boolean);
    for (const part of parts) {
      if (!seenGuidelines.has(part)) {
        seenGuidelines.add(part);
        allGuidelines.push(part);
      }
    }

    for (const rule of resolved.matchedRules) {
      if (!allMatchedRules.some((r) => r.pattern === rule.pattern)) {
        allMatchedRules.push(rule);
      }
    }
  }

  return Response.json({
    guidelines: allGuidelines.join("\n\n"),
    matchedRules: allMatchedRules,
    includesDefault,
  });
}

async function handleInitGuidelinesConfig(session: Session, projectId: string): Promise<Response> {
  const project = await getProject(session, projectId);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.workingDirectory) {
    return Response.json({ error: "Project has no working directory configured" }, { status: 400 });
  }

  const exists = await hasGuidelinesConfig(project.workingDirectory);
  if (exists) {
    return Response.json({ error: "Guidelines config already exists" }, { status: 400 });
  }

  try {
    await createDefaultGuidelinesConfig(project.workingDirectory, project.guidelines || undefined);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
