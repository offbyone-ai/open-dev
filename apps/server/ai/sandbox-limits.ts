import type { SandboxLimits, SandboxUsage } from "@open-dev/shared";

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  maxExecutionTimeSeconds: 300, // 5 minutes
  maxTokens: 100000,            // 100k tokens
  maxFileOperations: 50,        // 50 file operations
  maxCommands: 10,              // 10 shell commands
  maxFileSizeBytes: 1048576,    // 1MB
  maxSteps: 20,                 // 20 AI interaction rounds
};

export class LimitExceededError extends Error {
  constructor(
    public readonly limitType: keyof SandboxLimits,
    public readonly limitValue: number,
    public readonly currentValue: number,
    message: string
  ) {
    super(message);
    this.name = "LimitExceededError";
  }
}

/**
 * Tracks resource usage during agent execution and enforces sandbox limits.
 * Prevents runaway agent execution and controls API costs.
 */
export class SandboxLimitsTracker {
  private usage: SandboxUsage;
  private limits: SandboxLimits;

  constructor(limits?: Partial<SandboxLimits>) {
    this.limits = { ...DEFAULT_SANDBOX_LIMITS, ...limits };
    this.usage = {
      executionStartTime: Date.now(),
      tokensUsed: 0,
      fileOperationsCount: 0,
      commandsCount: 0,
      stepsCount: 0,
    };
  }

  /**
   * Get the current limits configuration
   */
  getLimits(): SandboxLimits {
    return { ...this.limits };
  }

  /**
   * Get the current usage statistics
   */
  getUsage(): SandboxUsage {
    return { ...this.usage };
  }

  /**
   * Get the elapsed execution time in seconds
   */
  getElapsedTimeSeconds(): number {
    return (Date.now() - this.usage.executionStartTime) / 1000;
  }

  /**
   * Check if execution time limit is exceeded
   */
  checkTimeLimit(): void {
    if (this.limits.maxExecutionTimeSeconds <= 0) return;

    const elapsedSeconds = this.getElapsedTimeSeconds();
    if (elapsedSeconds >= this.limits.maxExecutionTimeSeconds) {
      throw new LimitExceededError(
        "maxExecutionTimeSeconds",
        this.limits.maxExecutionTimeSeconds,
        Math.round(elapsedSeconds),
        `Execution time limit exceeded: ${Math.round(elapsedSeconds)}s / ${this.limits.maxExecutionTimeSeconds}s`
      );
    }
  }

  /**
   * Track and validate token usage
   */
  trackTokens(inputTokens: number, outputTokens: number): void {
    const totalTokens = inputTokens + outputTokens;
    this.usage.tokensUsed += totalTokens;

    if (this.limits.maxTokens <= 0) return;

    if (this.usage.tokensUsed > this.limits.maxTokens) {
      throw new LimitExceededError(
        "maxTokens",
        this.limits.maxTokens,
        this.usage.tokensUsed,
        `Token budget exceeded: ${this.usage.tokensUsed} / ${this.limits.maxTokens} tokens`
      );
    }
  }

  /**
   * Track and validate file operations (read, write, edit, delete)
   */
  trackFileOperation(): void {
    this.usage.fileOperationsCount++;

    if (this.limits.maxFileOperations <= 0) return;

    if (this.usage.fileOperationsCount > this.limits.maxFileOperations) {
      throw new LimitExceededError(
        "maxFileOperations",
        this.limits.maxFileOperations,
        this.usage.fileOperationsCount,
        `File operation limit exceeded: ${this.usage.fileOperationsCount} / ${this.limits.maxFileOperations} operations`
      );
    }
  }

  /**
   * Track and validate shell command execution
   */
  trackCommand(): void {
    this.usage.commandsCount++;

    if (this.limits.maxCommands <= 0) return;

    if (this.usage.commandsCount > this.limits.maxCommands) {
      throw new LimitExceededError(
        "maxCommands",
        this.limits.maxCommands,
        this.usage.commandsCount,
        `Command limit exceeded: ${this.usage.commandsCount} / ${this.limits.maxCommands} commands`
      );
    }
  }

  /**
   * Validate file size for write operations
   */
  validateFileSize(contentLength: number): void {
    if (this.limits.maxFileSizeBytes <= 0) return;

    if (contentLength > this.limits.maxFileSizeBytes) {
      throw new LimitExceededError(
        "maxFileSizeBytes",
        this.limits.maxFileSizeBytes,
        contentLength,
        `File size limit exceeded: ${contentLength} / ${this.limits.maxFileSizeBytes} bytes`
      );
    }
  }

  /**
   * Track and validate AI interaction steps
   */
  trackStep(): void {
    this.usage.stepsCount++;

    if (this.limits.maxSteps <= 0) return;

    if (this.usage.stepsCount > this.limits.maxSteps) {
      throw new LimitExceededError(
        "maxSteps",
        this.limits.maxSteps,
        this.usage.stepsCount,
        `Step limit exceeded: ${this.usage.stepsCount} / ${this.limits.maxSteps} steps`
      );
    }
  }

  /**
   * Perform all time-based checks (should be called periodically)
   */
  checkAllLimits(): void {
    this.checkTimeLimit();
  }

  /**
   * Get a summary of current usage vs limits for reporting
   */
  getUsageSummary(): {
    elapsedTimeSeconds: number;
    tokensUsed: number;
    fileOperationsCount: number;
    commandsCount: number;
    stepsCount: number;
    limits: SandboxLimits;
    percentages: {
      time: number;
      tokens: number;
      fileOperations: number;
      commands: number;
      steps: number;
    };
  } {
    const elapsedTimeSeconds = this.getElapsedTimeSeconds();

    return {
      elapsedTimeSeconds: Math.round(elapsedTimeSeconds),
      tokensUsed: this.usage.tokensUsed,
      fileOperationsCount: this.usage.fileOperationsCount,
      commandsCount: this.usage.commandsCount,
      stepsCount: this.usage.stepsCount,
      limits: this.limits,
      percentages: {
        time: this.limits.maxExecutionTimeSeconds > 0
          ? Math.round((elapsedTimeSeconds / this.limits.maxExecutionTimeSeconds) * 100)
          : 0,
        tokens: this.limits.maxTokens > 0
          ? Math.round((this.usage.tokensUsed / this.limits.maxTokens) * 100)
          : 0,
        fileOperations: this.limits.maxFileOperations > 0
          ? Math.round((this.usage.fileOperationsCount / this.limits.maxFileOperations) * 100)
          : 0,
        commands: this.limits.maxCommands > 0
          ? Math.round((this.usage.commandsCount / this.limits.maxCommands) * 100)
          : 0,
        steps: this.limits.maxSteps > 0
          ? Math.round((this.usage.stepsCount / this.limits.maxSteps) * 100)
          : 0,
      },
    };
  }
}
