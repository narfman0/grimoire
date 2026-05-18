CREATE TABLE `action_log` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`round` integer NOT NULL,
	`participant_id` text,
	`target_participant_id` text,
	`action_id` text NOT NULL,
	`action_label` text NOT NULL,
	`submitted_by_user_id` text NOT NULL,
	`submitter_role` text NOT NULL,
	`is_amendment` integer DEFAULT false NOT NULL,
	`amends_log_id` text,
	`attack_roll` integer,
	`damage_roll` integer,
	`hit` text,
	`target_hp_before` integer,
	`target_hp_after` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `action_log_encounter` ON `action_log` (`encounter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `action_log_amends` ON `action_log` (`amends_log_id`);