CREATE TABLE `content_reports` (
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
CREATE TABLE `homebrew_subscriptions` (
	`user_id` text NOT NULL,
	`content_kind` text NOT NULL,
	`content_slug` text NOT NULL,
	`author_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `content_kind`, `content_slug`, `author_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `content` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `content_reports_open` ON `content_reports` (`resolved_at`);--> statement-breakpoint
CREATE INDEX `content_reports_content` ON `content_reports` (`content_id`);--> statement-breakpoint
CREATE INDEX `homebrew_subscriptions_by_user` ON `homebrew_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `homebrew_subscriptions_by_author` ON `homebrew_subscriptions` (`author_user_id`);--> statement-breakpoint
CREATE INDEX `content_visibility` ON `content` (`visibility`);--> statement-breakpoint
-- Pack-loaded rows (SRD, grimoire-packs) are public by definition — flip
-- their visibility off the 'private' default. Homebrew rows authored before
-- this migration stay private (the safe choice; authors opt in via the
-- visibility toggle).
UPDATE `content` SET `visibility` = 'public' WHERE `owner_user_id` IS NULL;