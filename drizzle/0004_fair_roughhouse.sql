CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`active_participant_id` text,
	`notes_json` text,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`character_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`statblock_slug` text,
	`statblock_json` text,
	`initiative` integer,
	`current_hp` integer,
	`max_hp` integer,
	`temp_hp` integer DEFAULT 0 NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null
);
