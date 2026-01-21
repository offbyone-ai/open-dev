/**
 * GitHub API Client
 *
 * A lightweight client for interacting with GitHub's REST API.
 * Handles authentication, rate limiting, and common operations.
 */

import type {
  GitHubIssue,
  GitHubIssueState,
  GitHubConnectionTestResult,
} from "@open-dev/shared";

export interface GitHubClientOptions {
  accessToken: string;
  owner: string;
  repo: string;
}

export interface CreateIssueParams {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface UpdateIssueParams {
  title?: string;
  body?: string;
  state?: GitHubIssueState;
  labels?: string[];
  assignees?: string[];
}

export interface ListIssuesParams {
  state?: GitHubIssueState | "all";
  labels?: string;
  sort?: "created" | "updated" | "comments";
  direction?: "asc" | "desc";
  per_page?: number;
  page?: number;
  since?: string; // ISO 8601 timestamp
}

export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  used: number;
}

export class GitHubAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = "GitHubAPIError";
  }
}

export class GitHubRateLimitError extends GitHubAPIError {
  constructor(
    public rateLimit: GitHubRateLimit,
    public resetAt: Date
  ) {
    super(
      `GitHub API rate limit exceeded. Resets at ${resetAt.toISOString()}`,
      403
    );
    this.name = "GitHubRateLimitError";
  }
}

export class GitHubClient {
  private baseUrl = "https://api.github.com";
  private accessToken: string;
  private owner: string;
  private repo: string;
  private rateLimit: GitHubRateLimit | null = null;

  constructor(options: GitHubClientOptions) {
    this.accessToken = options.accessToken;
    this.owner = options.owner;
    this.repo = options.repo;
  }

  /**
   * Make an authenticated request to the GitHub API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Update rate limit info from headers
    this.updateRateLimit(response.headers);

    // Handle rate limiting
    if (response.status === 403 && this.rateLimit?.remaining === 0) {
      throw new GitHubRateLimitError(
        this.rateLimit,
        new Date(this.rateLimit.reset * 1000)
      );
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new GitHubAPIError(
        errorBody?.message || `GitHub API error: ${response.status}`,
        response.status,
        errorBody
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Update rate limit info from response headers
   */
  private updateRateLimit(headers: Headers): void {
    const limit = headers.get("x-ratelimit-limit");
    const remaining = headers.get("x-ratelimit-remaining");
    const reset = headers.get("x-ratelimit-reset");
    const used = headers.get("x-ratelimit-used");

    if (limit && remaining && reset && used) {
      this.rateLimit = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: parseInt(reset, 10),
        used: parseInt(used, 10),
      };
    }
  }

  /**
   * Get current rate limit info
   */
  getRateLimit(): GitHubRateLimit | null {
    return this.rateLimit;
  }

  /**
   * Test the connection to the repository
   */
  async testConnection(): Promise<GitHubConnectionTestResult> {
    try {
      const repo = await this.request<{
        name: string;
        full_name: string;
        private: boolean;
        open_issues_count: number;
      }>("GET", `/repos/${this.owner}/${this.repo}`);

      return {
        success: true,
        repository: {
          name: repo.name,
          full_name: repo.full_name,
          private: repo.private,
          open_issues_count: repo.open_issues_count,
        },
      };
    } catch (error) {
      if (error instanceof GitHubAPIError) {
        return {
          success: false,
          error:
            error.status === 404
              ? "Repository not found or access denied"
              : error.message,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * List issues from the repository
   */
  async listIssues(params: ListIssuesParams = {}): Promise<GitHubIssue[]> {
    const searchParams = new URLSearchParams();

    if (params.state) searchParams.set("state", params.state);
    if (params.labels) searchParams.set("labels", params.labels);
    if (params.sort) searchParams.set("sort", params.sort);
    if (params.direction) searchParams.set("direction", params.direction);
    if (params.per_page) searchParams.set("per_page", params.per_page.toString());
    if (params.page) searchParams.set("page", params.page.toString());
    if (params.since) searchParams.set("since", params.since);

    // Filter out pull requests (they're also returned in issues endpoint)
    const queryString = searchParams.toString();
    const path = `/repos/${this.owner}/${this.repo}/issues${queryString ? `?${queryString}` : ""}`;

    const issues = await this.request<GitHubIssue[]>("GET", path);

    // Filter out pull requests (they have a pull_request property)
    return issues.filter((issue) => !("pull_request" in issue));
  }

  /**
   * Get all issues with pagination
   */
  async listAllIssues(params: Omit<ListIssuesParams, "page" | "per_page"> = {}): Promise<GitHubIssue[]> {
    const allIssues: GitHubIssue[] = [];
    let page = 1;
    const perPage = 100; // Maximum allowed by GitHub

    while (true) {
      const issues = await this.listIssues({
        ...params,
        page,
        per_page: perPage,
      });

      allIssues.push(...issues);

      // If we got fewer issues than the page size, we've reached the end
      if (issues.length < perPage) {
        break;
      }

      page++;
    }

    return allIssues;
  }

  /**
   * Get a single issue by number
   */
  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(
      "GET",
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`
    );
  }

  /**
   * Create a new issue
   */
  async createIssue(params: CreateIssueParams): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(
      "POST",
      `/repos/${this.owner}/${this.repo}/issues`,
      params
    );
  }

  /**
   * Update an existing issue
   */
  async updateIssue(
    issueNumber: number,
    params: UpdateIssueParams
  ): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(
      "PATCH",
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      params
    );
  }

  /**
   * Close an issue
   */
  async closeIssue(issueNumber: number): Promise<GitHubIssue> {
    return this.updateIssue(issueNumber, { state: "closed" });
  }

  /**
   * Reopen an issue
   */
  async reopenIssue(issueNumber: number): Promise<GitHubIssue> {
    return this.updateIssue(issueNumber, { state: "open" });
  }

  /**
   * Add a comment to an issue
   */
  async addComment(
    issueNumber: number,
    body: string
  ): Promise<{ id: number; body: string; html_url: string }> {
    return this.request(
      "POST",
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`,
      { body }
    );
  }

  /**
   * Add labels to an issue
   */
  async addLabels(
    issueNumber: number,
    labels: string[]
  ): Promise<Array<{ id: number; name: string; color: string }>> {
    return this.request(
      "POST",
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/labels`,
      { labels }
    );
  }

  /**
   * Remove a label from an issue
   */
  async removeLabel(issueNumber: number, label: string): Promise<void> {
    return this.request(
      "DELETE",
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`
    );
  }
}

/**
 * Create a GitHub client from integration settings
 */
export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  return new GitHubClient(options);
}
