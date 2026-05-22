CREATE TABLE `__new_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text,
	`owner_user_id` text,
	`name` text NOT NULL,
	`document` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_characters`(`id`, `campaign_id`, `owner_user_id`, `name`, `document`, `updated_at`) SELECT `id`, `campaign_id`, `owner_user_id`, `name`, `document`, `updated_at` FROM `characters`;
--> statement-breakpoint
DROP TABLE `characters`;
--> statement-breakpoint
ALTER TABLE `__new_characters` RENAME TO `characters`;
