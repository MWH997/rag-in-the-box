ALTER TABLE `tenant_settings` ADD `context_char_budget` integer DEFAULT 9000 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_settings` ADD `max_answer_tokens` integer DEFAULT 700 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_settings` ADD `temperature` real DEFAULT 0.1 NOT NULL;