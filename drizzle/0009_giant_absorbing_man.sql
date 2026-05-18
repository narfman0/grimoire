-- Homebrew feat editor: per-user authorship on content rows. ownerUserId is
-- null for pack-loaded rows (SRD, grimoire-packs) and the author's user id
-- for in-app homebrew. updatedAt is null until the row is first edited.
DROP INDEX IF EXISTS `content_identity`;--> statement-breakpoint
ALTER TABLE `content` ADD `owner_user_id` text;--> statement-breakpoint
ALTER TABLE `content` ADD `updated_at` integer;--> statement-breakpoint
CREATE INDEX `content_owner` ON `content` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_identity` ON `content` (`kind`,`slug`,`version`,`scope_id`,`owner_user_id`);--> statement-breakpoint
-- Synthetic "homebrew" pack row so content.pack_slug (NOT NULL, FK to packs)
-- has a valid target for user-authored rows. The pack loader skips this slug
-- in its orphan-detection scan (see loader.ts).
INSERT OR IGNORE INTO `packs` (`slug`, `name`, `version`, `default_source`, `loaded_at`)
VALUES ('homebrew', 'Homebrew', '1', 'homebrew', (unixepoch() * 1000));