ALTER TABLE `agents` ADD `introduced_at` integer;
--> statement-breakpoint
UPDATE `agents` SET `introduced_at` = `created_at` WHERE `introduced_at` IS NULL;
--> statement-breakpoint
PRAGMA user_version = 3;
