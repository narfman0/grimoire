CREATE TABLE `notifications` (
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
ALTER TABLE `content` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `homebrew_subscriptions` ADD `pinned_version` integer;--> statement-breakpoint
CREATE INDEX `notifications_by_user` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notifications_by_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
-- Backfill `content.published_at` so existing rows don't look like drafts:
--   * pack-loaded rows (owner_user_id IS NULL) → published at their createdAt
--   * user-authored rows already visible (public/unlisted) → published at
--     updatedAt (fallback createdAt)
--   * private user rows stay NULL = unpublished drafts (current behavior).
UPDATE `content`
   SET `published_at` = `created_at`
 WHERE `owner_user_id` IS NULL;--> statement-breakpoint
UPDATE `content`
   SET `published_at` = COALESCE(`updated_at`, `created_at`)
 WHERE `owner_user_id` IS NOT NULL
   AND `visibility` != 'private';