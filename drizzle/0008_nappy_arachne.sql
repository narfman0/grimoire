CREATE INDEX `campaign_characters_character` ON `campaign_characters` (`character_id`);--> statement-breakpoint
CREATE INDEX `campaign_members_user` ON `campaign_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `characters_owner` ON `characters` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `characters_owner_slug` ON `characters` (`owner_user_id`,`slug`);--> statement-breakpoint
CREATE INDEX `notes_campaign` ON `notes` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `participants_encounter` ON `participants` (`encounter_id`);