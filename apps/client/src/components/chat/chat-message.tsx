import type { ChatMessage as ChatMessageType } from "../../lib/api";
import { cn } from "../../lib/utils";
import { User, Bot } from "lucide-react";
import { ProposedChanges } from "./proposed-changes";

interface ChatMessageProps {
  message: ChatMessageType;
  onApprove?: () => void;
  onDeny?: () => void;
  onEdit?: () => void;
}

export function ChatMessage({ message, onApprove, onDeny, onEdit }: ChatMessageProps) {
  const isUser = message.role === "user";
  const proposedChanges = message.proposedChanges ? JSON.parse(message.proposedChanges) : null;

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={cn("flex-1 space-y-2", isUser && "text-right")}>
        <div
          className={cn(
            "inline-block rounded-lg px-4 py-2 text-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {proposedChanges && message.changeStatus === "pending" && (
          <ProposedChanges
            changes={proposedChanges}
            onApprove={onApprove}
            onDeny={onDeny}
            onEdit={onEdit}
          />
        )}
        {message.changeStatus === "approved" && proposedChanges && (
          <div className="text-xs text-green-600 dark:text-green-400">
            Changes approved and applied
          </div>
        )}
        {message.changeStatus === "denied" && proposedChanges && (
          <div className="text-xs text-red-600 dark:text-red-400">
            Changes denied
          </div>
        )}
      </div>
    </div>
  );
}
