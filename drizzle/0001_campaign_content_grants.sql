CREATE TABLE `campaign_content_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`grant_type` text NOT NULL,
	`grant_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_content_grants_by_campaign` ON `campaign_content_grants` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_content_grants_unique` ON `campaign_content_grants` (`campaign_id`,`grant_type`,`grant_key`);