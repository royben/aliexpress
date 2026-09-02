import { env } from "cloudflare:workers";
import { strToU8, zipSync } from "fflate";
import { ensureCatalog } from "../../../db/catalog";

function safeName(value: string, fallback: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 140);
  return cleaned || fallback;
}

function uniqueName(folder: string, filename: string, used: Set<string>) {
  const safe = safeName(filename, "file");
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  let candidate = `${folder}/${safe}`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${folder}/${stem}-${suffix}${extension}`;
    suffix++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function stringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const itemId = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!itemId)
      return Response.json({ error: "A valid item is required" }, { status: 400 });

    const db = await ensureCatalog();
    const [item, imageResult, attachmentResult] = await Promise.all([
      db
        .prepare(
          `SELECT i.*,l.name AS location_name
           FROM inventory_items i
           LEFT JOIN inventory_locations l ON l.id=i.location_id
           WHERE i.id=?`,
        )
        .bind(itemId)
        .first<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT im.id,im.object_key,im.filename,im.source_path,im.content_type,im.size,im.sort_order,
                  CASE WHEN im.object_key=ii.primary_image_key THEN 1 ELSE 0 END AS is_default
           FROM inventory_images im
           JOIN inventory_items ii ON ii.id=im.item_id
           WHERE im.item_id=?
           ORDER BY is_default DESC,im.sort_order,im.id`,
        )
        .bind(itemId)
        .all(),
      db
        .prepare(
          "SELECT id,object_key,filename,content_type,size,created_at FROM inventory_attachments WHERE item_id=? ORDER BY created_at,id",
        )
        .bind(itemId)
        .all(),
    ]);

    if (!item)
      return Response.json({ error: "Item not found" }, { status: 404 });

    const taxonomy = await db
      .prepare(
        "SELECT raw_category,raw_tags FROM inventory_original_taxonomy WHERE source=? AND source_record_id=?",
      )
      .bind(item.source, item.source_record_id)
      .first<Record<string, unknown>>();
    const images = imageResult.results as Record<string, unknown>[];
    const attachments = attachmentResult.results as Record<string, unknown>[];
    const tags = stringArray(item.tags);
    const originalTags = stringArray(taxonomy?.raw_tags);

    const details = {
      exported_at: new Date().toISOString(),
      item: {
        id: item.id,
        serial: item.serial,
        name: item.title,
        source_name: item.source_title,
        description: item.description,
        original_description: item.plain_description,
        category: item.category,
        original_category: taxonomy?.raw_category || "",
        tags,
        original_tags: originalTags,
        price: item.price_text,
        currency: item.currency,
        quantity: item.quantity,
        source: item.source,
        source_record_id: item.source_record_id,
        serial_number: item.serial,
        location: item.location_name || "Not assigned",
        location_id: item.location_id,
        status: item.status,
        notes: item.notes,
        original_html_path: item.original_html_path,
        original_resource_path: item.original_resource_path,
        created_at: item.created_at,
        updated_at: item.updated_at,
      },
      images: images.map((image) => ({
        filename: image.filename,
        content_type: image.content_type,
        size: image.size,
        is_default: Boolean(image.is_default),
        original_source_path: image.source_path,
      })),
      attachments: attachments.map((attachment) => ({
        filename: attachment.filename,
        content_type: attachment.content_type,
        size: attachment.size,
        created_at: attachment.created_at,
      })),
    };

    const markdown = `# ${String(item.title || "Inventory item")}\n\n` +
      `- **Serial number:** ${item.serial}\n` +
      `- **Category:** ${item.category}\n` +
      `- **Tags:** ${tags.length ? tags.join(", ") : "None"}\n` +
      `- **Source:** ${item.source}\n` +
      `- **Price:** ${item.price_text || "No price recorded"}\n` +
      `- **Quantity:** ${item.quantity}\n` +
      `- **Location:** ${item.location_name || "Not assigned"}\n` +
      `- **Images:** ${images.length}\n` +
      `- **Attachments:** ${attachments.length}\n\n` +
      `## Description\n\n${item.description || "No description recorded."}\n`;

    const files: Record<string, Uint8Array> = {
      "item-details.json": strToU8(JSON.stringify(details, null, 2)),
      "item-details.md": strToU8(markdown),
    };
    const used = new Set(Object.keys(files).map((name) => name.toLowerCase()));

    for (const image of images) {
      const object = await env.UPLOADS.get(String(image.object_key));
      if (!object) continue;
      files[uniqueName("images", String(image.filename), used)] = new Uint8Array(
        await object.arrayBuffer(),
      );
    }
    for (const attachment of attachments) {
      const object = await env.UPLOADS.get(String(attachment.object_key));
      if (!object) continue;
      files[uniqueName("attachments", String(attachment.filename), used)] =
        new Uint8Array(await object.arrayBuffer());
    }

    const archive = zipSync(files, { level: 0 });
    const filename = `${String(item.serial)}-${safeName(String(item.title), "item")}.zip`;
    return new Response(archive, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not export item" },
      { status: 500 },
    );
  }
}
