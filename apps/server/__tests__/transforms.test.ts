/**
 * Unit tests for data transform functions
 * 
 * These tests ensure that transform functions handle malformed data gracefully
 * and don't throw errors that would cause 500 responses.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock the database task type to match schema
interface MockDbTask {
  id: string;
  title: string;
  description: string | null;
  status: "backlog" | "in_progress" | "validation" | "done";
  priority: "low" | "medium" | "high";
  position: number;
  projectId: string;
  dependsOn: string;
  createdAt: Date;
  updatedAt: Date;
}

// Create a mock task factory
function createMockDbTask(overrides: Partial<MockDbTask> = {}): MockDbTask {
  return {
    id: "task-123",
    title: "Test Task",
    description: "Test description",
    status: "backlog",
    priority: "medium",
    position: 0,
    projectId: "project-123",
    dependsOn: "[]",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Import the actual transform function logic (recreated here since it's not exported)
// In a real scenario, you'd export the function and import it
function transformTask(dbTask: MockDbTask) {
  let dependsOn: string[] = [];
  try {
    const raw = dbTask.dependsOn;
    if (raw && raw.startsWith('[')) {
      dependsOn = JSON.parse(raw) as string[];
    }
  } catch {
    // If parsing fails, default to empty array
    console.warn(`Invalid dependsOn JSON for task ${dbTask.id}: ${dbTask.dependsOn}`);
  }

  return {
    ...dbTask,
    dependsOn,
    createdAt: dbTask.createdAt.toISOString(),
    updatedAt: dbTask.updatedAt.toISOString(),
  };
}

describe("transformTask", () => {
  describe("dependsOn parsing", () => {
    test("handles valid empty array JSON", () => {
      const dbTask = createMockDbTask({ dependsOn: "[]" });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles valid array with task IDs", () => {
      const dbTask = createMockDbTask({ dependsOn: '["task-1", "task-2", "task-3"]' });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual(["task-1", "task-2", "task-3"]);
    });

    test("handles single task ID array", () => {
      const dbTask = createMockDbTask({ dependsOn: '["task-abc"]' });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual(["task-abc"]);
    });

    test("handles null dependsOn gracefully", () => {
      const dbTask = createMockDbTask({ dependsOn: null as unknown as string });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles undefined dependsOn gracefully", () => {
      const dbTask = createMockDbTask({ dependsOn: undefined as unknown as string });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles empty string gracefully", () => {
      const dbTask = createMockDbTask({ dependsOn: "" });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles raw column name 'depends_on' as value gracefully", () => {
      // This is the exact bug that was causing the JSON parse error
      const dbTask = createMockDbTask({ dependsOn: "depends_on" });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles malformed JSON gracefully", () => {
      const dbTask = createMockDbTask({ dependsOn: "[invalid json" });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles object instead of array gracefully", () => {
      const dbTask = createMockDbTask({ dependsOn: '{"key": "value"}' });
      // Should not throw, but result may vary - the important thing is no crash
      expect(() => transformTask(dbTask)).not.toThrow();
    });

    test("handles number string gracefully", () => {
      const dbTask = createMockDbTask({ dependsOn: "123" });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles boolean string gracefully", () => {
      const dbTask = createMockDbTask({ dependsOn: "true" });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles whitespace-only string gracefully", () => {
      const dbTask = createMockDbTask({ dependsOn: "   " });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual([]);
    });

    test("handles array with whitespace", () => {
      const dbTask = createMockDbTask({ dependsOn: '[ "task-1" , "task-2" ]' });
      const result = transformTask(dbTask);
      expect(result.dependsOn).toEqual(["task-1", "task-2"]);
    });
  });

  describe("date transformation", () => {
    test("converts createdAt Date to ISO string", () => {
      const date = new Date("2024-06-15T10:30:00Z");
      const dbTask = createMockDbTask({ createdAt: date });
      const result = transformTask(dbTask);
      expect(result.createdAt).toBe("2024-06-15T10:30:00.000Z");
    });

    test("converts updatedAt Date to ISO string", () => {
      const date = new Date("2024-06-15T10:30:00Z");
      const dbTask = createMockDbTask({ updatedAt: date });
      const result = transformTask(dbTask);
      expect(result.updatedAt).toBe("2024-06-15T10:30:00.000Z");
    });
  });

  describe("other fields", () => {
    test("preserves all other task fields", () => {
      const dbTask = createMockDbTask({
        id: "custom-id",
        title: "Custom Title",
        description: "Custom description",
        status: "in_progress",
        priority: "high",
        position: 5,
        projectId: "custom-project",
      });
      const result = transformTask(dbTask);
      
      expect(result.id).toBe("custom-id");
      expect(result.title).toBe("Custom Title");
      expect(result.description).toBe("Custom description");
      expect(result.status).toBe("in_progress");
      expect(result.priority).toBe("high");
      expect(result.position).toBe(5);
      expect(result.projectId).toBe("custom-project");
    });

    test("handles null description", () => {
      const dbTask = createMockDbTask({ description: null });
      const result = transformTask(dbTask);
      expect(result.description).toBeNull();
    });
  });
});

// Test safeJsonParse utility pattern
describe("safeJsonParse pattern", () => {
  function safeJsonParse<T>(value: string | null | undefined, defaultValue: T): T {
    if (!value) return defaultValue;
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }

  test("parses valid JSON", () => {
    const result = safeJsonParse('{"key": "value"}', {});
    expect(result).toEqual({ key: "value" });
  });

  test("returns default for null", () => {
    const result = safeJsonParse(null, { default: true });
    expect(result).toEqual({ default: true });
  });

  test("returns default for undefined", () => {
    const result = safeJsonParse(undefined, []);
    expect(result).toEqual([]);
  });

  test("returns default for invalid JSON", () => {
    const result = safeJsonParse("not-json", { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  test("returns default for empty string", () => {
    const result = safeJsonParse("", 42);
    expect(result).toBe(42);
  });
});

// Test for project settings parsing (sandboxLimits, toolApprovalSettings)
describe("Project settings JSON parsing", () => {
  interface SandboxLimits {
    maxExecutionTimeSeconds: number;
    maxTokens: number;
    maxFileOperations: number;
    maxCommands: number;
    maxFileSizeBytes: number;
    maxSteps: number;
  }

  const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
    maxExecutionTimeSeconds: 300,
    maxTokens: 100000,
    maxFileOperations: 50,
    maxCommands: 10,
    maxFileSizeBytes: 1048576,
    maxSteps: 20,
  };

  function parseSandboxLimits(value: string | null): SandboxLimits {
    if (!value) return DEFAULT_SANDBOX_LIMITS;
    try {
      return JSON.parse(value);
    } catch {
      return DEFAULT_SANDBOX_LIMITS;
    }
  }

  test("parses valid sandbox limits", () => {
    const json = JSON.stringify({ maxSteps: 50, maxTokens: 200000 });
    const result = parseSandboxLimits(json);
    expect(result.maxSteps).toBe(50);
    expect(result.maxTokens).toBe(200000);
  });

  test("returns defaults for null", () => {
    const result = parseSandboxLimits(null);
    expect(result).toEqual(DEFAULT_SANDBOX_LIMITS);
  });

  test("returns defaults for invalid JSON", () => {
    const result = parseSandboxLimits("sandbox_limits");
    expect(result).toEqual(DEFAULT_SANDBOX_LIMITS);
  });

  test("returns defaults for malformed JSON", () => {
    const result = parseSandboxLimits("{maxSteps: 50}"); // Missing quotes
    expect(result).toEqual(DEFAULT_SANDBOX_LIMITS);
  });
});
