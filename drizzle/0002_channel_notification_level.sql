ALTER TABLE `human_channel_states` ADD `notification_level` text DEFAULT 'all' NOT NULL;
--> statement-breakpoint
PRAGMA user_version = 4;
