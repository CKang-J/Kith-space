ALTER TABLE `agents` ADD `model_binding_mode` text CHECK (`model_binding_mode` IN ('runtime_default', 'pinned') OR `model_binding_mode` IS NULL);
--> statement-breakpoint
ALTER TABLE `agents` ADD `model_configuration_id` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `model_configuration_revision` integer CHECK (`model_configuration_revision` > 0 OR `model_configuration_revision` IS NULL);
--> statement-breakpoint
ALTER TABLE `agents` ADD `model_binding_label_snapshot` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `model_binding_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `confirmed_effective_provider_snapshot` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `confirmed_installation_identity_digest` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `model_binding_state` text DEFAULT 'legacy' NOT NULL CHECK (`model_binding_state` IN ('legacy', 'ready', 'setup_required', 'confirmation_required', 'incompatible', 'restart_required'));
--> statement-breakpoint
ALTER TABLE `agents` ADD `runtime_restart_required` integer DEFAULT 0 NOT NULL CHECK (`runtime_restart_required` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `runtime_sessions` ADD `runtime_configuration_epoch` integer CHECK (`runtime_configuration_epoch` > 0 OR `runtime_configuration_epoch` IS NULL);
--> statement-breakpoint
CREATE INDEX `agents_model_binding_idx` ON `agents` (`model_binding_state`,`model_binding_mode`);
--> statement-breakpoint
CREATE TRIGGER `agents_model_binding_insert_check`
BEFORE INSERT ON `agents`
WHEN NOT (
  (`NEW`.`model_binding_state` = 'legacy' AND `NEW`.`model_binding_mode` IS NULL
    AND `NEW`.`model_configuration_id` IS NULL AND `NEW`.`model_configuration_revision` IS NULL)
  OR (`NEW`.`model_binding_mode` = 'runtime_default'
    AND `NEW`.`model_configuration_id` IS NULL AND `NEW`.`model_configuration_revision` IS NULL)
  OR (`NEW`.`model_binding_mode` = 'pinned'
    AND `NEW`.`model_configuration_id` IS NOT NULL AND `NEW`.`model_configuration_revision` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid agent model binding');
END;
--> statement-breakpoint
PRAGMA user_version = 10;
--> statement-breakpoint
CREATE TRIGGER `agents_model_binding_update_check`
BEFORE UPDATE OF `model_binding_mode`, `model_configuration_id`, `model_configuration_revision`, `model_binding_state` ON `agents`
WHEN NOT (
  (`NEW`.`model_binding_state` = 'legacy' AND `NEW`.`model_binding_mode` IS NULL
    AND `NEW`.`model_configuration_id` IS NULL AND `NEW`.`model_configuration_revision` IS NULL)
  OR (`NEW`.`model_binding_mode` = 'runtime_default'
    AND `NEW`.`model_configuration_id` IS NULL AND `NEW`.`model_configuration_revision` IS NULL)
  OR (`NEW`.`model_binding_mode` = 'pinned'
    AND `NEW`.`model_configuration_id` IS NOT NULL AND `NEW`.`model_configuration_revision` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid agent model binding');
END;
