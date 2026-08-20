CREATE TABLE `canvas_selection_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`canvas_id` text NOT NULL,
	`message_id` text,
	`document_revision` integer NOT NULL,
	`structure_revision` integer,
	`selected_elements_json` text NOT NULL,
	`selected_frames_json` text NOT NULL,
	`projection_json` text NOT NULL,
	`preview_asset_id` text,
	`selection_hash` text NOT NULL,
	`summary` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preview_asset_id`) REFERENCES `canvas_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `canvas_selection_snapshots_message_idx` ON `canvas_selection_snapshots` (`message_id`);
--> statement-breakpoint
CREATE INDEX `canvas_selection_snapshots_canvas_idx` ON `canvas_selection_snapshots` (`canvas_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `message_execution_bindings` (
	`message_id` text PRIMARY KEY NOT NULL,
	`executor_agent_id` text NOT NULL,
	`mode` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`executor_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_execution_bindings_executor_idx` ON `message_execution_bindings` (`executor_agent_id`);
--> statement-breakpoint
PRAGMA user_version = 13;
