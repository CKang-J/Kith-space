CREATE TABLE `agent_activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`activity` text,
	`detail` text,
	`text` text,
	`tool_name` text,
	`tool_input` text
);
--> statement-breakpoint
CREATE INDEX `activity_agent_idx` ON `agent_activity_log` (`agent_id`,`ts`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`machine_id` text,
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
	`creator_type` text DEFAULT 'user' NOT NULL,
	`creator_id` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agents_server_idx` ON `agents` (`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_name_uniq` ON `agents` (`server_id`,`name`) WHERE "agents"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`channel_id` text,
	`server_id` text NOT NULL,
	`uploader_type` text,
	`uploader_id` text,
	`filename` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`storage_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_channel_idx` ON `attachments` (`channel_id`);--> statement-breakpoint
CREATE INDEX `attachments_id_text_prefix_idx` ON `attachments` (`id`);--> statement-breakpoint
CREATE TABLE `channel_members` (
	`channel_id` text NOT NULL,
	`member_type` text NOT NULL,
	`member_id` text NOT NULL,
	`last_read_seq` integer DEFAULT 0 NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`thread_done_at` integer,
	PRIMARY KEY(`channel_id`, `member_type`, `member_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`parent_message_id` text,
	`last_message_at` integer,
	`archived_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channels_server_idx` ON `channels` (`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channels_dm_uniq` ON `channels` (`server_id`,`name`) WHERE "channels"."type" = 'dm';--> statement-breakpoint
CREATE UNIQUE INDEX `channels_thread_uniq` ON `channels` (`server_id`,`parent_message_id`) WHERE "channels"."type" = 'thread';--> statement-breakpoint
CREATE TABLE `join_links` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by_user_id` text,
	`role` text DEFAULT 'member' NOT NULL,
	`max_uses` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `join_links_token_unique` ON `join_links` (`token`);--> statement-breakpoint
CREATE INDEX `join_links_server_idx` ON `join_links` (`server_id`);--> statement-breakpoint
CREATE TABLE `knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`agent_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`search_text` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`api_key_hash` text NOT NULL,
	`api_key_prefix` text NOT NULL,
	`runtimes` text DEFAULT '[]' NOT NULL,
	`hostname` text,
	`os` text,
	`daemon_version` text,
	`last_heartbeat` integer,
	`status` text DEFAULT 'offline' NOT NULL,
	`is_computer` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `machines_server_idx` ON `machines` (`server_id`);--> statement-breakpoint
CREATE TABLE `message_mentions` (
	`message_id` text NOT NULL,
	`mention_type` text NOT NULL,
	`mention_id` text NOT NULL,
	`mention_name` text NOT NULL,
	PRIMARY KEY(`message_id`, `mention_type`, `mention_id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mentions_target_idx` ON `message_mentions` (`mention_type`,`mention_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`server_id` text NOT NULL,
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
	`search_text` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_server_seq_idx` ON `messages` (`server_id`,`seq`);--> statement-breakpoint
CREATE INDEX `messages_channel_idx` ON `messages` (`channel_id`,`seq`);--> statement-breakpoint
CREATE INDEX `messages_id_text_prefix_idx` ON `messages` (`id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`member_type` text NOT NULL,
	`member_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_uniq` ON `reactions` (`message_id`,`member_type`,`member_id`,`emoji`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
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
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminders_due_idx` ON `reminders` (`remind_at`);--> statement-breakpoint
CREATE TABLE `saved_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`member_type` text NOT NULL,
	`member_id` text NOT NULL,
	`message_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_messages_uniq` ON `saved_messages` (`member_type`,`member_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `server_members` (
	`server_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`push_muted` integer DEFAULT false NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`server_id`, `user_id`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `server_sidebar_prefs` (
	`server_id` text NOT NULL,
	`user_id` text NOT NULL,
	`prefs` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`server_id`, `user_id`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`owner_id` text NOT NULL,
	`onboarding_agent_id` text,
	`root_path` text NOT NULL,
	`avatar_url` text,
	`hide_humans_from_members` integer DEFAULT false NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_slug_unique` ON `servers` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`gravatar_hash` text,
	`avatar_url` text,
	`description` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_name_unique` ON `users` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);