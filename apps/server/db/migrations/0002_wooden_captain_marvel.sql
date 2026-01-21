CREATE TABLE `agent_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`action_type` text NOT NULL,
	`action_params` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`result` text,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `agent_executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`question` text NOT NULL,
	`context` text,
	`response` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `agent_executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `github_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`access_token` text,
	`webhook_secret` text,
	`enabled` integer DEFAULT true NOT NULL,
	`sync_direction` text DEFAULT 'bidirectional' NOT NULL,
	`auto_sync` integer DEFAULT false NOT NULL,
	`last_sync_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `github_issue_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`github_issue_number` integer NOT NULL,
	`github_issue_id` integer NOT NULL,
	`github_issue_url` text NOT NULL,
	`last_local_status` text,
	`last_github_state` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`integration_id`) REFERENCES `github_integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `github_sync_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text NOT NULL,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`details` text,
	`error_message` text,
	`items_processed` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `github_integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`acceptance_criteria` text,
	`default_priority` text DEFAULT 'medium' NOT NULL,
	`category` text,
	`project_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `working_directory` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `working_directory_confirmed` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `projects` ADD `tool_approval_settings` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `sandbox_limits` text;