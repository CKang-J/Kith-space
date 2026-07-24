ALTER TABLE `attachments` ADD `upload_state` text;
--> statement-breakpoint
ALTER TABLE `attachments` ADD `source_turn_id` text;
--> statement-breakpoint
ALTER TABLE `attachments` ADD `source_activation_id` text;
--> statement-breakpoint
ALTER TABLE `attachments` ADD `expires_at` integer;
--> statement-breakpoint
CREATE INDEX `attachments_upload_state_expiry_idx` ON `attachments` (`upload_state`,`expires_at`);
