-- DM secrecy: per-participant reveal flags. PCs default to all-revealed
-- (party members know each other); NPCs/monsters default to all-hidden so
-- they appear to players as "Enemy N" + HP bucket until the DM reveals.
ALTER TABLE `participants` ADD `reveals_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE `participants`
   SET `reveals_json` = '{"identity":true,"vitals":true,"combat":true,"hidden":false}'
 WHERE `kind` = 'pc';--> statement-breakpoint
UPDATE `participants`
   SET `reveals_json` = '{"identity":false,"vitals":false,"combat":false,"hidden":false}'
 WHERE `kind` != 'pc';