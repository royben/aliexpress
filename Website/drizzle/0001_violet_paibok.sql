CREATE TABLE `inventory_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`source_path` text DEFAULT '' NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_images_object_key_unique` ON `inventory_images` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_inventory_images_item` ON `inventory_images` (`item_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`serial` text NOT NULL,
	`source` text NOT NULL,
	`source_record_id` text NOT NULL,
	`title` text NOT NULL,
	`source_title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`plain_description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'Uncategorized' NOT NULL,
	`price_text` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`suggested_projects` text DEFAULT '[]' NOT NULL,
	`original_html_path` text DEFAULT '' NOT NULL,
	`original_resource_path` text DEFAULT '' NOT NULL,
	`primary_image_key` text,
	`image_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Unsorted' NOT NULL,
	`location_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_serial_unique` ON `inventory_items` (`serial`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_items_source_record` ON `inventory_items` (`source`,`source_record_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_items_source_status` ON `inventory_items` (`source`,`status`);--> statement-breakpoint
CREATE INDEX `idx_inventory_items_location` ON `inventory_items` (`location_id`);--> statement-breakpoint
CREATE TABLE `inventory_locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
