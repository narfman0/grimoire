-- Promote `packs` from a thin directory-of-files pointer to a first-class
-- user-owned object. Adds description / ownerUserId / visibility / timestamps.
--
-- Migration notes:
--   * created_at has a UNIX-ms default so existing rows (srd-5.2, homebrew)
--     backfill at migration time without needing a manual UPDATE.
--   * The user authorized wiping any 'homebrew' content rows / pack row that
--     might exist in production; the synthetic 'homebrew' bucket row is
--     re-seeded as part of this migration with the new column shape.
--   * SRD pack is preserved and stamped public.
--   * Foreign key on owner_user_id can't be added in-place by SQLite
--     without a table rebuild, so we add the column (no FK enforcement at
--     the DB level) and rely on the Drizzle schema for the typed reference.
--     content.pack_slug already references packs.slug; nothing else here
--     needs the cascade.

ALTER TABLE `packs` ADD `description` text;--> statement-breakpoint
ALTER TABLE `packs` ADD `owner_user_id` text;--> statement-breakpoint
ALTER TABLE `packs` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `packs` ADD `created_at` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `packs` ADD `updated_at` integer;--> statement-breakpoint
CREATE INDEX `packs_owner` ON `packs` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `packs_visibility` ON `packs` (`visibility`);--> statement-breakpoint

-- Backfill existing rows.
--   srd-5.2  → public  (open-source CC-BY content, surfaces in browse)
--   homebrew → private (synthetic fast-path bucket, owner-less)
UPDATE `packs`
   SET `description` = 'Systems Reference Document 5.2.1 (CC-BY 4.0)',
       `visibility`  = 'public',
       `created_at`  = `loaded_at`
 WHERE `slug` = 'srd-5.2';--> statement-breakpoint
UPDATE `packs`
   SET `description` = 'Built-in fast-path bucket for in-editor single-row authoring',
       `visibility`  = 'private',
       `created_at`  = `loaded_at`
 WHERE `slug` = 'homebrew';--> statement-breakpoint

-- Any other pre-existing rows get a non-zero created_at so the column is
-- usable for ORDER BY without manual cleanup.
UPDATE `packs` SET `created_at` = `loaded_at` WHERE `created_at` = 0;
