CREATE TABLE IF NOT EXISTS `action_log` (
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `campaign_characters` (
	`campaign_id` text NOT NULL,
	`character_id` text NOT NULL,
	`role` text DEFAULT 'player' NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `character_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `campaign_members` (
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `user_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`owner_user_id` text,
	`name` text NOT NULL,
	`document` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `content` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`visibility` text DEFAULT 'private' NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`pack_slug`) REFERENCES `packs`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `content_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`reporter_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolver_user_id` text,
	`resolution` text,
	FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolver_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`active_participant_id` text,
	`notes_json` text,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `homebrew_subscriptions` (
	`user_id` text NOT NULL,
	`content_kind` text NOT NULL,
	`content_slug` text NOT NULL,
	`author_user_id` text NOT NULL,
	`pinned_version` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `content_kind`, `content_slug`, `author_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`content_kind` text NOT NULL,
	`content_slug` text NOT NULL,
	`author_user_id` text NOT NULL,
	`from_version` integer,
	`to_version` integer NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `packs` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`default_source` text NOT NULL,
	`loaded_at` integer NOT NULL,
	`author` text,
	`edition` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`character_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`statblock_slug` text,
	`statblock_json` text,
	`initiative` integer,
	`current_hp` integer,
	`max_hp` integer,
	`temp_hp` integer DEFAULT 0 NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`plan_json` text,
	`concentrating_json` text,
	`reveals_json` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `action_log_encounter` ON `action_log` (`encounter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `action_log_amends` ON `action_log` (`amends_log_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_log_user` ON `auth_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_log_action` ON `auth_log` (`action`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `campaigns_code_unique` ON `campaigns` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `content_identity` ON `content` (`kind`,`slug`,`version`,`scope_id`,`owner_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_lookup` ON `content` (`kind`,`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_pack` ON `content` (`pack_slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_source` ON `content` (`source`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_owner` ON `content` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_visibility` ON `content` (`visibility`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_reports_open` ON `content_reports` (`resolved_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `content_reports_content` ON `content_reports` (`content_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `homebrew_subscriptions_by_user` ON `homebrew_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `homebrew_subscriptions_by_author` ON `homebrew_subscriptions` (`author_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_by_user` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_by_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);--> statement-breakpoint
-- Synthetic pack row so content.pack_slug (NOT NULL FK) has a valid target for user-authored homebrew rows.
INSERT OR IGNORE INTO `packs` (`slug`, `name`, `version`, `default_source`, `loaded_at`)
VALUES ('homebrew', 'Homebrew', '1', 'homebrew', (unixepoch() * 1000));
