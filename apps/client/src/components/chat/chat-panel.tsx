import React, { useEffect, useRef, useState, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Bot, User, Send, Loader2, CheckCircle, XCircle, AlertCircle, Wrench } from "lucide-react";

interface ChatPanelProps {
  projectId: string;
  hasAIProvider: boolean;
  onTasksChanged: () => void;
}

export function ChatPanel({ projectId, hasAIProvider, onTasksChanged }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [input, setInput] = useState("");

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/projects/${projectId}/chat` }),
    [projectId]
  );

  const {
    messages,
    sendMessage,
    status,
    error,
  } = useChat({
    transport,
    onFinish: () => {
      // Reload tasks when the AI finishes responding (in case tools were called)
      onTasksChanged();
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isLoading = status === "streaming" || status === ("submitted" as typeof status);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!hasAIProvider) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <Bot className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-semibold mb-2">AI Planning Not Available</h3>
        <p className="text-sm text-muted-foreground">
          Configure an AI provider for this project to enable AI-assisted planning.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && status !== "streaming" && (
          <div className="text-center text-muted-foreground py-8">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              Start a conversation to plan your project with AI.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted">
              {message.role === "user" ? (
                <User className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              {/* Render message parts */}
              {message.parts?.map((part, index) => {
                // Text parts
                if (part.type === "text") {
                  const textPart = part as { type: "text"; text: string };
                  return (
                    <div key={`${message.id}-text-${index}`} className="inline-block rounded-lg px-4 py-2 text-sm bg-muted">
                      <p className="whitespace-pre-wrap">{textPart.text}</p>
                    </div>
                  );
                }
                // Tool parts have type like "tool-createTask", "tool-updateTask", etc.
                if (part.type.startsWith("tool-")) {
                  const toolPart = part as {
                    type: string;
                    toolCallId: string;
                    state: "input-streaming" | "input-available" | "output-available" | "output-error";
                    input?: Record<string, unknown>;
                    output?: unknown;
                  };
                  const toolName = toolPart.type.replace("tool-", "");
                  return (
                    <ToolInvocationCard
                      key={`${message.id}-tool-${index}`}
                      toolName={toolName}
                      args={toolPart.input || {}}
                      state={toolPart.state}
                      result={toolPart.output}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted">
              <Bot className="h-4 w-4" />
            </div>
            <div className="inline-block rounded-lg px-4 py-2 text-sm bg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex gap-3 items-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-destructive/10">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
            <div className="inline-block rounded-lg px-4 py-2 text-sm bg-destructive/10 text-destructive">
              <p>Error: {error.message || error.toString() || "Unknown error occurred"}</p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? "AI is thinking..." : "Ask AI to help plan your project..."}
            disabled={isLoading}
            className="min-h-[60px] max-h-[200px] resize-none"
            rows={2}
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ToolInvocationCard({
  toolName,
  args,
  state,
  result,
}: {
  toolName: string;
  args: Record<string, unknown>;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  result?: unknown;
}) {
  const getIcon = () => {
    switch (state) {
      case "input-streaming":
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case "input-available":
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "output-available":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "output-error":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Wrench className="h-4 w-4" />;
    }
  };

  const getStatusText = () => {
    switch (state) {
      case "input-streaming":
        return "Preparing...";
      case "input-available":
        return "Executing...";
      case "output-available":
        return "Completed";
      case "output-error":
        return "Failed";
      default:
        return state;
    }
  };

  const formatToolName = (name: string) => {
    return name
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-center gap-2 mb-2">
        {getIcon()}
        <span className="font-medium text-sm">{formatToolName(toolName)}</span>
        <span className="text-xs text-muted-foreground ml-auto">{getStatusText()}</span>
      </div>

      {/* Show args for task-related tools */}
      {renderToolArgs(toolName, args)}

      {state === "output-available" && result && (
        <div className="mt-2 pt-2 border-t text-xs text-green-600">
          {typeof result === "object" && result !== null && "id" in result
            ? `Created with ID: ${(result as { id: string }).id}`
            : "Action completed successfully"}
        </div>
      )}
    </div>
  );
}

function renderToolArgs(toolName: string, args: Record<string, unknown>): React.ReactNode {
  if (toolName === "createTask" || toolName === "updateTask") {
    const typedArgs = args as { title?: string; description?: string; status?: string; priority?: string };
    return (
      <div className="text-xs text-muted-foreground space-y-1">
        {typedArgs.title && (
          <p><span className="font-medium">Title:</span> {typedArgs.title}</p>
        )}
        {typedArgs.description && (
          <p><span className="font-medium">Description:</span> {typedArgs.description}</p>
        )}
        {typedArgs.status && (
          <p><span className="font-medium">Status:</span> {typedArgs.status}</p>
        )}
        {typedArgs.priority && (
          <p><span className="font-medium">Priority:</span> {typedArgs.priority}</p>
        )}
      </div>
    );
  }

  if (toolName === "deleteTask") {
    const typedArgs = args as { taskId?: string };
    if (typedArgs.taskId) {
      return (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Task ID:</span> {typedArgs.taskId}
        </p>
      );
    }
  }

  return null;
}
