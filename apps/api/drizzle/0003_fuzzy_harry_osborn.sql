-- better-auth 1.7 added `issuer` to the account table and a unique index over
-- (issuer, account_id).
--
-- The generated migration was `ALTER TABLE account ADD issuer text NOT NULL`,
-- which SQLite refuses on a table that already holds rows, because every
-- existing row would need a value and NULL is not one. Any deployment with a
-- single account would have failed to migrate.
--
-- So the column arrives with a default, existing rows are backfilled from
-- provider_id, which is what better-auth uses for a credential account, and
-- only then does the unique index go on. Doing the index first would collide
-- with itself across the rows still holding the placeholder.
--
-- The dropped index is redundant: `slug` is declared unique on the column, so
-- organization_slug_unique already enforces it.
DROP INDEX IF EXISTS `organization_slug_uidx`;--> statement-breakpoint
ALTER TABLE `account` ADD `issuer` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `account` SET `issuer` = `provider_id` WHERE `issuer` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uidx` ON `account` (`issuer`,`account_id`);
