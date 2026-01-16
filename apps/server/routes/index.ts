import { handleProjectRoutes } from "./projects";
import { handleTaskRoutes } from "./tasks";
import { handleAIProviderRoutes } from "./ai-providers";
import { handleChatRoutes } from "./chat";
import { handleAgentRoutes } from "./agent";
import { handleFilesystemRoutes } from "./filesystem";
import type { Session } from "../auth";

export function handleAPIRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  console.log("[handleAPIRoutes] Received:", req.method, url.pathname);

  // Try each route handler in order
  return (
    handleProjectRoutes(req, session) ||
    handleTaskRoutes(req, session) ||
    handleAIProviderRoutes(req, session) ||
    handleChatRoutes(req, session) ||
    handleAgentRoutes(req, session) ||
    handleFilesystemRoutes(req, session)
  );
}
