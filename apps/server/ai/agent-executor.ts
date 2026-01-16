import { $ } from "bun";
import * as path from "path";
import type { ActionParams } from "./agent-tools";

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
}

// Validate that a path stays within the working directory
export function validatePath(workingDirectory: string, relativePath: string): string {
  const absolutePath = path.resolve(workingDirectory, relativePath);
  const normalizedWorkingDir = path.resolve(workingDirectory);

  if (!absolutePath.startsWith(normalizedWorkingDir + path.sep) && absolutePath !== normalizedWorkingDir) {
    throw new Error(`Path "${relativePath}" is outside the working directory`);
  }

  return absolutePath;
}

// Read a file
export async function executeReadFile(
  workingDirectory: string,
  params: ActionParams["readFile"]
): Promise<ExecutionResult> {
  try {
    const absolutePath = validatePath(workingDirectory, params.path);
    const file = Bun.file(absolutePath);

    if (!(await file.exists())) {
      return { success: false, error: `File not found: ${params.path}` };
    }

    const content = await file.text();
    return { success: true, output: content };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// List directory contents
export async function executeListDirectory(
  workingDirectory: string,
  params: ActionParams["listDirectory"]
): Promise<ExecutionResult> {
  try {
    const absolutePath = validatePath(workingDirectory, params.path);
    const entries: string[] = [];

    const glob = new Bun.Glob("*");
    for await (const entry of glob.scan({ cwd: absolutePath, onlyFiles: false })) {
      const entryPath = path.join(absolutePath, entry);
      const stat = await Bun.file(entryPath).exists();

      // Check if it's a directory by trying to list it
      try {
        const testGlob = new Bun.Glob("*");
        const isDir = await (async () => {
          try {
            for await (const _ of testGlob.scan({ cwd: entryPath, onlyFiles: false })) {
              return true;
            }
            return true; // Empty directory
          } catch {
            return false; // Not a directory
          }
        })();
        entries.push(isDir ? `${entry}/` : entry);
      } catch {
        entries.push(entry);
      }
    }

    return { success: true, output: entries.sort().join("\n") || "(empty directory)" };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Write a file
export async function executeWriteFile(
  workingDirectory: string,
  params: ActionParams["writeFile"]
): Promise<ExecutionResult> {
  try {
    const absolutePath = validatePath(workingDirectory, params.path);

    // Ensure parent directory exists
    const parentDir = path.dirname(absolutePath);
    await $`mkdir -p ${parentDir}`.quiet();

    await Bun.write(absolutePath, params.content);
    return { success: true, output: `File written: ${params.path}` };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Edit a file (search and replace)
export async function executeEditFile(
  workingDirectory: string,
  params: ActionParams["editFile"]
): Promise<ExecutionResult> {
  try {
    const absolutePath = validatePath(workingDirectory, params.path);
    const file = Bun.file(absolutePath);

    if (!(await file.exists())) {
      return { success: false, error: `File not found: ${params.path}` };
    }

    const content = await file.text();

    if (!content.includes(params.search)) {
      return { success: false, error: `Search text not found in file: ${params.path}` };
    }

    const newContent = content.replace(params.search, params.replace);
    await Bun.write(absolutePath, newContent);

    return { success: true, output: `File edited: ${params.path}` };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Delete a file
export async function executeDeleteFile(
  workingDirectory: string,
  params: ActionParams["deleteFile"]
): Promise<ExecutionResult> {
  try {
    const absolutePath = validatePath(workingDirectory, params.path);
    const file = Bun.file(absolutePath);

    if (!(await file.exists())) {
      return { success: false, error: `File not found: ${params.path}` };
    }

    await $`rm ${absolutePath}`.quiet();
    return { success: true, output: `File deleted: ${params.path}` };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Execute a shell command
export async function executeCommand(
  workingDirectory: string,
  params: ActionParams["executeCommand"]
): Promise<ExecutionResult> {
  try {
    // Use Bun shell with the working directory set
    const result = await $`cd ${workingDirectory} && ${params.command}`.quiet().nothrow();

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: stderr || `Command exited with code ${result.exitCode}`,
        output: stdout,
      };
    }

    return { success: true, output: stdout || "(no output)" };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Execute an action based on its type
export async function executeAction(
  workingDirectory: string,
  actionType: string,
  params: unknown
): Promise<ExecutionResult> {
  switch (actionType) {
    case "readFile":
      return executeReadFile(workingDirectory, params as ActionParams["readFile"]);
    case "listDirectory":
      return executeListDirectory(workingDirectory, params as ActionParams["listDirectory"]);
    case "writeFile":
      return executeWriteFile(workingDirectory, params as ActionParams["writeFile"]);
    case "editFile":
      return executeEditFile(workingDirectory, params as ActionParams["editFile"]);
    case "deleteFile":
      return executeDeleteFile(workingDirectory, params as ActionParams["deleteFile"]);
    case "executeCommand":
      return executeCommand(workingDirectory, params as ActionParams["executeCommand"]);
    case "completeTask":
      // completeTask doesn't execute anything, just marks as complete
      return { success: true, output: "Task marked as complete" };
    default:
      return { success: false, error: `Unknown action type: ${actionType}` };
  }
}
