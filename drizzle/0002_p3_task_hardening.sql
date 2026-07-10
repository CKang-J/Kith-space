CREATE TABLE `task_number_counters` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`last_number` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `task_number_counters` (`scope_key`, `last_number`)
SELECT 'tasknum:' || m.`server_id`, max(m.`task_number`)
FROM `messages` m
INNER JOIN `channels` c ON c.`id` = m.`channel_id`
WHERE c.`type` <> 'dm' AND m.`task_number` IS NOT NULL
GROUP BY m.`server_id`
UNION ALL
SELECT 'tasknum:dm:' || m.`channel_id`, max(m.`task_number`)
FROM `messages` m
INNER JOIN `channels` c ON c.`id` = m.`channel_id`
WHERE c.`type` = 'dm' AND m.`task_number` IS NOT NULL
GROUP BY m.`channel_id`;
--> statement-breakpoint
ALTER TABLE `messages` ADD `task_parent_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `task_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_task_parent_idx` ON `messages` (`task_parent_id`);
