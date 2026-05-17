CREATE TABLE `content` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`version` integer NOT NULL,
	`source` text NOT NULL,
	`scope_id` text,
	`pack_slug` text NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pack_slug`) REFERENCES `packs`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `packs` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`default_source` text NOT NULL,
	`loaded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_identity` ON `content` (`kind`,`slug`,`version`,`scope_id`);--> statement-breakpoint
CREATE INDEX `content_lookup` ON `content` (`kind`,`slug`);--> statement-breakpoint
CREATE INDEX `content_pack` ON `content` (`pack_slug`);--> statement-breakpoint
CREATE INDEX `content_source` ON `content` (`source`);