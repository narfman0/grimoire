CREATE TABLE `session_log` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`character_id` text,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`detail_json` text,
	`is_private` integer DEFAULT false NOT NULL,
	`amends_log_id` text,
	`actor_user_id` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `session_log_campaign` ON `session_log` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `session_log_character` ON `session_log` (`character_id`);