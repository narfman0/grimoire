-- Notes: extend with `body` + timestamps. Existing rows get defaulted via
-- (unixepoch() * 1000) so the NOT NULL constraints don't reject backfill.
ALTER TABLE `notes` ADD `body` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD `created_at` integer NOT NULL DEFAULT (unixepoch() * 1000);--> statement-breakpoint
ALTER TABLE `notes` ADD `updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000);
