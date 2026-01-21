import { tool } from "ai";
import { z } from "zod/v4";
import type { AgentAction } from "../db/schema";

// Force reload timestamp: 2026-01-13

// Type for tool approval settings - which tools require approval vs execute immediately
export type ToolApprovalSettings = {
  readFile?: boolean;      // Default: false (immediate)
  listDirectory?: boolean; // Default: false (immediate)
  writeFile?: boolean;     // Default: true (requires approval)
  editFile?: boolean;      // Default: true (requires approval)
  deleteFile?: boolean;    // Default: true (requires approval)
  executeCommand?: boolean; // Default: true (requires approval)
  completeTask?: boolean;  // Default: true (requires approval)
};

// Default settings - write operations require approval, read operations don't
export const DEFAULT_TOOL_APPROVAL_SETTINGS: ToolApprovalSettings = {
  readFile: false,
  listDirectory: false,
  writeFile: true,
  editFile: true,
  deleteFile: true,
  executeCommand: true,
  completeTask: true,
};

// Helper to check if a tool requires approval
export function requiresApproval(
  actionType: AgentAction["actionType"],
  settings?: ToolApprovalSettings
): boolean {
  const effectiveSettings = { ...DEFAULT_TOOL_APPROVAL_SETTINGS, ...settings };
  return effectiveSettings[actionType] ?? true;
}

// Define Zod schemas for each tool
const readFileSchema = z.object({
  path: z.string().describe("The path to the file to read, relative to the working directory"),
});

const writeFileSchema = z.object({
  path: z.string().describe("The path to the file to write, relative to the working directory"),
  content: z.string().describe("The content to write to the file"),
});

const editFileSchema = z.object({
  path: z.string().describe("The path to the file to edit, relative to the working directory"),
  search: z.string().describe("The exact text to search for in the file"),
  replace: z.string().describe("The text to replace the search text with"),
});

const deleteFileSchema = z.object({
  path: z.string().describe("The path to the file to delete, relative to the working directory"),
});

const listDirectorySchema = z.object({
  path: z.string().describe("The path to the directory to list, relative to the working directory"),
});

const executeCommandSchema = z.object({
  command: z.string().describe("The shell command to execute"),
  description: z.string().describe("A brief description of what this command does"),
});

const completeTaskSchema = z.object({
  summary: z.string().describe("A summary of what was accomplished to complete the task"),
});

const askQuestionSchema = z.object({
  question: z.string().describe("The clarifying question to ask the user"),
  context: z.string().optional().describe("Additional context about why this question is being asked"),
});

// Action types that require approval
export const REQUIRES_APPROVAL: AgentAction["actionType"][] = [
  "writeFile",
  "editFile",
  "deleteFile",
  "executeCommand",
  "completeTask",
];

// Action types that execute immediately
export const IMMEDIATE_EXECUTION: AgentAction["actionType"][] = [
  "readFile",
  "listDirectory",
];

// Type for action parameters based on action type
export type ActionParams = {
  readFile: z.infer<typeof readFileSchema>;
  writeFile: z.infer<typeof writeFileSchema>;
  editFile: z.infer<typeof editFileSchema>;
  deleteFile: z.infer<typeof deleteFileSchema>;
  listDirectory: z.infer<typeof listDirectorySchema>;
  executeCommand: z.infer<typeof executeCommandSchema>;
  completeTask: z.infer<typeof completeTaskSchema>;
  askQuestion: z.infer<typeof askQuestionSchema>;
};

