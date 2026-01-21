import * as path from "path";
import type { FSWatcher } from "fs";

export interface FileChangeEvent {
  type: "create" | "modify" | "delete";
  path: string;
  relativePath: string;
  timestamp: number;
}

export interface FileWatcherOptions {
  debounceMs?: number;
  ignorePatterns?: string[];
  maxEventsPerSecond?: number;
}

const DEFAULT_OPTIONS: Required<FileWatcherOptions> = {
  debounceMs: 100,
  ignorePatterns: [
    "node_modules",
    ".git",
    ".DS_Store",
    "*.log",
    "*.lock",
    ".turbo",
    "dist",
    "build",
    ".next",
    ".cache",
    "coverage",
  ],
  maxEventsPerSecond: 50,
};

type EventCallback = (event: FileChangeEvent) => void;

interface PendingEvent {
  event: FileChangeEvent;
  timer: ReturnType<typeof setTimeout>;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private workingDirectory: string;
  private options: Required<FileWatcherOptions>;
  private callbacks: Set<EventCallback> = new Set();
  private pendingEvents: Map<string, PendingEvent> = new Map();
  private eventCount = 0;
  private eventCountResetTimer: ReturnType<typeof setTimeout> | null = null;
  private isWatching = false;

  constructor(workingDirectory: string, options: FileWatcherOptions = {}) {
    this.workingDirectory = path.resolve(workingDirectory);
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private shouldIgnore(filePath: string): boolean {
    const relativePath = path.relative(this.workingDirectory, filePath);
    const pathParts = relativePath.split(path.sep);
    const fileName = pathParts[pathParts.length - 1] || "";

    for (const pattern of this.options.ignorePatterns) {
      // Check directory patterns (no wildcards)
      if (!pattern.includes("*")) {
        if (pathParts.some((part) => part === pattern)) {
          return true;
        }
      } else {
        // Handle glob patterns like *.log
        // First escape special regex chars except *, then replace * with .*
        const escapedPattern = pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*");
        const regex = new RegExp("^" + escapedPattern + "$");

        // Match against the filename (for patterns like *.log)
        if (regex.test(fileName)) {
          return true;
        }
        // Also match against any path part (for patterns like *test*)
        if (pathParts.some((part) => regex.test(part))) {
          return true;
        }
      }
    }

    return false;
  }

  private emitEvent(event: FileChangeEvent): void {
    // Rate limiting
    if (this.eventCount >= this.options.maxEventsPerSecond) {
      return;
    }

    this.eventCount++;
    if (!this.eventCountResetTimer) {
      this.eventCountResetTimer = setTimeout(() => {
        this.eventCount = 0;
        this.eventCountResetTimer = null;
      }, 1000);
    }

    // Notify all callbacks
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("[FileWatcher] Callback error:", error);
      }
    }
  }

  private handleChange(eventType: string, filename: string | null): void {
    if (!filename) return;

    const fullPath = path.join(this.workingDirectory, filename);

    if (this.shouldIgnore(fullPath)) {
      return;
    }

    const relativePath = path.relative(this.workingDirectory, fullPath);

    // Determine event type
    const checkFileExists = async () => {
      try {
        const file = Bun.file(fullPath);
        return await file.exists();
      } catch {
        return false;
      }
    };

    // Cancel any pending event for this path
    const pendingKey = fullPath;
    const pending = this.pendingEvents.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingEvents.delete(pendingKey);
    }

    // Debounce the event
    const timer = setTimeout(async () => {
      this.pendingEvents.delete(pendingKey);

      const exists = await checkFileExists();
      const type: FileChangeEvent["type"] = exists
        ? eventType === "rename"
          ? "create"
          : "modify"
        : "delete";

      const event: FileChangeEvent = {
        type,
        path: fullPath,
        relativePath,
        timestamp: Date.now(),
      };

      this.emitEvent(event);
    }, this.options.debounceMs);

    // Placeholder event for debouncing
    this.pendingEvents.set(pendingKey, {
      event: {
        type: "modify",
        path: fullPath,
        relativePath,
        timestamp: Date.now(),
      },
      timer,
    });
  }

  async start(): Promise<void> {
    if (this.isWatching) {
      console.log("[FileWatcher] Already watching:", this.workingDirectory);
      return;
    }

    // Verify directory exists
    try {
      const glob = new Bun.Glob("*");
      for await (const _ of glob.scan({ cwd: this.workingDirectory, onlyFiles: false })) {
        break;
      }
    } catch (error) {
      throw new Error(`Cannot watch directory: ${this.workingDirectory}`);
    }

    // Use Node.js fs.watch for file system watching
    const { watch } = await import("fs");

    this.watcher = watch(
      this.workingDirectory,
      { recursive: true },
      (eventType, filename) => {
        this.handleChange(eventType, filename);
      }
    );

    this.watcher.on("error", (error) => {
      console.error("[FileWatcher] Watch error:", error);
    });

    this.isWatching = true;
    console.log("[FileWatcher] Started watching:", this.workingDirectory);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear all pending events
    for (const pending of this.pendingEvents.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingEvents.clear();

    if (this.eventCountResetTimer) {
      clearTimeout(this.eventCountResetTimer);
      this.eventCountResetTimer = null;
    }

    this.isWatching = false;
    console.log("[FileWatcher] Stopped watching:", this.workingDirectory);
  }

  subscribe(callback: EventCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  isActive(): boolean {
    return this.isWatching;
  }
}

// Global file watcher registry - manages watchers per project
class FileWatcherRegistry {
  private watchers: Map<string, FileWatcher> = new Map();

  getOrCreate(projectId: string, workingDirectory: string, options?: FileWatcherOptions): FileWatcher {
    const existing = this.watchers.get(projectId);

    // If watcher exists and is watching the same directory, return it
    if (existing && existing.getWorkingDirectory() === path.resolve(workingDirectory)) {
      return existing;
    }

    // If watcher exists but for a different directory, stop it
    if (existing) {
      existing.stop();
    }

    // Create new watcher
    const watcher = new FileWatcher(workingDirectory, options);
    this.watchers.set(projectId, watcher);
    return watcher;
  }

  get(projectId: string): FileWatcher | undefined {
    return this.watchers.get(projectId);
  }

  stop(projectId: string): void {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      watcher.stop();
      this.watchers.delete(projectId);
    }
  }

  stopAll(): void {
    for (const [projectId, watcher] of this.watchers) {
      watcher.stop();
    }
    this.watchers.clear();
  }
}

export const fileWatcherRegistry = new FileWatcherRegistry();
