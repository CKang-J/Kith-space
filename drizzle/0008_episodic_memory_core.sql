CREATE TABLE `episodic_memories` (
  `id` text PRIMARY KEY NOT NULL, `space_id` text NOT NULL REFERENCES `spaces`(`id`) ON DELETE cascade,
  `owner_agent_id` text REFERENCES `agents`(`id`) ON DELETE cascade, `scope` text NOT NULL, `kind` text NOT NULL,
  `subject_ref_json` text NOT NULL, `subject_key` text NOT NULL, `predicate_key` text NOT NULL,
  `current_revision` integer NOT NULL DEFAULT 1, `status` text NOT NULL,
  `confidence_millis` integer NOT NULL, `importance_millis` integer NOT NULL, `sensitivity` text NOT NULL,
  `disclosure` text NOT NULL, `valid_from` integer, `valid_to` integer, `source_access` text NOT NULL DEFAULT 'available',
  `deletion_state` text NOT NULL DEFAULT 'none', `row_version` integer NOT NULL DEFAULT 1,
  `created_by_json` text NOT NULL, `updated_by_json` text NOT NULL, `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
  CONSTRAINT `episodic_memories_ownership_check` CHECK ((scope = 'agent_private' AND owner_agent_id IS NOT NULL) OR (scope = 'space_shared' AND owner_agent_id IS NULL)),
  FOREIGN KEY (`id`,`current_revision`) REFERENCES `episodic_memory_revisions`(`memory_id`,`revision`) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX `episodic_memories_claim_idx` ON `episodic_memories` (`scope`,`owner_agent_id`,`subject_key`,`predicate_key`);
--> statement-breakpoint
CREATE INDEX `episodic_memories_recall_idx` ON `episodic_memories` (`status`,`owner_agent_id`,`source_access`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `episodic_memory_revisions` (`memory_id` text NOT NULL REFERENCES `episodic_memories`(`id`) ON DELETE cascade, `revision` integer NOT NULL, `canonical_text` text NOT NULL, `internal_summary` text, `shareable_summary` text, `content_hmac` text NOT NULL, `sensitivity` text NOT NULL, `disclosure` text NOT NULL, `valid_from` integer, `valid_to` integer, `created_by_json` text NOT NULL, `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000), PRIMARY KEY (`memory_id`,`revision`));
--> statement-breakpoint
CREATE TABLE `memory_evidence` (`id` text PRIMARY KEY NOT NULL, `memory_id` text NOT NULL REFERENCES `episodic_memories`(`id`) ON DELETE cascade, `memory_revision` integer NOT NULL, `source_space_id` text, `source_kind` text NOT NULL, `source_id` text NOT NULL, `source_surface_id` text, `visibility_at_occurrence` text NOT NULL, `asserted_by_json` text NOT NULL, `quoted_from_json` text, `claim_type` text NOT NULL, `memory_policy` text NOT NULL, `excerpt_hmac` text NOT NULL, `occurred_at` integer NOT NULL, FOREIGN KEY (`memory_id`,`memory_revision`) REFERENCES `episodic_memory_revisions`(`memory_id`,`revision`) ON DELETE cascade DEFERRABLE INITIALLY DEFERRED);
--> statement-breakpoint
CREATE INDEX `memory_evidence_memory_idx` ON `memory_evidence` (`memory_id`,`memory_revision`);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_evidence_source_uniq` ON `memory_evidence` (`memory_id`,`memory_revision`,`source_kind`,`source_id`);
--> statement-breakpoint
CREATE TABLE `memory_relations` (`id` text PRIMARY KEY NOT NULL, `from_memory_id` text NOT NULL REFERENCES `episodic_memories`(`id`) ON DELETE cascade, `from_revision` integer, `to_memory_id` text NOT NULL REFERENCES `episodic_memories`(`id`) ON DELETE cascade, `to_revision` integer, `relation_type` text NOT NULL, `created_by_json` text NOT NULL, `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000), FOREIGN KEY (`from_memory_id`,`from_revision`) REFERENCES `episodic_memory_revisions`(`memory_id`,`revision`) ON DELETE cascade DEFERRABLE INITIALLY DEFERRED, FOREIGN KEY (`to_memory_id`,`to_revision`) REFERENCES `episodic_memory_revisions`(`memory_id`,`revision`) ON DELETE cascade DEFERRABLE INITIALLY DEFERRED);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_relations_uniq` ON `memory_relations` (`from_memory_id`,`from_revision`,`to_memory_id`,`to_revision`,`relation_type`);
--> statement-breakpoint
CREATE TABLE `memory_tags` (`memory_id` text NOT NULL REFERENCES `episodic_memories`(`id`) ON DELETE cascade, `tag` text NOT NULL, PRIMARY KEY (`memory_id`,`tag`));
--> statement-breakpoint
CREATE INDEX `memory_tags_tag_idx` ON `memory_tags` (`tag`,`memory_id`);
--> statement-breakpoint
CREATE TABLE `memory_suppressions` (`id` text PRIMARY KEY NOT NULL, `scope` text NOT NULL, `owner_agent_id` text, `source_kind` text NOT NULL, `source_id` text NOT NULL, `claim_hmac` text NOT NULL, `status` text NOT NULL DEFAULT 'active', `created_by_json` text NOT NULL, `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000), `revoked_at` integer);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_suppressions_uniq` ON `memory_suppressions` (`scope`,coalesce(`owner_agent_id`,''),`source_kind`,`source_id`,`claim_hmac`);
--> statement-breakpoint
CREATE TABLE `memory_mutations` (`id` text PRIMARY KEY NOT NULL, `memory_id` text, `action` text NOT NULL, `idempotency_key` text NOT NULL, `request_hash` text NOT NULL, `result_ref_json` text, `actor_json` text NOT NULL, `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000));
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_mutations_key_uniq` ON `memory_mutations` (`actor_json`,`idempotency_key`);
--> statement-breakpoint
CREATE TABLE `memory_lexical_terms` (`memory_id` text NOT NULL REFERENCES `episodic_memories`(`id`) ON DELETE cascade, `term` text NOT NULL, PRIMARY KEY (`memory_id`,`term`));
--> statement-breakpoint
CREATE INDEX `memory_lexical_terms_term_idx` ON `memory_lexical_terms` (`term`,`memory_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `memory_fts` USING fts5(`memory_id` UNINDEXED, `lexical_text`, `cjk_bigrams`, `cjk_trigrams`, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
PRAGMA user_version = 7;