// Create tools for the AI agent
export function createAgentTools(callbacks: {
  onReadFile: (params: ActionParams["readFile"]) => Promise<string>;
  onListDirectory: (params: ActionParams["listDirectory"]) => Promise<string>;
  onWriteFile: (params: ActionParams["writeFile"]) => Promise<string>;
  onEditFile: (params: ActionParams["editFile"]) => Promise<string>;
  onDeleteFile: (params: ActionParams["deleteFile"]) => Promise<string>;
  onExecuteCommand: (params: ActionParams["executeCommand"]) => Promise<string>;
  onCompleteTask: (params: ActionParams["completeTask"]) => Promise<string>;
  onAskQuestion: (params: ActionParams["askQuestion"]) => Promise<string>;
  onProposeAction: (actionType: AgentAction["actionType"], params: unknown) => Promise<void>;
  approvalSettings?: ToolApprovalSettings;
}) {
  const settings = callbacks.approvalSettings ?? DEFAULT_TOOL_APPROVAL_SETTINGS;

  return {
    readFile: tool({
      description: settings.readFile
        ? "Read the contents of a file. This requires user approval."
        : "Read the contents of a file. This executes immediately without approval.",
      inputSchema: readFileSchema,
      execute: async (params) => {
        if (settings.readFile) {
          await callbacks.onProposeAction("readFile", params);
          return `Proposed: Read file at ${params.path}. Waiting for user approval.`;
        }
        return await callbacks.onReadFile(params);
      },
    }),

    listDirectory: tool({
      description: settings.listDirectory
        ? "List the contents of a directory. This requires user approval."
        : "List the contents of a directory. This executes immediately without approval.",
      inputSchema: listDirectorySchema,
      execute: async (params) => {
        if (settings.listDirectory) {
          await callbacks.onProposeAction("listDirectory", params);
          return `Proposed: List directory at ${params.path}. Waiting for user approval.`;
        }
        return await callbacks.onListDirectory(params);
      },
    }),

    writeFile: tool({
      description: settings.writeFile
        ? "Create or overwrite a file with new content. This requires user approval before execution."
        : "Create or overwrite a file with new content. This executes immediately.",
      inputSchema: writeFileSchema,
      execute: async (params) => {
        if (settings.writeFile) {
          await callbacks.onProposeAction("writeFile", params);
          return `Proposed: Write file at ${params.path}. Waiting for user approval.`;
        }
        return await callbacks.onWriteFile(params);
      },
    }),

    editFile: tool({
      description: settings.editFile
        ? "Edit a file by searching for text and replacing it. This requires user approval before execution."
        : "Edit a file by searching for text and replacing it. This executes immediately.",
      inputSchema: editFileSchema,
      execute: async (params) => {
        if (settings.editFile) {
          await callbacks.onProposeAction("editFile", params);
          return `Proposed: Edit file at ${params.path}. Waiting for user approval.`;
        }
        return await callbacks.onEditFile(params);
      },
    }),

    deleteFile: tool({
      description: settings.deleteFile
        ? "Delete a file. This requires user approval before execution."
        : "Delete a file. This executes immediately.",
      inputSchema: deleteFileSchema,
      execute: async (params) => {
        if (settings.deleteFile) {
          await callbacks.onProposeAction("deleteFile", params);
          return `Proposed: Delete file at ${params.path}. Waiting for user approval.`;
        }
        return await callbacks.onDeleteFile(params);
      },
    }),

    executeCommand: tool({
      description: settings.executeCommand
        ? "Execute a shell command. This requires user approval before execution. Always provide a clear description of what the command does."
        : "Execute a shell command. This executes immediately. Always provide a clear description of what the command does.",
      inputSchema: executeCommandSchema,
      execute: async (params) => {
        if (settings.executeCommand) {
          await callbacks.onProposeAction("executeCommand", params);
          return `Proposed: Execute command "${params.command}". Waiting for user approval.`;
        }
        return await callbacks.onExecuteCommand(params);
      },
    }),

    completeTask: tool({
      description: settings.completeTask
        ? "Mark the task as complete with a summary of what was accomplished. This requires user approval."
        : "Mark the task as complete with a summary of what was accomplished. This executes immediately.",
      inputSchema: completeTaskSchema,
      execute: async (params) => {
        if (settings.completeTask) {
          await callbacks.onProposeAction("completeTask", params);
          return `Proposed: Mark task as complete. Waiting for user approval.`;
        }
        return await callbacks.onCompleteTask(params);
      },
    }),

    askQuestion: tool({
      description: "Ask the user a clarifying question when requirements are ambiguous or more information is needed. This will pause execution until the user responds.",
      inputSchema: askQuestionSchema,
      execute: async (params) => {
        // askQuestion always triggers user interaction - it pauses execution
        return await callbacks.onAskQuestion(params);
      },
    }),
  };
}

// Get schema for an action type (returns Zod schema)
export function getSchemaForActionType(actionType: AgentAction["actionType"]) {
  switch (actionType) {
    case "readFile":
      return readFileSchema;
    case "writeFile":
      return writeFileSchema;
    case "editFile":
      return editFileSchema;
    case "deleteFile":
      return deleteFileSchema;
    case "listDirectory":
      return listDirectorySchema;
    case "executeCommand":
      return executeCommandSchema;
    case "completeTask":
      return completeTaskSchema;
    case "askQuestion":
      return askQuestionSchema;
    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}
