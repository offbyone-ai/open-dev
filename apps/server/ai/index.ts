import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AIProvider } from "../db/schema";

// Complete schema definitions for each tool
const TOOL_SCHEMAS: Record<string, object> = {
  readFile: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path to the file to read, relative to the working directory" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  writeFile: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path to the file to write, relative to the working directory" },
      content: { type: "string", description: "The content to write to the file" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  editFile: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path to the file to edit, relative to the working directory" },
      search: { type: "string", description: "The exact text to search for in the file" },
      replace: { type: "string", description: "The text to replace the search text with" },
    },
    required: ["path", "search", "replace"],
    additionalProperties: false,
  },
  deleteFile: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path to the file to delete, relative to the working directory" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  listDirectory: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path to the directory to list, relative to the working directory" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  executeCommand: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      description: { type: "string", description: "A brief description of what this command does" },
    },
    required: ["command", "description"],
    additionalProperties: false,
  },
  completeTask: {
    type: "object",
    properties: {
      summary: { type: "string", description: "A summary of what was accomplished to complete the task" },
    },
    required: ["summary"],
    additionalProperties: false,
  },
};

// Fix tool schema format for LM Studio compatibility by replacing empty schemas with full definitions
function fixToolSchemas(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed.tools && Array.isArray(parsed.tools)) {
      parsed.tools = parsed.tools.map((tool: any) => {
        if (tool.function && tool.function.name) {
          const fullSchema = TOOL_SCHEMAS[tool.function.name];
          if (fullSchema) {
            console.log("[fixToolSchemas] Replacing schema for", tool.function.name);
            tool.function.parameters = fullSchema;
          } else {
            // Fallback: ensure type: object is set
            if (tool.function.parameters && !tool.function.parameters.type) {
              tool.function.parameters.type = "object";
            }
          }
          // Remove $schema if present
          if (tool.function.parameters?.$schema) {
            delete tool.function.parameters.$schema;
          }
        }
        return tool;
      });

      console.log("[fixToolSchemas] Fixed tools[0].function.parameters:",
        JSON.stringify(parsed.tools[0]?.function?.parameters, null, 2));

      return JSON.stringify(parsed);
    }
  } catch (e) {
    console.error("[fixToolSchemas] Error:", e);
  }
  return body;
}

export function createAIProvider(provider: AIProvider) {
  // Create a custom fetch wrapper that fixes tool schemas for LM Studio compatibility
  const customFetch = async (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
    // Use a longer timeout for local LLMs (5 minutes)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    try {
      // Fix tool schemas in the request body for LM Studio compatibility
      let modifiedOptions: RequestInit = { ...options };
      if (options?.body && typeof options.body === "string") {
        modifiedOptions.body = fixToolSchemas(options.body);
        // Log request details
        try {
          const parsed = JSON.parse(modifiedOptions.body);
          console.log("[AI Request] Model:", parsed.model);
          console.log("[AI Request] Stream:", parsed.stream);
          console.log("[AI Request] Tool choice:", parsed.tool_choice);
          console.log("[AI Request] Tools count:", parsed.tools?.length);
          if (parsed.tools?.[0]) {
            console.log("[AI Request] First tool:", JSON.stringify(parsed.tools[0]).slice(0, 400));
          }
        } catch (e) {}
      }

      const response = await fetch(url, {
        ...modifiedOptions,
        signal: controller.signal,
      });

      console.log("[AI Response] Status:", response.status, "Content-Type:", response.headers.get("content-type"));

      // For streaming responses, create a passthrough that logs chunks
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && response.body) {
        const originalBody = response.body;
        const decoder = new TextDecoder();
        let chunkCount = 0;

        const loggingStream = new ReadableStream({
          async start(controller) {
            const reader = originalBody.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  controller.close();
                  break;
                }
                // Log first few chunks to see the format
                if (chunkCount < 5) {
                  const text = decoder.decode(value, { stream: true });
                  console.log(`[AI Stream chunk ${chunkCount}]:`, text.slice(0, 300));
                }
                chunkCount++;
                controller.enqueue(value);
              }
            } catch (e) {
              controller.error(e);
            }
          },
        });

        return new Response(loggingStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  };

  const client = createOpenAICompatible({
    name: provider.name,
    baseURL: provider.baseUrl,
    apiKey: provider.apiKey || undefined,
    fetch: customFetch as typeof globalThis.fetch,
  });

  return client(provider.model);
}
