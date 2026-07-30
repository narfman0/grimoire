CREATE TABLE `encounter_boards` (
	`encounter_id` text PRIMARY KEY NOT NULL,
	`source_map_id` text,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`cell_ft` integer DEFAULT 5 NOT NULL,
	`tiles_json` text NOT NULL,
	`background_path` text,
	`revealed_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `maps` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`cell_ft` integer DEFAULT 5 NOT NULL,
	`tiles_json` text NOT NULL,
	`background_path` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maps_owner` ON `maps` (`owner_user_id`);--> statement-breakpoint
ALTER TABLE `participants` ADD `pos_x` integer;--> statement-breakpoint
ALTER TABLE `participants` ADD `pos_y` integer;--> statement-breakpoint
ALTER TABLE `participants` ADD `size_cells` integer DEFAULT 1 NOT NULL;