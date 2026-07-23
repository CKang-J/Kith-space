ALTER TABLE `memory_advisor_settings` ADD COLUMN `approved_provider_revision` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `approved_model_profile_revision` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `approved_provider_epoch` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `approved_egress_digest` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `consent_epoch` integer NOT NULL DEFAULT 0 CHECK (`consent_epoch` >= 0);
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `consent_purpose` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `consent_source_scope_json` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `consent_at` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `consent_actor_id` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `installation_identity_digest` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_settings` ADD COLUMN `provider_epoch_mirror` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `provider_revision` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `model_profile_revision` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `provider_epoch` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `installation_identity_digest` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `execution_snapshot_json` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `execution_snapshot_digest` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `capability_digest` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `policy_version` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `agent_consent_epoch` integer;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `source_scope_digest` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `provider_run_id` text;
--> statement-breakpoint
ALTER TABLE `memory_advisor_jobs` ADD COLUMN `worker_generation` integer;
--> statement-breakpoint
CREATE TABLE `advisor_provider_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `space_id` text NOT NULL REFERENCES `spaces`(`id`) ON DELETE cascade,
  `agent_id` text NOT NULL REFERENCES `agents`(`id`) ON DELETE cascade,
  `status` text NOT NULL CHECK (`status` IN ('leased','running','succeeded','failed','blocked','cancelled')),
  `provider_revision` integer NOT NULL,
  `model_profile_revision` integer NOT NULL,
  `provider_epoch` integer NOT NULL,
  `consent_epoch` integer NOT NULL,
  `installation_identity_digest` text NOT NULL,
  `execution_snapshot_digest` text NOT NULL,
  `egress_plan_json` text,
  `egress_digest` text NOT NULL,
  `policy_version` integer NOT NULL,
  `worker_generation` integer,
  `batch_job_ids_json` text NOT NULL,
  `usage_json` text,
  `latency_ms` integer,
  `error_code` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `started_at` integer,
  `completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `advisor_provider_runs_status_idx` ON `advisor_provider_runs` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `advisor_provider_runs_agent_idx` ON `advisor_provider_runs` (`agent_id`,`created_at`);
--> statement-breakpoint
PRAGMA user_version = 9;
