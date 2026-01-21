import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import type { ReasoningStepType, AgentReasoningStep } from "@open-dev/shared";
import {
  Brain,
  ListTodo,
  GitBranch,
  Eye,
  RefreshCcw,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";

interface ReasoningDisplayProps {
  steps: AgentReasoningStep[];
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const stepTypeConfig: Record<
  ReasoningStepType,
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    bgColor: string;
    textColor: string;
    borderColor: string;
  }
> = {
  thinking: {
    icon: Brain,
    label: "Thinking",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    textColor: "text-blue-700 dark:text-blue-300",
    borderColor: "border-blue-200 dark:border-blue-800",
  },
  planning: {
    icon: ListTodo,
    label: "Planning",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    textColor: "text-purple-700 dark:text-purple-300",
    borderColor: "border-purple-200 dark:border-purple-800",
  },
  decision: {
    icon: GitBranch,
    label: "Decision",
    bgColor: "bg-green-50 dark:bg-green-950/30",
    textColor: "text-green-700 dark:text-green-300",
    borderColor: "border-green-200 dark:border-green-800",
  },
  observation: {
    icon: Eye,
    label: "Observation",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    textColor: "text-amber-700 dark:text-amber-300",
    borderColor: "border-amber-200 dark:border-amber-800",
  },
  reflection: {
    icon: RefreshCcw,
    label: "Reflection",
    bgColor: "bg-rose-50 dark:bg-rose-950/30",
    textColor: "text-rose-700 dark:text-rose-300",
    borderColor: "border-rose-200 dark:border-rose-800",
  },
};

function ReasoningStep({ step }: { step: AgentReasoningStep }) {
  const [expanded, setExpanded] = useState(true);
  const config = stepTypeConfig[step.type];
  const Icon = config.icon;

  const isLongContent = step.content.length > 200;
  const displayContent =
    expanded || !isLongContent ? step.content : step.content.slice(0, 200) + "...";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-all",
        config.bgColor,
        config.borderColor
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full flex-shrink-0",
            config.textColor
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className={cn("text-xs font-medium", config.textColor)}>
              {config.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(step.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
            {displayContent}
          </p>
          {isLongContent && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 mt-1 text-xs"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3 mr-1" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3 mr-1" />
                  Show more
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReasoningDisplay({
  steps,
  isExpanded = true,
  onToggleExpand,
}: ReasoningDisplayProps) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span>Agent Reasoning</span>
          <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
        </div>
        {onToggleExpand && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onToggleExpand}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" />
                Expand
              </>
            )}
          </Button>
        )}
      </div>

      {isExpanded && (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {steps.map((step) => (
            <ReasoningStep key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
