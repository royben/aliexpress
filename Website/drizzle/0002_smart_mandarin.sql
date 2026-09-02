CREATE TABLE `inventory_original_taxonomy` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_record_id` text NOT NULL,
	`raw_category` text DEFAULT '' NOT NULL,
	`raw_tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_original_taxonomy_source_record` ON `inventory_original_taxonomy` (`source`,`source_record_id`);