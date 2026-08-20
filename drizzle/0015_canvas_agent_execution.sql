ALTER TABLE `message_execution_bindings` ADD `binding_source` text DEFAULT 'explicit_picker' NOT NULL;
--> statement-breakpoint
CREATE TABLE `canvas_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`message_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`executor_agent_id` text NOT NULL,
	`canvas_id` text NOT NULL,
	`object_scope_json` text NOT NULL,
	`actions_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `canvas_selection_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_id`) REFERENCES `agent_delivery_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`executor_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_access_grants_turn_snapshot_uniq` ON `canvas_access_grants` (`turn_id`,`snapshot_id`);
--> statement-breakpoint
CREATE INDEX `canvas_access_grants_turn_idx` ON `canvas_access_grants` (`turn_id`,`executor_agent_id`);
--> statement-breakpoint
CREATE INDEX `canvas_access_grants_delivery_idx` ON `canvas_access_grants` (`delivery_id`);
--> statement-breakpoint
CREATE TABLE `turn_output_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`output_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`kind` text NOT NULL,
	`artifact_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`output_id`) REFERENCES `turn_outputs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_output_artifacts_output_kind_artifact_uniq` ON `turn_output_artifacts` (`output_id`,`kind`,`artifact_id`);
--> statement-breakpoint
CREATE INDEX `turn_output_artifacts_artifact_idx` ON `turn_output_artifacts` (`kind`,`artifact_id`);
--> statement-breakpoint
PRAGMA user_version = 14;
