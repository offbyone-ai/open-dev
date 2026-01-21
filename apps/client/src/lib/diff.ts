/**
 * Diff utilities for computing and displaying unified diffs
 */

export interface DiffLine {
  type: "unchanged" | "added" | "removed" | "header";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileDiff {
  path: string;
  operation: "create" | "modify" | "delete";
  oldContent: string;
  newContent: string;
  lines: DiffLine[];
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/**
 * Compute Longest Common Subsequence (LCS) for diff algorithm
 */
function computeLCS(
  oldLines: string[],
  newLines: string[]
): [number, number][] {
  const m = oldLines.length;
  const n = newLines.length;

  // Create DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  // Fill the DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS indices
  const lcs: [number, number][] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      lcs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Compute unified diff between two strings
 */
export function computeDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Handle empty content edge cases
  if (oldContent === "" && newContent === "") {
    return [];
  }

  if (oldContent === "") {
    return newLines.map((line, idx) => ({
      type: "added" as const,
      content: line,
      newLineNumber: idx + 1,
    }));
  }

  if (newContent === "") {
    return oldLines.map((line, idx) => ({
      type: "removed" as const,
      content: line,
      oldLineNumber: idx + 1,
    }));
  }

  const lcs = computeLCS(oldLines, newLines);
  const result: DiffLine[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  for (const [oldLcsIdx, newLcsIdx] of lcs) {
    // Add removed lines (in old but not in LCS)
    while (oldIdx < oldLcsIdx) {
      result.push({
        type: "removed",
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1,
      });
      oldIdx++;
    }

    // Add added lines (in new but not in LCS)
    while (newIdx < newLcsIdx) {
      result.push({
        type: "added",
        content: newLines[newIdx],
        newLineNumber: newIdx + 1,
      });
      newIdx++;
    }

    // Add unchanged line (in LCS)
    result.push({
      type: "unchanged",
      content: oldLines[oldIdx],
      oldLineNumber: oldIdx + 1,
      newLineNumber: newIdx + 1,
    });
    oldIdx++;
    newIdx++;
  }

  // Add remaining removed lines
  while (oldIdx < oldLines.length) {
    result.push({
      type: "removed",
      content: oldLines[oldIdx],
      oldLineNumber: oldIdx + 1,
    });
    oldIdx++;
  }

  // Add remaining added lines
  while (newIdx < newLines.length) {
    result.push({
      type: "added",
      content: newLines[newIdx],
      newLineNumber: newIdx + 1,
    });
    newIdx++;
  }

  return result;
}

/**
 * Group diff lines into hunks for better display
 * Uses context lines around changes
 */
export function createHunks(lines: DiffLine[], contextLines = 3): DiffHunk[] {
  if (lines.length === 0) return [];

  const hunks: DiffHunk[] = [];
  const changeIndices: number[] = [];

  // Find indices of changed lines
  lines.forEach((line, idx) => {
    if (line.type === "added" || line.type === "removed") {
      changeIndices.push(idx);
    }
  });

  if (changeIndices.length === 0) {
    // No changes, return empty array
    return [];
  }

  // Group changes into hunks
  let hunkStart = Math.max(0, changeIndices[0] - contextLines);
  let hunkEnd = Math.min(lines.length - 1, changeIndices[0] + contextLines);

  for (let i = 1; i < changeIndices.length; i++) {
    const changeStart = changeIndices[i] - contextLines;
    const prevEnd = changeIndices[i - 1] + contextLines;

    if (changeStart <= prevEnd + 1) {
      // Merge with current hunk
      hunkEnd = Math.min(lines.length - 1, changeIndices[i] + contextLines);
    } else {
      // Create new hunk
      const hunkLines = lines.slice(hunkStart, hunkEnd + 1);
      const oldStart = hunkLines.find((l) => l.oldLineNumber)?.oldLineNumber || 1;
      const newStart = hunkLines.find((l) => l.newLineNumber)?.newLineNumber || 1;

      hunks.push({
        oldStart,
        oldCount: hunkLines.filter((l) => l.type !== "added").length,
        newStart,
        newCount: hunkLines.filter((l) => l.type !== "removed").length,
        lines: hunkLines,
      });

      hunkStart = Math.max(0, changeIndices[i] - contextLines);
      hunkEnd = Math.min(lines.length - 1, changeIndices[i] + contextLines);
    }
  }

  // Add final hunk
  const hunkLines = lines.slice(hunkStart, hunkEnd + 1);
  const oldStart = hunkLines.find((l) => l.oldLineNumber)?.oldLineNumber || 1;
  const newStart = hunkLines.find((l) => l.newLineNumber)?.newLineNumber || 1;

  hunks.push({
    oldStart,
    oldCount: hunkLines.filter((l) => l.type !== "added").length,
    newStart,
    newCount: hunkLines.filter((l) => l.type !== "removed").length,
    lines: hunkLines,
  });

  return hunks;
}

/**
 * Get file extension from path for syntax highlighting
 */
export function getFileExtension(path: string): string {
  const match = path.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Map file extension to language for syntax highlighting
 */
export function getLanguageFromExtension(extension: string): string {
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    dockerfile: "dockerfile",
    toml: "toml",
    ini: "ini",
    env: "bash",
  };

  return languageMap[extension] || "text";
}

/**
 * Compute stats for a diff
 */
export function computeDiffStats(lines: DiffLine[]): {
  additions: number;
  deletions: number;
  unchanged: number;
} {
  return lines.reduce(
    (acc, line) => {
      if (line.type === "added") acc.additions++;
      else if (line.type === "removed") acc.deletions++;
      else if (line.type === "unchanged") acc.unchanged++;
      return acc;
    },
    { additions: 0, deletions: 0, unchanged: 0 }
  );
}

/**
 * Apply search/replace edit to content and compute diff
 */
export function applyEditAndComputeDiff(
  originalContent: string,
  search: string,
  replace: string
): { newContent: string; lines: DiffLine[] } {
  const newContent = originalContent.replace(search, replace);
  const lines = computeDiff(originalContent, newContent);
  return { newContent, lines };
}
