CREATE TABLE `agent_harness_state` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'legacy' NOT NULL,
	`cutover_at` integer,
	`rollback_until` integer,
	`migration_audit_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_harness_state_mode_check" CHECK("agent_harness_state"."mode" in ('legacy', 'migrating', 'v2'))
);
--> statement-breakpoint
CREATE TABLE `runtime_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`surface_kind` text NOT NULL,
	`surface_id` text NOT NULL,
	`session_generation` integer NOT NULL,
	`runtime` text NOT NULL,
	`model` text,
	`runtime_config_fingerprint` text NOT NULL,
	`adapter_version` text NOT NULL,
	`engine_session_id` text,
	`engine_host_fingerprint` text,
	`workspace_root_fingerprint` text NOT NULL,
	`status` text DEFAULT 'cold' NOT NULL,
	`last_turn_id` text,
	`last_active_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_compacted_at` integer,
	`retired_at` integer,
	`snapshot_version` integer DEFAULT 0 NOT NULL,
	`snapshot_json` text,
	`snapshot_checksum` text,
	`snapshot_saved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "runtime_sessions_generation_check" CHECK("runtime_sessions"."session_generation" > 0),
	CONSTRAINT "runtime_sessions_status_check" CHECK("runtime_sessions"."status" in ('cold', 'starting', 'idle', 'running', 'evicted', 'resume_failed', 'disabled')),
	CONSTRAINT "runtime_sessions_snapshot_version_check" CHECK("runtime_sessions"."snapshot_version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_sessions_generation_uniq` ON `runtime_sessions` (`space_id`,`agent_id`,`surface_kind`,`surface_id`,`session_generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_sessions_current_uniq` ON `runtime_sessions` (`space_id`,`agent_id`,`surface_kind`,`surface_id`) WHERE "runtime_sessions"."retired_at" is null;--> statement-breakpoint
CREATE INDEX `runtime_sessions_agent_status_idx` ON `runtime_sessions` (`agent_id`,`status`,`last_active_at`);--> statement-breakpoint
INSERT INTO `agent_harness_state` (`agent_id`, `mode`, `migration_audit_json`)
SELECT `id`, 'legacy', json_object('source', 'workspace-v5', 'legacySessionPreserved', `session_id` IS NOT NULL)
FROM `agents`;--> statement-breakpoint
PRAGMA user_version = 6;
