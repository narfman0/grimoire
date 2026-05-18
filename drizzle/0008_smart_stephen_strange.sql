-- Phase 1 of character-campaign decoupling. New M:N join table; the
-- characters.campaignId column stays as the soft home pointer for now.
CREATE TABLE `campaign_characters` (
	`campaign_id` text NOT NULL,
	`character_id` text NOT NULL,
	`role` text DEFAULT 'player' NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `character_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Backfill — every existing character is linked to its current
-- characters.campaignId so today's behaviour is preserved. INSERT OR IGNORE
-- makes the migration idempotent if it's somehow re-applied.
INSERT OR IGNORE INTO `campaign_characters` (`campaign_id`, `character_id`, `role`, `added_at`)
SELECT `campaign_id`, `id`, 'player', (unixepoch() * 1000)
FROM `characters`;
