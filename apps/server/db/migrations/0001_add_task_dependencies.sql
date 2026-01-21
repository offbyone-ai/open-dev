-- Add depends_on column to tasks table
ALTER TABLE `tasks` ADD COLUMN `depends_on` text DEFAULT '[]' NOT NULL;
