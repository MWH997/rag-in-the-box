PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tenant_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`tier` text DEFAULT 'free' NOT NULL,
	`embedding_provider` text DEFAULT 'workers-ai' NOT NULL,
	`embedding_model` text DEFAULT '@cf/baai/bge-small-en-v1.5' NOT NULL,
	`chat_provider` text DEFAULT 'workers-ai' NOT NULL,
	`chat_model` text DEFAULT '@cf/meta/llama-4-scout-17b-16e-instruct' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`context_char_budget` integer DEFAULT 9000 NOT NULL,
	`max_answer_tokens` integer DEFAULT 700 NOT NULL,
	`temperature` real DEFAULT 0.1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tenant_settings`("tenant_id", "tier", "embedding_provider", "embedding_model", "chat_provider", "chat_model", "system_prompt", "context_char_budget", "max_answer_tokens", "temperature", "updated_at") SELECT "tenant_id", "tier", "embedding_provider", "embedding_model", "chat_provider", "chat_model", "system_prompt", "context_char_budget", "max_answer_tokens", "temperature", "updated_at" FROM `tenant_settings`;--> statement-breakpoint
DROP TABLE `tenant_settings`;--> statement-breakpoint
ALTER TABLE `__new_tenant_settings` RENAME TO `tenant_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;