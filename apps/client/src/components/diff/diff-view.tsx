import { useMemo } from "react";
import { cn } from "../../lib/utils";
import type { DiffLine, DiffHunk } from "../../lib/diff";
import { createHunks, computeDiffStats, getFileExtension, getLanguageFromExtension } from "../../lib/diff";

interface DiffViewProps {
  lines: DiffLine[];
  path: string;
  showLineNumbers?: boolean;
  contextLines?: number;
  maxHeight?: string;
  className?: string;
}

/**
 * Single line in the diff view
 */
function DiffLineRow({
  line,
  showLineNumbers,
}: {
  line: DiffLine;
  showLineNumbers: boolean;
}) {
  const bgColor = {
    unchanged: "",
    added: "bg-green-50 dark:bg-green-950/30",
    removed: "bg-red-50 dark:bg-red-950/30",
    header: "bg-blue-50 dark:bg-blue-950/30",
  }[line.type];

  const textColor = {
    unchanged: "text-foreground",
    added: "text-green-800 dark:text-green-200",
    removed: "text-red-800 dark:text-red-200",
    header: "text-blue-800 dark:text-blue-200",
  }[line.type];

  const prefix = {
    unchanged: " ",
    added: "+",
    removed: "-",
    header: "@",
  }[line.type];

  const prefixColor = {
    unchanged: "text-muted-foreground",
    added: "text-green-600 dark:text-green-400",
    removed: "text-red-600 dark:text-red-400",
    header: "text-blue-600 dark:text-blue-400",
  }[line.type];

  return (
    <div className={cn("flex font-mono text-xs leading-5", bgColor)}>
      {showLineNumbers && (
        <>
          <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border/50">
            {line.oldLineNumber || ""}
          </span>
          <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border/50">
            {line.newLineNumber || ""}
          </span>
        </>
      )}
      <span className={cn("w-5 text-center select-none font-bold", prefixColor)}>
        {prefix}
      </span>
      <pre className={cn("flex-1 px-2 whitespace-pre overflow-x-auto", textColor)}>
        {line.content || " "}
      </pre>
    </div>
  );
}

/**
 * Hunk header showing line range
 */
function HunkHeader({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-mono text-xs px-3 py-1 border-y border-border/50">
      @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
    </div>
  );
}

/**
 * Unified diff view component
 * Displays before/after comparison with syntax highlighting
 */
