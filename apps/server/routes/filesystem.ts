import * as path from "path";
import * as os from "os";
import type { Session } from "../auth";

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

// Get home directory and common starting points
export function getStartingPaths(): { name: string; path: string }[] {
  const home = os.homedir();
  return [
    { name: "Home", path: home },
    { name: "Desktop", path: path.join(home, "Desktop") },
    { name: "Documents", path: path.join(home, "Documents") },
    { name: "Projects", path: path.join(home, "Projects") },
    { name: "Code", path: path.join(home, "Code") },
    { name: "Developer", path: path.join(home, "Developer") },
    { name: "git", path: path.join(home, "git") },
  ].filter((p) => {
    try {
      // Check if path exists
      const file = Bun.file(p.path);
      return true; // Will check in browse if it's actually a directory
    } catch {
      return false;
    }
  });
}

// Browse a directory and return its contents
export async function browseDirectory(dirPath: string): Promise<{
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
}> {
  const normalizedPath = path.resolve(dirPath);
  const parentPath = path.dirname(normalizedPath);

  const entries: DirectoryEntry[] = [];

  try {
    const glob = new Bun.Glob("*");

    for await (const entry of glob.scan({ cwd: normalizedPath, onlyFiles: false })) {
      // Skip hidden files/directories
      if (entry.startsWith(".")) continue;

      const fullPath = path.join(normalizedPath, entry);

      // Check if it's a directory
      let isDirectory = false;
      try {
        const testGlob = new Bun.Glob("*");
        for await (const _ of testGlob.scan({ cwd: fullPath, onlyFiles: false })) {
          isDirectory = true;
          break;
        }
        // Empty directory is still a directory
        if (!isDirectory) {
          // Try to check if it's a file by reading it
          const file = Bun.file(fullPath);
          const exists = await file.exists();
          if (exists) {
            // It exists but glob didn't find children, could be empty dir or file
            // Try to get size - files have size, dirs don't work the same way
            try {
              const size = file.size;
              isDirectory = false; // It's a file
            } catch {
              isDirectory = true; // Probably a directory
            }
          }
        }
      } catch {
        // If we can't scan it, assume it's a file
        isDirectory = false;
      }

      // Only include directories for navigation
      if (isDirectory) {
        entries.push({
          name: entry,
          path: fullPath,
          isDirectory: true,
        });
      }
    }

    // Sort directories alphabetically
    entries.sort((a, b) => a.name.localeCompare(b.name));

    return {
      currentPath: normalizedPath,
      parentPath: parentPath !== normalizedPath ? parentPath : null,
      entries,
    };
  } catch (error) {
    throw new Error(`Cannot access directory: ${dirPath}`);
  }
}

// Validate that a path exists and is a directory
export async function validateDirectory(dirPath: string): Promise<boolean> {
  try {
    const normalizedPath = path.resolve(dirPath);
    const glob = new Bun.Glob("*");

    // Try to scan - if it works, it's a valid directory
    for await (const _ of glob.scan({ cwd: normalizedPath, onlyFiles: false })) {
      return true;
    }
    // Empty directory is still valid
    return true;
  } catch {
    return false;
  }
}

// Create a new directory
export async function createDirectory(dirPath: string): Promise<{ success: boolean; path: string }> {
  try {
    const normalizedPath = path.resolve(dirPath);

    // Check if it already exists
    const exists = await validateDirectory(normalizedPath);
    if (exists) {
      return { success: true, path: normalizedPath };
    }

    // Create the directory
    await Bun.$`mkdir -p ${normalizedPath}`.quiet();

    return { success: true, path: normalizedPath };
  } catch (error) {
    throw new Error(`Failed to create directory: ${error}`);
  }
}

export function handleFilesystemRoutes(req: Request, session: Session): Promise<Response> | null {
  const url = new URL(req.url);
  const urlPath = url.pathname;
  const method = req.method;

  // GET /api/filesystem/starting-paths
  if (urlPath === "/api/filesystem/starting-paths" && method === "GET") {
    return Promise.resolve(Response.json(getStartingPaths()));
  }

  // GET /api/filesystem/browse?path=...
  if (urlPath === "/api/filesystem/browse" && method === "GET") {
    const dirPath = url.searchParams.get("path");
    if (!dirPath) {
      return Promise.resolve(
        Response.json({ error: "Path parameter required" }, { status: 400 })
      );
    }

    return browseDirectory(dirPath)
      .then((result) => Response.json(result))
      .catch((err) =>
        Response.json({ error: err.message }, { status: 400 })
      );
  }

  // GET /api/filesystem/validate?path=...
  if (urlPath === "/api/filesystem/validate" && method === "GET") {
    const dirPath = url.searchParams.get("path");
    if (!dirPath) {
      return Promise.resolve(
        Response.json({ error: "Path parameter required" }, { status: 400 })
      );
    }

    return validateDirectory(dirPath)
      .then((valid) => Response.json({ valid, path: dirPath }))
      .catch(() => Response.json({ valid: false, path: dirPath }));
  }

  // POST /api/filesystem/create-directory
  if (urlPath === "/api/filesystem/create-directory" && method === "POST") {
    return req.json().then((data) => {
      if (!data.path) {
        return Response.json({ error: "Path parameter required" }, { status: 400 });
      }

      return createDirectory(data.path)
        .then((result) => Response.json(result))
        .catch((err) =>
          Response.json({ error: err.message }, { status: 400 })
        );
    });
  }

  return null;
}
