import { handleProjectRoutes } from "./projects";
import { handleTaskRoutes } from "./tasks";
import { handleTaskTemplateRoutes } from "./task-templates";
import { handleAIProviderRoutes } from "./ai-providers";
import { handleChatRoutes } from "./chat";
import { handleAgentRoutes } from "./agent";
import { handleFilesystemRoutes } from "./filesystem";
import { handleFileWatcherRoutes } from "./file-watcher";
import { handleGuidelinesRoutes } from "./guidelines";
import { handleGitHubRoutes } from "./github";
import type { Session } from "../auth";

export function handleAPIRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  console.log("[handleAPIRoutes] Received:", req.method, url.pathname);

  // Try each route handler in order
  return (
    handleProjectRoutes(req, session) ||
    handleTaskRoutes(req, session) ||
    handleTaskTemplateRoutes(req, session) ||
    handleAIProviderRoutes(req, session) ||
    handleChatRoutes(req, session) ||
    handleAgentRoutes(req, session) ||
    handleFilesystemRoutes(req, session) ||
    handleFileWatcherRoutes(req, session) ||
    handleGuidelinesRoutes(req, session) ||
    handleGitHubRoutes(req, session)
  );
}

// Export webhook handler separately (doesn't require auth)
export { handleGitHubWebhookRoutes } from "./github-webhook";
