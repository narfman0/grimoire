-- Add SQL-level DEFAULT (unixepoch('now') * 1000) to all NOT NULL timestamp columns.
-- SQLite cannot ALTER COLUMN to set a default, so each table must be recreated.
-- Column order matches the actual DB column order (including ALTER TABLE adds from prior migrations).

PRAGMA foreign_keys = OFF;
--> statement-breakpoint

-- campaigns (slug added as nullable in 0006)
CREATE TABLE `campaigns_new` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	`slug` text
);
--> statement-breakpoint
INSERT INTO `campaigns_new` SELECT * FROM `campaigns`;
--> statement-breakpoint
DROP TABLE `campaigns`;
--> statement-breakpoint
ALTER TABLE `campaigns_new` RENAME TO `campaigns`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `campaigns_code_unique` ON `campaigns` (`code`);
--> statement-breakpoint

-- notes
CREATE TABLE `notes_new` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `notes_new` SELECT * FROM `notes`;
--> statement-breakpoint
DROP TABLE `notes`;
--> statement-breakpoint
ALTER TABLE `notes_new` RENAME TO `notes`;
--> statement-breakpoint

-- packs (description/owner_user_id/visibility/created_at/updated_at added in 0004; loaded_at and created_at both get real defaults now)
CREATE TABLE `packs_new` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`default_source` text NOT NULL,
	`loaded_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	`author` text,
	`edition` text,
	`description` text,
	`owner_user_id` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `packs_new` SELECT * FROM `packs`;
--> statement-breakpoint
DROP TABLE `packs`;
--> statement-breakpoint
ALTER TABLE `packs_new` RENAME TO `packs`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `packs_owner` ON `packs` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `packs_visibility` ON `packs` (`visibility`);
--> statement-breakpoint

-- content (FK: pack_slug → packs)
CREATE TABLE `content_new` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`version` integer NOT NULL,
	`source` text NOT NULL,
	`scope_id` text,
	`owner_user_id` text,
	`pack_slug` text NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	`updated_at` integer,
	`visibility` text DEFAULT 'private' NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`pack_slug`) REFERENCES `packs`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `content_new` SELECT * FROM `content`;
--> statement-breakpoint
DROP TABLE `content`;
--> statement-breakpoint
ALTER TABLE `content_new` RENAME TO `content`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `content_identity` ON `content` (`kind`,`slug`,`version`,`scope_id`,`owner_user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_lookup` ON `content` (`kind`,`slug`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_pack` ON `content` (`pack_slug`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_source` ON `content` (`source`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_owner` ON `content` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_visibility` ON `content` (`visibility`);
--> statement-breakpoint

-- users
CREATE TABLE `users_new` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`email` text,
	`email_verified_at` integer,
	`email_verify_token` text,
	`email_verify_token_expires_at` integer,
	`password_reset_token` text,
	`password_reset_token_expires_at` integer,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000)
);
--> statement-breakpoint
INSERT INTO `users_new` SELECT * FROM `users`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `users_new` RENAME TO `users`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_username_unique` ON `users` (`username`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);
--> statement-breakpoint

-- auth_log (FK: user_id → users)
CREATE TABLE `auth_log_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `auth_log_new` SELECT * FROM `auth_log`;
--> statement-breakpoint
DROP TABLE `auth_log`;
--> statement-breakpoint
ALTER TABLE `auth_log_new` RENAME TO `auth_log`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_log_user` ON `auth_log` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_log_action` ON `auth_log` (`action`,`created_at`);
--> statement-breakpoint

-- sessions (FK: user_id → users)
CREATE TABLE `sessions_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `sessions_new` SELECT * FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `sessions_new` RENAME TO `sessions`;
--> statement-breakpoint

-- campaign_members (status added via ALTER TABLE in 0002; current col order: campaign_id, user_id, role, joined_at, status)
CREATE TABLE `campaign_members_new` (
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	`status` text NOT NULL DEFAULT 'approved',
	PRIMARY KEY(`campaign_id`, `user_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `campaign_members_new` SELECT * FROM `campaign_members`;
--> statement-breakpoint
DROP TABLE `campaign_members`;
--> statement-breakpoint
ALTER TABLE `campaign_members_new` RENAME TO `campaign_members`;
--> statement-breakpoint

-- campaign_characters
CREATE TABLE `campaign_characters_new` (
	`campaign_id` text NOT NULL,
	`character_id` text NOT NULL,
	`role` text DEFAULT 'player' NOT NULL,
	`added_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	PRIMARY KEY(`campaign_id`, `character_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `campaign_characters_new` SELECT * FROM `campaign_characters`;
--> statement-breakpoint
DROP TABLE `campaign_characters`;
--> statement-breakpoint
ALTER TABLE `campaign_characters_new` RENAME TO `campaign_characters`;
--> statement-breakpoint

-- encounters (FK: campaign_id → campaigns)
CREATE TABLE `encounters_new` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`active_participant_id` text,
	`notes_json` text,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	`ended_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `encounters_new` SELECT * FROM `encounters`;
--> statement-breakpoint
DROP TABLE `encounters`;
--> statement-breakpoint
ALTER TABLE `encounters_new` RENAME TO `encounters`;
--> statement-breakpoint

-- action_log (FKs: encounter_id → encounters, participant_id/target → participants, submitted_by → users)
CREATE TABLE `action_log_new` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`round` integer NOT NULL,
	`participant_id` text,
	`target_participant_id` text,
	`action_id` text NOT NULL,
	`action_label` text NOT NULL,
	`submitted_by_user_id` text NOT NULL,
	`submitter_role` text NOT NULL,
	`is_amendment` integer DEFAULT false NOT NULL,
	`amends_log_id` text,
	`attack_roll` integer,
	`damage_roll` integer,
	`hit` text,
	`target_hp_before` integer,
	`target_hp_after` integer,
	`notes` text,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `action_log_new` SELECT * FROM `action_log`;
--> statement-breakpoint
DROP TABLE `action_log`;
--> statement-breakpoint
ALTER TABLE `action_log_new` RENAME TO `action_log`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `action_log_encounter` ON `action_log` (`encounter_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `action_log_amends` ON `action_log` (`amends_log_id`);
--> statement-breakpoint

-- homebrew_subscriptions (FKs: user_id → users, author_user_id → users)
CREATE TABLE `homebrew_subscriptions_new` (
	`user_id` text NOT NULL,
	`content_kind` text NOT NULL,
	`content_slug` text NOT NULL,
	`author_user_id` text NOT NULL,
	`pinned_version` integer,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	PRIMARY KEY(`user_id`, `content_kind`, `content_slug`, `author_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `homebrew_subscriptions_new` SELECT * FROM `homebrew_subscriptions`;
--> statement-breakpoint
DROP TABLE `homebrew_subscriptions`;
--> statement-breakpoint
ALTER TABLE `homebrew_subscriptions_new` RENAME TO `homebrew_subscriptions`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `homebrew_subscriptions_by_user` ON `homebrew_subscriptions` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `homebrew_subscriptions_by_author` ON `homebrew_subscriptions` (`author_user_id`);
--> statement-breakpoint

-- content_reports (FKs: content_id → content, reporter/resolver → users)
CREATE TABLE `content_reports_new` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`reporter_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	`resolved_at` integer,
	`resolver_user_id` text,
	`resolution` text,
	FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolver_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `content_reports_new` SELECT * FROM `content_reports`;
--> statement-breakpoint
DROP TABLE `content_reports`;
--> statement-breakpoint
ALTER TABLE `content_reports_new` RENAME TO `content_reports`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_reports_open` ON `content_reports` (`resolved_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_reports_content` ON `content_reports` (`content_id`);
--> statement-breakpoint

-- notifications (FKs: user_id → users, author_user_id → users)
CREATE TABLE `notifications_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`content_kind` text NOT NULL,
	`content_slug` text NOT NULL,
	`author_user_id` text NOT NULL,
	`from_version` integer,
	`to_version` integer NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `notifications_new` SELECT * FROM `notifications`;
--> statement-breakpoint
DROP TABLE `notifications`;
--> statement-breakpoint
ALTER TABLE `notifications_new` RENAME TO `notifications`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_by_user` ON `notifications` (`user_id`,`read_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_by_created` ON `notifications` (`user_id`,`created_at`);
--> statement-breakpoint

-- campaign_content_grants (FK: campaign_id → campaigns)
CREATE TABLE `campaign_content_grants_new` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`grant_type` text NOT NULL,
	`grant_key` text NOT NULL,
	`created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `campaign_content_grants_new` SELECT * FROM `campaign_content_grants`;
--> statement-breakpoint
DROP TABLE `campaign_content_grants`;
--> statement-breakpoint
ALTER TABLE `campaign_content_grants_new` RENAME TO `campaign_content_grants`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `campaign_content_grants_by_campaign` ON `campaign_content_grants` (`campaign_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `campaign_content_grants_unique` ON `campaign_content_grants` (`campaign_id`,`grant_type`,`grant_key`);
--> statement-breakpoint

PRAGMA foreign_keys = ON;
