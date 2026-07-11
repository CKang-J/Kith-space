CREATE TABLE `agent_activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`activity` text,
	`detail` text,
	`text` text,
	`tool_name` text,
	`tool_input` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_agent_idx` ON `agent_activity_log` (`agent_id`,`ts`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`description` text,
	`status` text DEFAULT 'inactive' NOT NULL,
	`activity` text DEFAULT 'offline' NOT NULL,
	`session_id` text,
	`model` text,
	`runtime` text DEFAULT 'claude' NOT NULL,
	`runtime_config` text DEFAULT '{}' NOT NULL,
	`execution_mode` text DEFAULT 'auto' NOT NULL,
	`env_vars` text DEFAULT '{}' NOT NULL,
	`agent_token_hash` text,
	`scopes` text,
	`creator_type` text DEFAULT 'human' NOT NULL,
	`creator_id` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agents_space_idx` ON `agents` (`space_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_name_uniq` ON `agents` (`space_id`,`name`) WHERE "agents"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`channel_id` text,
	`space_id` text NOT NULL,
	`uploader_type` text,
	`uploader_id` text,
	`filename` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`storage_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_channel_idx` ON `attachments` (`channel_id`);--> statement-breakpoint
CREATE INDEX `attachments_id_text_prefix_idx` ON `attachments` (`id`);--> statement-breakpoint
CREATE TABLE `channel_agent_members` (
	`channel_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`last_read_seq` integer DEFAULT 0 NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`channel_id`, `agent_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`parent_message_id` text,
	`last_message_at` integer,
	`archived_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channels_space_idx` ON `channels` (`space_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channels_dm_uniq` ON `channels` (`space_id`,`name`) WHERE "channels"."type" = 'dm';--> statement-breakpoint
CREATE UNIQUE INDEX `channels_thread_uniq` ON `channels` (`space_id`,`parent_message_id`) WHERE "channels"."type" = 'thread';--> statement-breakpoint
CREATE TABLE `dispatch_chains` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
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
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dispatch_chains_space_idx` ON `dispatch_chains` (`space_id`);--> statement-breakpoint
CREATE INDEX `dispatch_chains_task_idx` ON `dispatch_chains` (`task_message_id`);--> statement-breakpoint
CREATE TABLE `dispatch_contexts` (
	`space_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`dispatch_depth` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`space_id`, `agent_id`, `channel_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chain_id`) REFERENCES `dispatch_chains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dispatch_contexts_chain_idx` ON `dispatch_contexts` (`chain_id`);--> statement-breakpoint
CREATE TABLE `dispatch_stops` (
	`space_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`reason` text,
	`stopped_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`space_id`, `scope_type`, `scope_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dispatch_wakes` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`message_id` text NOT NULL,
	`target_agent_id` text NOT NULL,
	`dispatch_depth` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chain_id`) REFERENCES `dispatch_chains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dispatch_wakes_chain_idx` ON `dispatch_wakes` (`chain_id`);--> statement-breakpoint
CREATE INDEX `dispatch_wakes_agent_idx` ON `dispatch_wakes` (`target_agent_id`);--> statement-breakpoint
CREATE TABLE `human_channel_states` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`last_read_seq` integer DEFAULT 0 NOT NULL,
	`dm_agent_id` text,
	`thread_followed_at` integer,
	`thread_done_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dm_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `human_saved_messages` (
	`space_id` text NOT NULL,
	`message_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`space_id`, `message_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `human_space_preferences` (
	`space_id` text PRIMARY KEY NOT NULL,
	`prefs` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`agent_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`search_text` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `message_mentions` (
	`message_id` text NOT NULL,
	`mention_type` text NOT NULL,
	`mention_id` text NOT NULL,
	`mention_name` text NOT NULL,
	PRIMARY KEY(`message_id`, `mention_type`, `mention_id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mentions_target_idx` ON `message_mentions` (`mention_type`,`mention_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`space_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_id` text,
	`sender_name` text NOT NULL,
	`message_type` text DEFAULT 'text' NOT NULL,
	`content` text NOT NULL,
	`action_metadata` text,
	`thread_id` text,
	`task_status` text,
	`task_number` integer,
	`task_assignee_type` text,
	`task_assignee_id` text,
	`task_claimed_at` integer,
	`task_completed_at` integer,
	`task_parent_id` text,
	`task_revision` integer DEFAULT 0 NOT NULL,
	`task_execution_mode` text DEFAULT 'autopilot' NOT NULL,
	`dispatch_chain_id` text,
	`dispatch_depth` integer,
	`search_text` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_space_seq_idx` ON `messages` (`space_id`,`seq`);--> statement-breakpoint
CREATE INDEX `messages_channel_idx` ON `messages` (`channel_id`,`seq`);--> statement-breakpoint
CREATE INDEX `messages_id_text_prefix_idx` ON `messages` (`id`);--> statement-breakpoint
CREATE INDEX `messages_task_parent_idx` ON `messages` (`task_parent_id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_uniq` ON `reactions` (`message_id`,`actor_type`,`actor_id`,`emoji`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`channel_id` text,
	`content` text NOT NULL,
	`anchor_message_id` text,
	`recurrence` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`remind_at` integer NOT NULL,
	`fired_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminders_due_idx` ON `reminders` (`remind_at`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_slug_unique` ON `spaces` (`slug`);--> statement-breakpoint
CREATE TABLE `task_number_counters` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`last_number` integer NOT NULL
);--> statement-breakpoint
PRAGMA user_version = 2;
