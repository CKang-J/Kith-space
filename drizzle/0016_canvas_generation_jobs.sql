CREATE TABLE `canvas_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`job_type` text NOT NULL,
	`status` text NOT NULL,
	`gen_prompt` text NOT NULL,
	`config_json` text,
	`placement_json` text NOT NULL,
	`provider` text NOT NULL,
	`provider_job_id` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`result_asset_id` text,
	`result_node_id` text,
	`turn_id` text,
	`idempotency_key` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_asset_id`) REFERENCES `canvas_assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `canvas_generation_jobs_job_type_check` CHECK(`job_type` IN ('image', 'video')),
	CONSTRAINT `canvas_generation_jobs_status_check` CHECK(`status` IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT `canvas_generation_jobs_provider_check` CHECK(`provider` IN ('doubao', 'seedream', 'stability', 'runway', 'dalle', 'pika'))
);
--> statement-breakpoint
CREATE INDEX `canvas_generation_jobs_canvas_idx` ON `canvas_generation_jobs` (`canvas_id`);
--> statement-breakpoint
CREATE INDEX `canvas_generation_jobs_status_idx` ON `canvas_generation_jobs` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_generation_jobs_idempotency_uniq` ON `canvas_generation_jobs` (`canvas_id`,`idempotency_key`);
--> statement-breakpoint
PRAGMA user_version = 15;
