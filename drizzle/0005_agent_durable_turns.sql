CREATE TABLE `agent_delivery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`message_id` text NOT NULL,
	`source_channel_id` text NOT NULL,
	`source_seq` integer NOT NULL,
	`cursor_owner_channel_id` text NOT NULL,
	`target_surface_kind` text NOT NULL,
	`target_surface_id` text NOT NULL,
	`target_runtime_session_id` text,
	`directive` text NOT NULL,
	`reason` text NOT NULL,
	`policy_snapshot_json` text NOT NULL,
	`disposition` text DEFAULT 'pending' NOT NULL,
	`turn_id` text,
	`dispatch_wake_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cursor_owner_channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_runtime_session_id`) REFERENCES `runtime_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dispatch_wake_id`) REFERENCES `dispatch_wakes`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_delivery_items_directive_check" CHECK("agent_delivery_items"."directive" in ('required', 'optional', 'observe')),
	CONSTRAINT "agent_delivery_items_disposition_check" CHECK("agent_delivery_items"."disposition" in ('pending', 'bound', 'observed', 'replied', 'ceded', 'dispatch_blocked', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_delivery_items_agent_message_uniq` ON `agent_delivery_items` (`agent_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `agent_delivery_items_agent_disposition_seq_idx` ON `agent_delivery_items` (`agent_id`,`disposition`,`source_seq`);--> statement-breakpoint
CREATE INDEX `agent_delivery_items_cursor_owner_seq_idx` ON `agent_delivery_items` (`cursor_owner_channel_id`,`agent_id`,`source_seq`);--> statement-breakpoint
CREATE INDEX `agent_delivery_items_turn_idx` ON `agent_delivery_items` (`turn_id`);--> statement-breakpoint
CREATE TABLE `agent_turn_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`status` text NOT NULL,
	`worker_generation` integer NOT NULL,
	`lease_owner` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`heartbeat_at` integer,
	`engine_session_id_before` text,
	`engine_session_id_after` text,
	`usage_json` text,
	`error_code` text,
	`error_detail_redacted` text,
	`event_count` integer DEFAULT 0 NOT NULL,
	`event_payload_bytes` integer DEFAULT 0 NOT NULL,
	`claimed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`admitted_at` integer,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_turn_attempts_status_check" CHECK("agent_turn_attempts"."status" in ('claimed', 'admitted', 'running', 'finalizing', 'succeeded', 'failed', 'cancelled', 'lost'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turn_attempts_turn_no_uniq` ON `agent_turn_attempts` (`turn_id`,`attempt_no`);--> statement-breakpoint
CREATE INDEX `agent_turn_attempts_lease_idx` ON `agent_turn_attempts` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `agent_turn_events` (
	`attempt_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`attempt_id`, `ordinal`),
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_turn_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_turn_events_created_kind_idx` ON `agent_turn_events` (`created_at`,`kind`);--> statement-breakpoint
CREATE TABLE `agent_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`runtime_session_id` text NOT NULL,
	`session_generation` integer NOT NULL,
	`space_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`outcome` text,
	`effective_directive` text NOT NULL,
	`context_envelope_json` text,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_attempt_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`runtime_session_id`) REFERENCES `runtime_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_turns_status_check" CHECK("agent_turns"."status" in ('pending', 'running', 'retry_wait', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "agent_turns_outcome_check" CHECK("agent_turns"."outcome" is null or "agent_turns"."outcome" in ('replied', 'ceded', 'mixed', 'failed', 'cancelled')),
	CONSTRAINT "agent_turns_directive_check" CHECK("agent_turns"."effective_directive" in ('required', 'optional')),
	CONSTRAINT "agent_turns_max_attempts_check" CHECK("agent_turns"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turns_active_session_uniq` ON `agent_turns` (`runtime_session_id`) WHERE "agent_turns"."status" in ('pending', 'running', 'retry_wait');--> statement-breakpoint
CREATE INDEX `agent_turns_schedule_idx` ON `agent_turns` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `agent_turns_session_status_idx` ON `agent_turns` (`runtime_session_id`,`status`);--> statement-breakpoint
CREATE TABLE `disclosure_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`source_refs_json` text NOT NULL,
	`target_surface_id` text NOT NULL,
	`action_digest` text NOT NULL,
	`allowed_projection` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_by` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`runtime_session_id` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`sort_order` integer NOT NULL,
	`source_turn_id` text,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`runtime_session_id`) REFERENCES `runtime_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `session_checklist_items_session_idx` ON `session_checklist_items` (`runtime_session_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `session_wakeups` (
	`id` text PRIMARY KEY NOT NULL,
	`runtime_session_id` text NOT NULL,
	`session_generation` integer NOT NULL,
	`owner_agent_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_turn_id` text,
	`lease_owner` text,
	`lease_expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`fired_at` integer,
	FOREIGN KEY (`runtime_session_id`) REFERENCES `runtime_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_wakeups_session_key_uniq` ON `session_wakeups` (`runtime_session_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `session_wakeups_due_idx` ON `session_wakeups` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `turn_capability_activations` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`session_generation` integer NOT NULL,
	`worker_generation` integer NOT NULL,
	`claims_digest` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`activated_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `agent_turn_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_capability_activations_attempt_uniq` ON `turn_capability_activations` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `turn_context_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_json_redacted` text NOT NULL,
	`payload_hmac` text NOT NULL,
	`retention_class` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `turn_context_snapshots_expiry_idx` ON `turn_context_snapshots` (`expires_at`);--> statement-breakpoint
CREATE TABLE `turn_context_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`phase` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_revision` integer,
	`snapshot_id` text,
	`visibility` text NOT NULL,
	`disclosure_projection` text NOT NULL,
	`injection_mode` text NOT NULL,
	`reason` text NOT NULL,
	`token_estimate` integer NOT NULL,
	`content_hmac` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `turn_context_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_context_sources_phase_ordinal_uniq` ON `turn_context_sources` (`turn_id`,`phase`,`ordinal`);--> statement-breakpoint
CREATE TABLE `turn_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`operation_slot` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_ref_json` text,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_operations_key_uniq` ON `turn_operations` (`turn_id`,`tool_name`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `turn_operations_status_idx` ON `turn_operations` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `turn_output_inputs` (
	`output_id` text NOT NULL,
	`delivery_item_id` text NOT NULL,
	PRIMARY KEY(`output_id`, `delivery_item_id`),
	FOREIGN KEY (`output_id`) REFERENCES `turn_outputs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delivery_item_id`) REFERENCES `agent_delivery_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `turn_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`output_kind` text NOT NULL,
	`message_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_id`) REFERENCES `turn_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `turn_outputs_turn_idx` ON `turn_outputs` (`turn_id`);--> statement-breakpoint
ALTER TABLE `channel_agent_members` ADD `access_kind` text DEFAULT 'member' NOT NULL CHECK (`access_kind` in ('member', 'task_scoped'));--> statement-breakpoint
ALTER TABLE `channel_agent_members` ADD `task_scope_json` text;--> statement-breakpoint
ALTER TABLE `channel_agent_members` ADD `access_expires_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `memory_policy` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `context_snapshot_json` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `produced_by_turn_id` text;--> statement-breakpoint
PRAGMA user_version = 6;
