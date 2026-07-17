ALTER TABLE `tasks` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `dismissed_at` text;--> statement-breakpoint
UPDATE `tasks` SET `completed_at` = `updated_at` WHERE `status` IN ('completed','failed');