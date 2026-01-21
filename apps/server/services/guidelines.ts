import * as path from "path";
import type { GuidelinesConfig, GuidelineRule, ResolvedGuidelines } from "@open-dev/shared";

const GUIDELINES_FILE_NAME = ".ai-guidelines.json";

/**
 * Cache for parsed guidelines configs to avoid re-reading files
 */
const configCache = new Map<string, { config: GuidelinesConfig; mtime: number }>();

/**
 * Load and parse the guidelines configuration file from a working directory
 */
export async function loadGuidelinesConfig(
  workingDirectory: string
): Promise<GuidelinesConfig | null> {
  const configPath = path.join(workingDirectory, GUIDELINES_FILE_NAME);

  try {
    const file = Bun.file(configPath);

    if (!(await file.exists())) {
      return null;
    }

    // Check cache
    const stat = await file.stat?.();
    const mtime = stat?.mtime?.getTime() || 0;
    const cached = configCache.get(configPath);

    if (cached && cached.mtime === mtime) {
      return cached.config;
    }

    const content = await file.text();
    const config = JSON.parse(content) as GuidelinesConfig;

    // Validate and normalize the config
    const normalizedConfig = normalizeConfig(config);

    // Cache the result
    configCache.set(configPath, { config: normalizedConfig, mtime });

    return normalizedConfig;
  } catch (error) {
    console.error(`Error loading guidelines config from ${configPath}:`, error);
    return null;
  }
}

/**
 * Normalize and validate a guidelines configuration
 */
function normalizeConfig(config: GuidelinesConfig): GuidelinesConfig {
  return {
    default: config.default || undefined,
    strategy: config.strategy || "merge",
    rules: (config.rules || []).map((rule, index) => ({
      pattern: rule.pattern,
      guidelines: rule.guidelines,
      priority: rule.priority ?? index, // Default priority based on order
    })),
  };
}

/**
 * Check if a file path matches a glob pattern
 * Uses minimatch-style glob patterns
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize the file path (remove leading ./ if present)
  const normalizedPath = filePath.replace(/^\.\//, "");

  // Convert glob pattern to regex
  const regexPattern = globToRegex(pattern);
  return regexPattern.test(normalizedPath);
}

/**
 * Convert a glob pattern to a regular expression.
 * Handles: single star (matches non-slash chars), double star (matches anything
 * including slashes), and question mark (single non-slash char).
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];
    const nextChar = pattern[i + 1];

    // Handle ** (match anything including /)
    if (char === "*" && nextChar === "*") {
      // Check if it's **/ (common pattern meaning "zero or more directories")
      if (pattern[i + 2] === "/") {
        // **/ matches zero or more directories (including no directory)
        regexStr += "(?:.*/)?";
        i += 3;
        continue;
      }
      // ** alone matches anything
      regexStr += ".*";
      i += 2;
      continue;
    }

    // Handle * (match anything except /)
    if (char === "*") {
      regexStr += "[^/]*";
      i++;
      continue;
    }

    // Handle ? (match single character except /)
    if (char === "?") {
      regexStr += "[^/]";
      i++;
      continue;
    }

    // Escape special regex characters
    if (".+^${}()|[]\\".includes(char!)) {
      regexStr += "\\" + char;
      i++;
      continue;
    }

    // Regular character
    regexStr += char;
    i++;
  }

  return new RegExp(`^${regexStr}$`);
}

/**
 * Resolve guidelines for a specific file path within a project
 *
 * @param workingDirectory - The project's working directory
 * @param filePath - Relative path to the file from the working directory
 * @param fallbackGuidelines - Project-level guidelines to use if no config file exists
 * @returns Resolved guidelines for the file
 */
