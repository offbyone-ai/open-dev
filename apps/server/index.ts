import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { auth } from "./auth";
import { handleAPIRoutes, handleGitHubWebhookRoutes } from "./routes";

const app = new Hono();

// Logger
app.use("*", logger());

// Dynamic CORS - allow any localhost port in development
app.use("*", cors({
  origin: (origin) => {
    // Allow any localhost origin in development
    if (origin && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
      return origin;
    }
    return null;
  },
  credentials: true,
}));

// Auth routes - handled by better-auth
app.all("/api/auth/*", async (c) => {
  return auth.handler(c.req.raw);
});

// GitHub webhook route - NO auth required (uses signature verification)
app.post("/api/github/webhook", async (c) => {
  const response = handleGitHubWebhookRoutes(c.req.raw);
  if (response) {
    return response;
  }
  return c.json({ error: "Not found" }, 404);
});

// API routes - require authentication
app.all("/api/*", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const response = handleAPIRoutes(c.req.raw, session);
  if (response) {
    return response;
  }

  return c.json({ error: "Not found" }, 404);
});

// Serve static files in production
app.use("*", serveStatic({ root: "./dist" }));

// SPA fallback - serve index.html for all other routes
app.get("*", serveStatic({ root: "./dist", path: "index.html" }));

const preferredPort = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// Find an available port starting from the preferred port
async function findAvailablePort(startPort: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    try {
      const server = Bun.serve({
        port,
        fetch: () => new Response("test"),
      });
      server.stop();
      return port;
    } catch {
      // Port is in use, try next
    }
  }
  // Fallback to port 0 (OS assigns random available port)
  return 0;
}

const port = await findAvailablePort(preferredPort);

console.log(`Server running at http://localhost:${port}`);
console.log("Started development server: http://localhost:" + port);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255, // Max allowed - needed for slow LLM responses
};
