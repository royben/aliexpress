import { env } from "cloudflare:workers";
import {
  ensureCatalog,
  ensureItemTags,
  itemFromRow,
  nextInventorySerial,
} from "../../../db/catalog";

export async function GET(request: Request) {
  try {
    const db = await ensureCatalog();
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() || "";
    const source = url.searchParams.get("source") || "";
    const status = url.searchParams.get("status") || "";
    const id = Number(url.searchParams.get("id") || 0);
    const limit = Math.min(
      1000,
      Math.max(1, Number(url.searchParams.get("limit") || 1000)),
    );
    const result = await db
      .prepare(
        `SELECT i.*, l.name AS location_name
      FROM inventory_items i LEFT JOIN inventory_locations l ON l.id=i.location_id
      WHERE (?=0 OR i.id=?) AND (?='' OR i.source=?) AND (?='' OR i.status=?)
        AND (?='' OR i.title LIKE '%' || ? || '%' OR i.tags LIKE '%' || ? || '%' OR i.serial LIKE '%' || ? || '%')
      ORDER BY i.updated_at DESC, i.id DESC LIMIT ?`,
      )
      .bind(
        id,
        id,
        source,
        source,
        status,
        status,
        query,
        query,
        query,
        query,
        limit,
      )
      .all();
    return Response.json({
      items: result.results.map((r) =>
        itemFromRow(r as Record<string, unknown>),
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Inventory unavailable",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const db = await ensureCatalog();
    const p = (await request.json()) as Record<string, unknown>;
    const source = String(p.source || "Manual");
    const recordId = String(p.sourceRecordId || crypto.randomUUID());
    const serial = await nextInventorySerial(db);
    const quantity = Math.max(0, Math.floor(Number(p.quantity ?? 1)) || 0);
    const itemTags = ensureItemTags(p.tags, p.title, p.description, p.category);
    const result = await db
      .prepare(
        `INSERT INTO inventory_items
      (serial,source,source_record_id,title,source_title,description,plain_description,category,price_text,currency,quantity,tags,suggested_projects,status,notes,location_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      )
      .bind(
        serial,
        source,
        recordId,
        p.title || "Untitled item",
        p.title || "",
        p.description || "",
        p.description || "",
        p.category || "Uncategorized",
        p.price || "",
        p.currency || "",
        quantity,
        JSON.stringify(itemTags),
        JSON.stringify(p.suggestedProjects || []),
        p.status || "Unsorted",
        p.notes || "",
        p.locationId || null,
      )
      .first();
    return Response.json(
      { item: itemFromRow(result as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not add item" },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const db = await ensureCatalog();
    const p = (await request.json()) as Record<string, unknown>;
    const id = Number(p.id);
    const title = String(p.title || "").trim();
    const description = String(p.description || "").trim();
    const category = String(p.category || "").trim();
    const priceText = String(p.priceText || "").trim();
    const tags = ensureItemTags(p.tags, title, description, category);
    if (!id || !title || !category)
      return Response.json(
        { error: "Product name and category are required" },
        { status: 400 },
      );
    await db
      .prepare(
        "UPDATE inventory_items SET title=?,description=?,category=?,tags=?,price_text=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(title, description, category, JSON.stringify(tags), priceText, id)
      .run();
    return Response.json({
      ok: true,
      item: { title, description, category, tags, price_text: priceText },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not update item",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const db = await ensureCatalog();
    const p = (await request.json()) as Record<string, unknown>;
    const id = Number(p.id);
    if (!id)
      return Response.json(
        { error: "A valid item is required" },
        { status: 400 },
      );
    if (Object.prototype.hasOwnProperty.call(p, "quantity")) {
      const quantity = Number(p.quantity);
      if (!Number.isInteger(quantity) || quantity < 0)
        return Response.json(
          { error: "Quantity must be a whole number of zero or more" },
          { status: 400 },
        );
      await db
        .prepare(
          "UPDATE inventory_items SET quantity=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(quantity, id)
        .run();
      return Response.json({ ok: true, quantity });
    }
    if (Object.prototype.hasOwnProperty.call(p, "locationId")) {
      const locationId =
        p.locationId === null || p.locationId === ""
          ? null
          : Number(p.locationId);
      if (
        locationId !== null &&
        (!Number.isInteger(locationId) || locationId < 1)
      )
        return Response.json(
          { error: "A valid location is required" },
          { status: 400 },
        );
      const location =
        locationId === null
          ? null
          : await db
              .prepare("SELECT id,name FROM inventory_locations WHERE id=?")
              .bind(locationId)
              .first<{ id: number; name: string }>();
      if (locationId !== null && !location)
        return Response.json({ error: "Location not found" }, { status: 404 });
      await db
        .prepare(
          "UPDATE inventory_items SET location_id=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(locationId, locationId === null ? "Unsorted" : "Stored", id)
        .run();
      return Response.json({
        ok: true,
        locationId,
        location: location?.name || "Unsorted",
      });
    }
    return Response.json(
      { error: "No supported change was provided" },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not update item",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const db = await ensureCatalog();
    const id = Number(new URL(request.url).searchParams.get("id"));
    const [images, attachments] = await Promise.all([
      db
        .prepare("SELECT object_key FROM inventory_images WHERE item_id=?")
        .bind(id)
        .all(),
      db
        .prepare("SELECT object_key FROM inventory_attachments WHERE item_id=?")
        .bind(id)
        .all(),
    ]);
    await Promise.all(
      [...images.results, ...attachments.results].map((r) =>
        env.UPLOADS.delete(String((r as Record<string, unknown>).object_key)),
      ),
    );
    await db.batch([
      db.prepare("DELETE FROM inventory_images WHERE item_id=?").bind(id),
      db.prepare("DELETE FROM inventory_attachments WHERE item_id=?").bind(id),
      db.prepare("DELETE FROM inventory_items WHERE id=?").bind(id),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not delete item",
      },
      { status: 400 },
    );
  }
}
