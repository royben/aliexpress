CREATE TABLE `inventory_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_attachments_object_key_unique` ON `inventory_attachments` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_inventory_attachments_item` ON `inventory_attachments` (`item_id`,`created_at`);