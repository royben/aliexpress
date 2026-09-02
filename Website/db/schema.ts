import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const locations = sqliteTable("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serial: text("serial").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("Other"),
  source: text("source").notNull().default("Manual"),
  sourceUrl: text("source_url"),
  sourceRecordId: text("source_record_id"),
  location: text("location").notNull().default("Unsorted"),
  locationId: integer("location_id"),
  quantity: integer("quantity").notNull().default(1),
  status: text("status").notNull().default("Needs review"),
  image: text("image").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  confidence: integer("confidence"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull(),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const inventoryItems = sqliteTable(
  "inventory_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serial: text("serial").notNull().unique(),
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    title: text("title").notNull(),
    sourceTitle: text("source_title").notNull().default(""),
    description: text("description").notNull().default(""),
    plainDescription: text("plain_description").notNull().default(""),
    category: text("category").notNull().default("Uncategorized"),
    priceText: text("price_text").notNull().default(""),
    currency: text("currency").notNull().default(""),
    quantity: integer("quantity").notNull().default(1),
    tags: text("tags").notNull().default("[]"),
    suggestedProjects: text("suggested_projects").notNull().default("[]"),
    originalHtmlPath: text("original_html_path").notNull().default(""),
    originalResourcePath: text("original_resource_path").notNull().default(""),
    primaryImageKey: text("primary_image_key"),
    imageCount: integer("image_count").notNull().default(0),
    status: text("status").notNull().default("Unsorted"),
    locationId: integer("location_id"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_inventory_items_source_record").on(
      table.source,
      table.sourceRecordId,
    ),
    index("idx_inventory_items_source_status").on(table.source, table.status),
    index("idx_inventory_items_location").on(table.locationId),
  ],
);

export const inventoryImages = sqliteTable(
  "inventory_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id").notNull(),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    sourcePath: text("source_path").notNull().default(""),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_inventory_images_item").on(table.itemId, table.sortOrder),
  ],
);

export const inventoryAttachments = sqliteTable(
  "inventory_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id").notNull(),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_inventory_attachments_item").on(table.itemId, table.createdAt),
  ],
);

export const inventoryLocations = sqliteTable("inventory_locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const inventoryOriginalTaxonomy = sqliteTable(
  "inventory_original_taxonomy",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    rawCategory: text("raw_category").notNull().default(""),
    rawTags: text("raw_tags").notNull().default("[]"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_inventory_original_taxonomy_source_record").on(
      table.source,
      table.sourceRecordId,
    ),
  ],
);
