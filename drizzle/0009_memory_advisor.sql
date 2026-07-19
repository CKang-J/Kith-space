CREATE TABLE `memory_advisor_settings` (
  `agent_id` text PRIMARY KEY NOT NULL REFERENCES `agents`(`id`) ON DELETE cascade,
  `enabled` integer NOT NULL DEFAULT 1 CHECK (`enabled` IN (0, 1)),
  `auto_activate_private` integer NOT NULL DEFAULT 1 CHECK (`auto_activate_private` IN (0, 1)),
  `daily_token_limit` integer NOT NULL DEFAULT 50000 CHECK (`daily_token_limit` >= 0),
  `daily_cost_micros_limit` integer NOT NULL DEFAULT 5000000 CHECK (`daily_cost_micros_limit` >= 0),
  `paused_at` integer,
  `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE TABLE `memory_advisor_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `space_id` text NOT NULL REFERENCES `spaces`(`id`) ON DELETE cascade,
  `agent_id` text NOT NULL REFERENCES `agents`(`id`) ON DELETE cascade,
  `source_turn_id` text NOT NULL REFERENCES `agent_turns`(`id`) ON DELETE cascade,
  `status` text NOT NULL DEFAULT 'queued' CHECK (`status` IN ('queued','running','succeeded','failed','blocked','cancelled')),
  `provider` text NOT NULL, `model` text, `config_digest` text NOT NULL,
  `source_refs_json` text NOT NULL, `attempt_count` integer NOT NULL DEFAULT 0,
  `next_attempt_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `lease_owner` text, `lease_expires_at` integer,
  `error_code` text, `error_detail_redacted` text,
  `candidate_count` integer NOT NULL DEFAULT 0, `validation_json` text, `usage_json` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000), `started_at` integer, `completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_advisor_jobs_agent_turn_uniq` ON `memory_advisor_jobs` (`agent_id`,`source_turn_id`);
--> statement-breakpoint
CREATE INDEX `memory_advisor_jobs_due_idx` ON `memory_advisor_jobs` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `memory_advisor_jobs_agent_status_idx` ON `memory_advisor_jobs` (`agent_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `memory_advisor_proposals` (
  `memory_id` text PRIMARY KEY NOT NULL REFERENCES `episodic_memories`(`id`) ON DELETE cascade,
  `job_id` text REFERENCES `memory_advisor_jobs`(`id`) ON DELETE set null,
  `validation_json` text NOT NULL, `provider_config_digest` text NOT NULL,
  `decision` text NOT NULL DEFAULT 'pending' CHECK (`decision` IN ('pending','accepted','rejected')),
  `decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `memory_advisor_proposals_job_idx` ON `memory_advisor_proposals` (`job_id`,`decision`);
--> statement-breakpoint
CREATE TABLE `memory_recall_observations` (
  `memory_id` text NOT NULL REFERENCES `episodic_memories`(`id`) ON DELETE cascade,
  `agent_id` text NOT NULL REFERENCES `agents`(`id`) ON DELETE cascade,
  `target_surface_id` text REFERENCES `channels`(`id`) ON DELETE set null,
  `projection` text NOT NULL, `reasons_json` text NOT NULL, `score_breakdown_json` text NOT NULL,
  `recalled_at` integer NOT NULL,
  PRIMARY KEY (`memory_id`,`agent_id`)
);
--> statement-breakpoint
CREATE INDEX `memory_recall_observations_agent_idx` ON `memory_recall_observations` (`agent_id`,`recalled_at`);
--> statement-breakpoint
ALTER TABLE `runtime_sessions` ADD COLUMN `checklist_revision` integer NOT NULL DEFAULT 0 CHECK (`checklist_revision` >= 0);
--> statement-breakpoint
ALTER TABLE `runtime_sessions` ADD COLUMN `compaction_revision` integer NOT NULL DEFAULT 0 CHECK (`compaction_revision` >= 0);
--> statement-breakpoint
ALTER TABLE `runtime_sessions` ADD COLUMN `context_compaction_revision` integer NOT NULL DEFAULT 0 CHECK (`context_compaction_revision` >= 0);
--> statement-breakpoint
PRAGMA user_version = 8;
