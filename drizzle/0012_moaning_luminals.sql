CREATE TABLE `dungeon_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`dungeon_id` text,
	`name` text NOT NULL,
	`links_json` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dungeon_id`) REFERENCES `dungeons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `dungeons` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`links_json` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `instance_floors` (
	`instance_id` text NOT NULL,
	`floor_idx` integer NOT NULL,
	`name` text NOT NULL,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`cell_ft` integer DEFAULT 5 NOT NULL,
	`tiles_json` text NOT NULL,
	`revealed_json` text NOT NULL,
	`annotations_json` text,
	`background_path` text,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`instance_id`, `floor_idx`),
	FOREIGN KEY (`instance_id`) REFERENCES `dungeon_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `encounters` ADD `dungeon_instance_id` text REFERENCES dungeon_instances(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `maps` ADD `dungeon_id` text REFERENCES dungeons(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `maps` ADD `floor_idx` integer;--> statement-breakpoint
ALTER TABLE `participants` ADD `pos_floor` integer;