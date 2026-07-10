CREATE TABLE `dispatch_chains` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`root_message_id` text NOT NULL,
	`task_message_id` text,
	`channel_id` text NOT NULL,
	`wake_count` integer DEFAULT 0 NOT NULL,
	`max_depth_seen` integer DEFAULT 0 NOT NULL,
	`last_rejection_code` text,
	`last_rejection_reason` text,
	`last_rejected_at` integer,
	`last_rejected_message_id` text,
	`last_rejected_agent_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dispatch_chains_server_idx` ON `dispatch_chains` (`server_id`);--> statement-breakpoint
CREATE INDEX `dispatch_chains_task_idx` ON `dispatch_chains` (`task_message_id`);--> statement-breakpoint
CREATE TABLE `dispatch_contexts` (
	`server_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`dispatch_depth` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`server_id`, `agent_id`, `channel_id`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chain_id`) REFERENCES `dispatch_chains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dispatch_contexts_chain_idx` ON `dispatch_contexts` (`chain_id`);--> statement-breakpoint
CREATE TABLE `dispatch_stops` (
	`server_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`reason` text,
	`stopped_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`server_id`, `scope_type`, `scope_id`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dispatch_wakes` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`message_id` text NOT NULL,
	`target_agent_id` text NOT NULL,
	`dispatch_depth` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chain_id`) REFERENCES `dispatch_chains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dispatch_wakes_chain_idx` ON `dispatch_wakes` (`chain_id`);--> statement-breakpoint
CREATE INDEX `dispatch_wakes_agent_idx` ON `dispatch_wakes` (`target_agent_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `task_execution_mode` text DEFAULT 'autopilot' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `dispatch_chain_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `dispatch_depth` integer;