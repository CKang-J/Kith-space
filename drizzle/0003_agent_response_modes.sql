ALTER TABLE `agents` ADD `default_response_mode` text DEFAULT 'active' NOT NULL CHECK (`default_response_mode` IN ('active', 'mention_only', 'silent'));--> statement-breakpoint
ALTER TABLE `channel_agent_members` ADD `response_mode_override` text CHECK (`response_mode_override` IS NULL OR `response_mode_override` IN ('active', 'mention_only', 'silent'));--> statement-breakpoint
ALTER TABLE `channel_agent_members` ADD `ambient_wake_after_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_agent_members` ADD `mention_wake_after_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
PRAGMA user_version = 5;
