CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`description` text NOT NULL,
	`context` text NOT NULL,
	`session_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`result` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `tasks_user_id_created_at_idx` ON `tasks` (`user_id`,`created_at`);
