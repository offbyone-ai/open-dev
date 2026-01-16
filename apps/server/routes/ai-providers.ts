import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Session } from "../auth";

interface ModelInfo {
  id: string;
  name?: string;
  owned_by?: string;
}

export async function testProviderConnection(
  baseUrl: string,
  apiKey?: string
): Promise<{ success: boolean; models?: ModelInfo[]; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Try to fetch models list from the provider
    const modelsUrl = baseUrl.endsWith("/")
      ? `${baseUrl}models`
      : `${baseUrl}/models`;

    const response = await fetch(modelsUrl, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Connection failed (${response.status}): ${errorText.slice(0, 100)}`
      };
    }

    const data = await response.json();

    // OpenAI-compatible APIs return { data: [...models] } or { models: [...] }
    const models: ModelInfo[] = data.data || data.models || [];

    if (!Array.isArray(models)) {
      return { success: true, models: [] };
    }

    return {
      success: true,
      models: models.map((m: any) => ({
        id: m.id || m.name,
        name: m.name || m.id,
        owned_by: m.owned_by,
      }))
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed"
    };
  }
}

export async function getAIProviders(session: Session) {
  return db.query.aiProviders.findMany({
    where: eq(schema.aiProviders.userId, session.user.id),
    orderBy: (providers, { desc }) => [desc(providers.createdAt)],
  });
}

export async function getAIProvider(session: Session, providerId: string) {
  return db.query.aiProviders.findFirst({
    where: and(
      eq(schema.aiProviders.id, providerId),
      eq(schema.aiProviders.userId, session.user.id)
    ),
  });
}

export async function createAIProvider(
  session: Session,
  data: { name: string; baseUrl: string; apiKey?: string; model?: string }
) {
  const id = nanoid();
  await db.insert(schema.aiProviders).values({
    id,
    name: data.name,
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    model: data.model || "gpt-4",
    userId: session.user.id,
  });
  return { id };
}

export async function updateAIProvider(
  session: Session,
  providerId: string,
  data: { name?: string; baseUrl?: string; apiKey?: string; model?: string }
) {
  const provider = await getAIProvider(session, providerId);
  if (!provider) {
    throw new Error("AI Provider not found");
  }

  await db
    .update(schema.aiProviders)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(schema.aiProviders.id, providerId));

  return { success: true };
}

export async function deleteAIProvider(session: Session, providerId: string) {
  const provider = await getAIProvider(session, providerId);
  if (!provider) {
    throw new Error("AI Provider not found");
  }

  await db.delete(schema.aiProviders).where(eq(schema.aiProviders.id, providerId));
  return { success: true };
}

export function handleAIProviderRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/ai-providers
  if (path === "/api/ai-providers" && method === "GET") {
    return getAIProviders(session).then((providers) => {
      // Don't expose API keys to client
      const safeProviders = providers.map(({ apiKey, ...rest }) => ({
        ...rest,
        hasApiKey: !!apiKey,
      }));
      return Response.json(safeProviders);
    });
  }

  // POST /api/ai-providers
  if (path === "/api/ai-providers" && method === "POST") {
    return req.json().then((data) =>
      createAIProvider(session, data).then((result) =>
        Response.json(result, { status: 201 })
      )
    );
  }

  // GET /api/ai-providers/:id
  const providerMatch = path.match(/^\/api\/ai-providers\/([^/]+)$/);
  if (providerMatch && method === "GET") {
    const providerId = providerMatch[1]!;
    return getAIProvider(session, providerId).then((provider) => {
      if (!provider) {
        return Response.json({ error: "AI Provider not found" }, { status: 404 });
      }
      // Don't expose API key
      const { apiKey, ...rest } = provider;
      return Response.json({ ...rest, hasApiKey: !!apiKey });
    });
  }

  // PUT /api/ai-providers/:id
  if (providerMatch && method === "PUT") {
    const providerId = providerMatch[1]!;
    return req.json().then((data) =>
      updateAIProvider(session, providerId, data)
        .then((result) => Response.json(result))
        .catch((err) =>
          Response.json({ error: err.message }, { status: 404 })
        )
    );
  }

  // DELETE /api/ai-providers/:id
  if (providerMatch && method === "DELETE") {
    const providerId = providerMatch[1]!;
    return deleteAIProvider(session, providerId)
      .then((result) => Response.json(result))
      .catch((err) =>
        Response.json({ error: err.message }, { status: 404 })
      );
  }

  // POST /api/ai-providers/test - Test provider connection and get models
  if (path === "/api/ai-providers/test" && method === "POST") {
    return req.json().then((data) =>
      testProviderConnection(data.baseUrl, data.apiKey)
        .then((result) => Response.json(result))
    );
  }

  return null;
}
