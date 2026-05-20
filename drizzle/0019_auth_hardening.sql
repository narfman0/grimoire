ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verify_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verify_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `password_reset_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `password_reset_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `failed_login_count` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `locked_until` integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `auth_log` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `action` text NOT NULL,
  `ip` text,
  `user_agent` text,
  `created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `auth_log_user` ON `auth_log` (`user_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `auth_log_action` ON `auth_log` (`action`, `created_at`);
