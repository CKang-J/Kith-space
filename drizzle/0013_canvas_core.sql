CREATE TABLE `canvas_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `space_id` text NOT NULL,
  `title` text NOT NULL,
  `document_json` text NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `metadata_revision` integer DEFAULT 0 NOT NULL,
  `document_revision` integer DEFAULT 0 NOT NULL,
  `element_revision` integer DEFAULT 0 NOT NULL,
  `frame_revision` integer DEFAULT 0 NOT NULL,
  `structure_revision` integer DEFAULT 0 NOT NULL,
  `realtime_sequence` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_documents_space_updated_idx` ON `canvas_documents` (`space_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `canvas_mutations` (
  `id` text PRIMARY KEY NOT NULL,
  `canvas_id` text NOT NULL,
  `operation_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `kind` text NOT NULL,
  `source_mutation_id` text,
  `expected_revision` integer NOT NULL,
  `request_hash` text NOT NULL,
  `operation_json` text NOT NULL,
  `before_title` text NOT NULL,
  `after_title` text NOT NULL,
  `before_document_json` text NOT NULL,
  `after_document_json` text NOT NULL,
  `impact_json` text NOT NULL,
  `result_json` text NOT NULL,
  `state` text DEFAULT 'applied' NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`canvas_id`) REFERENCES `canvas_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_mutations_operation_uniq` ON `canvas_mutations` (`canvas_id`,`operation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_mutations_sequence_uniq` ON `canvas_mutations` (`canvas_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `canvas_mutations_history_idx` ON `canvas_mutations` (`canvas_id`,`kind`,`state`,`sequence`);
--> statement-breakpoint
CREATE TABLE `canvas_assets` (
  `id` text PRIMARY KEY NOT NULL,
  `canvas_id` text NOT NULL,
  `storage_key` text NOT NULL,
  `filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `sha256` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `state` text DEFAULT 'staged' NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`canvas_id`) REFERENCES `canvas_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_assets_storage_uniq` ON `canvas_assets` (`canvas_id`,`storage_key`);
--> statement-breakpoint
CREATE INDEX `canvas_assets_canvas_state_idx` ON `canvas_assets` (`canvas_id`,`state`);
--> statement-breakpoint
PRAGMA user_version = 12;