export function DiffView({
  lines,
  path,
  showLineNumbers = true,
  contextLines = 3,
  maxHeight = "400px",
  className,
}: DiffViewProps) {
  const hunks = useMemo(() => createHunks(lines, contextLines), [lines, contextLines]);
  const stats = useMemo(() => computeDiffStats(lines), [lines]);
  const extension = getFileExtension(path);
  const language = getLanguageFromExtension(extension);

  if (lines.length === 0) {
    return (
      <div className={cn("border rounded-md p-4 text-center text-muted-foreground", className)}>
        No changes
      </div>
    );
  }

  // If no hunks (all unchanged), show a simple message
  if (hunks.length === 0) {
    return (
      <div className={cn("border rounded-md p-4 text-center text-muted-foreground", className)}>
        No changes detected
      </div>
    );
  }

  return (
    <div className={cn("border rounded-md overflow-hidden", className)}>
      {/* Stats header */}
      <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 border-b text-xs">
        <span className="font-medium text-foreground truncate flex-1" title={path}>
          {path}
        </span>
        <span className="text-muted-foreground">{language}</span>
        <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
        <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
      </div>

      {/* Diff content */}
      <div
        className="overflow-auto bg-background"
        style={{ maxHeight }}
      >
        {hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            {hunkIdx > 0 && <HunkHeader hunk={hunk} />}
            {hunkIdx === 0 && lines[0]?.type !== "header" && <HunkHeader hunk={hunk} />}
            {hunk.lines.map((line, lineIdx) => (
              <DiffLineRow
                key={`${hunkIdx}-${lineIdx}`}
                line={line}
                showLineNumbers={showLineNumbers}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact diff stats badge
 */
export function DiffStats({ lines }: { lines: DiffLine[] }) {
  const stats = useMemo(() => computeDiffStats(lines), [lines]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-green-600 dark:text-green-400 font-medium">
        +{stats.additions}
      </span>
      <span className="text-red-600 dark:text-red-400 font-medium">
        -{stats.deletions}
      </span>
    </div>
  );
}

/**
 * Side-by-side diff view (split view)
 */
export function SplitDiffView({
  lines,
  path,
  showLineNumbers = true,
  maxHeight = "400px",
  className,
}: DiffViewProps) {
  const stats = useMemo(() => computeDiffStats(lines), [lines]);
  const extension = getFileExtension(path);
  const language = getLanguageFromExtension(extension);

  // Separate old and new lines for side-by-side view
  const { leftLines, rightLines } = useMemo(() => {
    const left: (DiffLine | null)[] = [];
    const right: (DiffLine | null)[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.type === "unchanged") {
        left.push(line);
        right.push(line);
        i++;
      } else if (line.type === "removed") {
        // Look ahead for added lines to pair with
        let j = i + 1;
        const removedLines: DiffLine[] = [line];
        while (j < lines.length && lines[j].type === "removed") {
          removedLines.push(lines[j]);
          j++;
        }
        const addedLines: DiffLine[] = [];
        while (j < lines.length && lines[j].type === "added") {
          addedLines.push(lines[j]);
          j++;
        }

        // Pair removed with added
        const maxLen = Math.max(removedLines.length, addedLines.length);
        for (let k = 0; k < maxLen; k++) {
          left.push(removedLines[k] || null);
          right.push(addedLines[k] || null);
        }
        i = j;
      } else if (line.type === "added") {
        left.push(null);
        right.push(line);
        i++;
      } else {
        i++;
      }
    }

    return { leftLines: left, rightLines: right };
  }, [lines]);

  if (lines.length === 0) {
    return (
      <div className={cn("border rounded-md p-4 text-center text-muted-foreground", className)}>
        No changes
      </div>
    );
  }

  return (
    <div className={cn("border rounded-md overflow-hidden", className)}>
      {/* Stats header */}
      <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 border-b text-xs">
        <span className="font-medium text-foreground truncate flex-1" title={path}>
          {path}
        </span>
        <span className="text-muted-foreground">{language}</span>
        <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
        <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
      </div>

      {/* Column headers */}
      <div className="flex border-b text-xs font-medium">
        <div className="flex-1 px-3 py-1 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border-r">
          Original
        </div>
        <div className="flex-1 px-3 py-1 bg-green-50/50 dark:bg-green-950/20 text-green-700 dark:text-green-300">
          Modified
        </div>
      </div>

      {/* Split diff content */}
      <div
        className="flex overflow-auto bg-background"
        style={{ maxHeight }}
      >
        {/* Left side (original) */}
        <div className="flex-1 border-r">
          {leftLines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "flex font-mono text-xs leading-5 min-h-[1.25rem]",
                line?.type === "removed" && "bg-red-50 dark:bg-red-950/30"
              )}
            >
              {showLineNumbers && (
                <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border/50">
                  {line?.oldLineNumber || ""}
                </span>
              )}
              <pre
                className={cn(
                  "flex-1 px-2 whitespace-pre overflow-x-auto",
                  line?.type === "removed" && "text-red-800 dark:text-red-200"
                )}
              >
                {line?.content || " "}
              </pre>
            </div>
          ))}
        </div>

        {/* Right side (modified) */}
        <div className="flex-1">
          {rightLines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "flex font-mono text-xs leading-5 min-h-[1.25rem]",
                line?.type === "added" && "bg-green-50 dark:bg-green-950/30"
              )}
            >
              {showLineNumbers && (
                <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border/50">
                  {line?.newLineNumber || ""}
                </span>
              )}
              <pre
                className={cn(
                  "flex-1 px-2 whitespace-pre overflow-x-auto",
                  line?.type === "added" && "text-green-800 dark:text-green-200"
                )}
              >
                {line?.content || " "}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
