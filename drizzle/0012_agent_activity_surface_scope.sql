ALTER TABLE `agent_activity_log` ADD `channel_id` text;
--> statement-breakpoint
ALTER TABLE `agent_activity_log` ADD `conversation_id` text;
--> statement-breakpoint
ALTER TABLE `agent_activity_log` ADD `stream_id` text;
--> statement-breakpoint
PRAGMA user_version = 11;