export async function resolveGuidelines(
  workingDirectory: string,
  filePath: string,
  fallbackGuidelines?: string | null
): Promise<ResolvedGuidelines> {
  const config = await loadGuidelinesConfig(workingDirectory);

  // If no config file exists, use fallback project guidelines
  if (!config) {
    return {
      guidelines: fallbackGuidelines || "",
      matchedRules: [],
      includesDefault: false,
    };
  }

  // Normalize file path (make it relative if it's absolute)
  const normalizedFilePath = filePath.startsWith(workingDirectory)
    ? path.relative(workingDirectory, filePath)
    : filePath;

  // Find matching rules
  const matchingRules: Array<GuidelineRule & { priority: number }> = [];

  for (const rule of config.rules || []) {
    if (matchesPattern(normalizedFilePath, rule.pattern)) {
      matchingRules.push({
        ...rule,
        priority: rule.priority ?? 0,
      });
    }
  }

  // Sort rules by priority (ascending - lower priority first)
  matchingRules.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  // Build the resolved guidelines based on strategy
  if (config.strategy === "override") {
    // Use only the highest priority matching rule
    const highestPriorityRule = matchingRules[matchingRules.length - 1];

    if (highestPriorityRule) {
      return {
        guidelines: highestPriorityRule.guidelines,
        matchedRules: [{ pattern: highestPriorityRule.pattern, priority: highestPriorityRule.priority }],
        includesDefault: false,
      };
    }

    // No matching rules, use default
    return {
      guidelines: config.default || fallbackGuidelines || "",
      matchedRules: [],
      includesDefault: !!config.default,
    };
  }

  // Default strategy: merge (concatenate all matching guidelines)
  const guidelineseParts: string[] = [];
  const matchedRulesInfo: Array<{ pattern: string; priority: number }> = [];

  // Start with default guidelines if present
  if (config.default) {
    guidelineseParts.push(config.default);
  }

  // Add matching rules in priority order
  for (const rule of matchingRules) {
    guidelineseParts.push(rule.guidelines);
    matchedRulesInfo.push({ pattern: rule.pattern, priority: rule.priority });
  }

  return {
    guidelines: guidelineseParts.join("\n\n"),
    matchedRules: matchedRulesInfo,
    includesDefault: !!config.default,
  };
}

/**
 * Resolve guidelines for multiple file paths (useful when agent is working on multiple files)
 * Returns merged guidelines for all the files
 */
export async function resolveGuidelinesForFiles(
  workingDirectory: string,
  filePaths: string[],
  fallbackGuidelines?: string | null
): Promise<ResolvedGuidelines> {
  if (filePaths.length === 0) {
    return {
      guidelines: fallbackGuidelines || "",
      matchedRules: [],
      includesDefault: false,
    };
  }

  // Get guidelines for each file
  const allResolved = await Promise.all(
    filePaths.map((fp) => resolveGuidelines(workingDirectory, fp, fallbackGuidelines))
  );

  // Collect unique guidelines and rules
  const seenGuidelines = new Set<string>();
  const allGuidelines: string[] = [];
  const allMatchedRules: Array<{ pattern: string; priority: number }> = [];
  let includesDefault = false;

  for (const resolved of allResolved) {
    if (resolved.includesDefault) {
      includesDefault = true;
    }

    // Add unique guidelines parts
    const parts = resolved.guidelines.split("\n\n").filter(Boolean);
    for (const part of parts) {
      if (!seenGuidelines.has(part)) {
        seenGuidelines.add(part);
        allGuidelines.push(part);
      }
    }

    // Collect matched rules
    for (const rule of resolved.matchedRules) {
      if (!allMatchedRules.some((r) => r.pattern === rule.pattern)) {
        allMatchedRules.push(rule);
      }
    }
  }

  return {
    guidelines: allGuidelines.join("\n\n"),
    matchedRules: allMatchedRules,
    includesDefault,
  };
}

/**
 * Clear the guidelines config cache (useful for testing or when config changes)
 */
export function clearGuidelinesCache(): void {
  configCache.clear();
}

/**
 * Check if a guidelines config file exists in the working directory
 */
export async function hasGuidelinesConfig(workingDirectory: string): Promise<boolean> {
  const configPath = path.join(workingDirectory, GUIDELINES_FILE_NAME);
  const file = Bun.file(configPath);
  return file.exists();
}

/**
 * Create a default guidelines config file in the working directory
 */
export async function createDefaultGuidelinesConfig(
  workingDirectory: string,
  projectGuidelines?: string
): Promise<void> {
  const configPath = path.join(workingDirectory, GUIDELINES_FILE_NAME);

  const defaultConfig: GuidelinesConfig = {
    default: projectGuidelines || "Follow the existing code patterns and conventions in this project.",
    strategy: "merge",
    rules: [
      {
        pattern: "**/*.test.ts",
        guidelines: "Write comprehensive tests. Use descriptive test names. Cover edge cases.",
        priority: 20,
      },
      {
        pattern: "**/*.test.tsx",
        guidelines: "Write comprehensive tests. Use descriptive test names. Cover edge cases.",
        priority: 20,
      },
    ],
  };

  await Bun.write(configPath, JSON.stringify(defaultConfig, null, 2));
}
