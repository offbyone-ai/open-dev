import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import * as path from "path";
import * as os from "os";
import {
  loadGuidelinesConfig,
  resolveGuidelines,
  resolveGuidelinesForFiles,
  clearGuidelinesCache,
  hasGuidelinesConfig,
  createDefaultGuidelinesConfig,
} from "./guidelines";
import type { GuidelinesConfig } from "@open-dev/shared";

// Create a temporary directory for each test
let testDir: string;

async function setupTestDir(): Promise<string> {
  const tmpBase = os.tmpdir();
  const dirName = `guidelines-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDir = path.join(tmpBase, dirName);
  await Bun.$`mkdir -p ${testDir}`.quiet();
  return testDir;
}

async function cleanupTestDir(): Promise<void> {
  if (testDir) {
    await Bun.$`rm -rf ${testDir}`.quiet();
  }
}

async function writeGuidelinesConfig(dir: string, config: GuidelinesConfig): Promise<void> {
  await Bun.write(path.join(dir, ".ai-guidelines.json"), JSON.stringify(config, null, 2));
}

describe("Guidelines Service", () => {
  beforeEach(async () => {
    clearGuidelinesCache();
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  describe("loadGuidelinesConfig", () => {
    test("returns null when no config file exists", async () => {
      const config = await loadGuidelinesConfig(testDir);
      expect(config).toBeNull();
    });

    test("loads and parses config file", async () => {
      const configData: GuidelinesConfig = {
        default: "Default guidelines",
        strategy: "merge",
        rules: [
          { pattern: "src/**", guidelines: "Source guidelines", priority: 10 },
        ],
      };
      await writeGuidelinesConfig(testDir, configData);

      const config = await loadGuidelinesConfig(testDir);
      expect(config).not.toBeNull();
      expect(config!.default).toBe("Default guidelines");
      expect(config!.strategy).toBe("merge");
      expect(config!.rules).toHaveLength(1);
      expect(config!.rules![0].pattern).toBe("src/**");
    });

    test("caches config and returns same result", async () => {
      const configData: GuidelinesConfig = {
        default: "Cached guidelines",
        rules: [],
      };
      await writeGuidelinesConfig(testDir, configData);

      const config1 = await loadGuidelinesConfig(testDir);
      const config2 = await loadGuidelinesConfig(testDir);

      // Should be the same object reference from cache
      expect(config1).toBe(config2);
    });

    test("normalizes config with default strategy", async () => {
      const configData = {
        default: "Just default",
        rules: [{ pattern: "*.ts", guidelines: "TS guidelines" }],
      };
      await writeGuidelinesConfig(testDir, configData as GuidelinesConfig);

      const config = await loadGuidelinesConfig(testDir);
      expect(config!.strategy).toBe("merge"); // Default strategy
    });
  });

  describe("resolveGuidelines", () => {
    test("returns fallback when no config exists", async () => {
      const resolved = await resolveGuidelines(testDir, "src/file.ts", "Fallback guidelines");

      expect(resolved.guidelines).toBe("Fallback guidelines");
      expect(resolved.matchedRules).toHaveLength(0);
      expect(resolved.includesDefault).toBe(false);
    });

    test("returns empty string when no config and no fallback", async () => {
      const resolved = await resolveGuidelines(testDir, "src/file.ts");

      expect(resolved.guidelines).toBe("");
      expect(resolved.matchedRules).toHaveLength(0);
    });

    test("applies default guidelines for any file", async () => {
      await writeGuidelinesConfig(testDir, {
        default: "Apply to all files",
        rules: [],
      });

      const resolved = await resolveGuidelines(testDir, "any/path/file.txt");

      expect(resolved.guidelines).toBe("Apply to all files");
      expect(resolved.includesDefault).toBe(true);
      expect(resolved.matchedRules).toHaveLength(0);
    });

    test("matches glob pattern with **", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [
          { pattern: "src/**/*.ts", guidelines: "TypeScript in src" },
        ],
      });

      const resolved = await resolveGuidelines(testDir, "src/components/Button.ts");

      expect(resolved.guidelines).toBe("TypeScript in src");
      expect(resolved.matchedRules).toHaveLength(1);
      expect(resolved.matchedRules[0].pattern).toBe("src/**/*.ts");
    });

    test("matches glob pattern with *", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [
          { pattern: "*.test.ts", guidelines: "Test file guidelines" },
        ],
      });

      const resolved = await resolveGuidelines(testDir, "utils.test.ts");

      expect(resolved.guidelines).toBe("Test file guidelines");
      expect(resolved.matchedRules).toHaveLength(1);
    });

    test("does not match non-matching patterns", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [
          { pattern: "src/frontend/**", guidelines: "Frontend guidelines" },
        ],
      });

      const resolved = await resolveGuidelines(testDir, "src/backend/api.ts");

      expect(resolved.guidelines).toBe("");
      expect(resolved.matchedRules).toHaveLength(0);
    });

    test("merges default and matching rules in merge strategy", async () => {
      await writeGuidelinesConfig(testDir, {
        default: "Default rules",
        strategy: "merge",
        rules: [
          { pattern: "**/*.ts", guidelines: "TypeScript rules", priority: 10 },
          { pattern: "**/*.test.ts", guidelines: "Test rules", priority: 20 },
        ],
      });

      const resolved = await resolveGuidelines(testDir, "utils.test.ts");

      expect(resolved.guidelines).toContain("Default rules");
      expect(resolved.guidelines).toContain("TypeScript rules");
      expect(resolved.guidelines).toContain("Test rules");
      expect(resolved.includesDefault).toBe(true);
      expect(resolved.matchedRules).toHaveLength(2);
    });

    test("uses highest priority rule in override strategy", async () => {
      await writeGuidelinesConfig(testDir, {
        default: "Default rules",
        strategy: "override",
        rules: [
          { pattern: "**/*.ts", guidelines: "TypeScript rules", priority: 10 },
          { pattern: "**/*.test.ts", guidelines: "Test rules", priority: 20 },
        ],
      });

      const resolved = await resolveGuidelines(testDir, "utils.test.ts");

      // Should only contain the highest priority match
      expect(resolved.guidelines).toBe("Test rules");
      expect(resolved.includesDefault).toBe(false);
      expect(resolved.matchedRules).toHaveLength(1);
      expect(resolved.matchedRules[0].pattern).toBe("**/*.test.ts");
    });

    test("falls back to default in override strategy when no rules match", async () => {
      await writeGuidelinesConfig(testDir, {
        default: "Default rules",
        strategy: "override",
        rules: [
          { pattern: "src/**", guidelines: "Src rules" },
        ],
      });

      const resolved = await resolveGuidelines(testDir, "lib/utils.ts");

      expect(resolved.guidelines).toBe("Default rules");
      expect(resolved.includesDefault).toBe(true);
      expect(resolved.matchedRules).toHaveLength(0);
    });

    test("orders rules by priority in merge strategy", async () => {
      await writeGuidelinesConfig(testDir, {
        strategy: "merge",
        rules: [
          { pattern: "**", guidelines: "General (low priority)", priority: 1 },
          { pattern: "**/*.ts", guidelines: "TypeScript (high priority)", priority: 100 },
        ],
      });

      const resolved = await resolveGuidelines(testDir, "file.ts");

      // Guidelines should be ordered: low priority first, high priority last
      const parts = resolved.guidelines.split("\n\n");
      expect(parts[0]).toContain("General");
      expect(parts[1]).toContain("TypeScript");
    });

    test("handles normalized file paths", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [
          { pattern: "src/file.ts", guidelines: "Exact match" },
        ],
      });

      // Test with leading ./
      const resolved = await resolveGuidelines(testDir, "./src/file.ts");
      expect(resolved.guidelines).toBe("Exact match");
    });
  });

  describe("resolveGuidelinesForFiles", () => {
    test("returns fallback for empty file list", async () => {
      const resolved = await resolveGuidelinesForFiles(testDir, [], "Fallback");

      expect(resolved.guidelines).toBe("Fallback");
      expect(resolved.matchedRules).toHaveLength(0);
    });

    test("merges guidelines from multiple files", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [
          { pattern: "src/frontend/**", guidelines: "Frontend rules" },
          { pattern: "src/backend/**", guidelines: "Backend rules" },
        ],
      });

      const resolved = await resolveGuidelinesForFiles(testDir, [
        "src/frontend/App.tsx",
        "src/backend/api.ts",
      ]);

      expect(resolved.guidelines).toContain("Frontend rules");
      expect(resolved.guidelines).toContain("Backend rules");
      expect(resolved.matchedRules).toHaveLength(2);
    });

    test("deduplicates matching rules", async () => {
      await writeGuidelinesConfig(testDir, {
        default: "Default",
        rules: [
          { pattern: "**/*.ts", guidelines: "TypeScript" },
        ],
      });

      const resolved = await resolveGuidelinesForFiles(testDir, [
        "file1.ts",
        "file2.ts",
        "file3.ts",
      ]);

      // Default and TypeScript should only appear once each
      const defaultCount = (resolved.guidelines.match(/Default/g) || []).length;
      const tsCount = (resolved.guidelines.match(/TypeScript/g) || []).length;

      expect(defaultCount).toBe(1);
      expect(tsCount).toBe(1);
    });
  });

  describe("hasGuidelinesConfig", () => {
    test("returns false when config does not exist", async () => {
      const exists = await hasGuidelinesConfig(testDir);
      expect(exists).toBe(false);
    });

    test("returns true when config exists", async () => {
      await writeGuidelinesConfig(testDir, { default: "Test" });

      const exists = await hasGuidelinesConfig(testDir);
      expect(exists).toBe(true);
    });
  });

  describe("createDefaultGuidelinesConfig", () => {
    test("creates config with provided guidelines", async () => {
      await createDefaultGuidelinesConfig(testDir, "Project specific guidelines");

      const config = await loadGuidelinesConfig(testDir);
      expect(config).not.toBeNull();
      expect(config!.default).toBe("Project specific guidelines");
    });

    test("creates config with default guidelines when none provided", async () => {
      await createDefaultGuidelinesConfig(testDir);

      const config = await loadGuidelinesConfig(testDir);
      expect(config).not.toBeNull();
      expect(config!.default).toContain("existing code patterns");
    });

    test("includes test file rules by default", async () => {
      await createDefaultGuidelinesConfig(testDir);

      const config = await loadGuidelinesConfig(testDir);
      expect(config!.rules).toBeDefined();
      expect(config!.rules!.some(r => r.pattern.includes("test.ts"))).toBe(true);
    });
  });

  describe("Glob Pattern Matching", () => {
    test("matches exact file name", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [{ pattern: "README.md", guidelines: "Readme rules" }],
      });

      const match = await resolveGuidelines(testDir, "README.md");
      const noMatch = await resolveGuidelines(testDir, "OTHER.md");

      expect(match.guidelines).toBe("Readme rules");
      expect(noMatch.guidelines).toBe("");
    });

    test("matches ? single character wildcard", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [{ pattern: "file?.ts", guidelines: "Single char match" }],
      });

      const match = await resolveGuidelines(testDir, "file1.ts");
      const noMatch = await resolveGuidelines(testDir, "file12.ts");

      expect(match.guidelines).toBe("Single char match");
      expect(noMatch.guidelines).toBe("");
    });

    test("matches deeply nested paths with **", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [{ pattern: "**/*.spec.ts", guidelines: "Spec files" }],
      });

      const match1 = await resolveGuidelines(testDir, "tests/unit/utils.spec.ts");
      const match2 = await resolveGuidelines(testDir, "a/b/c/d/e/file.spec.ts");

      expect(match1.guidelines).toBe("Spec files");
      expect(match2.guidelines).toBe("Spec files");
    });

    test("escapes regex special characters in patterns", async () => {
      await writeGuidelinesConfig(testDir, {
        rules: [{ pattern: "file.test.ts", guidelines: "Escaped dots" }],
      });

      const match = await resolveGuidelines(testDir, "file.test.ts");
      const noMatch = await resolveGuidelines(testDir, "fileXtestXts"); // Without escaping, . would match any char

      expect(match.guidelines).toBe("Escaped dots");
      expect(noMatch.guidelines).toBe("");
    });
  });
});
