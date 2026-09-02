import { env } from "cloudflare:workers";
import { ensureCatalog } from "../../../db/catalog";

export async function GET(request: Request) {
  try {
    const db = await ensureCatalog();
    const url = new URL(request.url);
    const downloadId = Number(url.searchParams.get("download") || 0);
    if (downloadId) {
      const attachment = await db
        .prepare(
          "SELECT object_key,filename,content_type FROM inventory_attachments WHERE id=?",
        )
        .bind(downloadId)
        .first<{
          object_key: string;
          filename: string;
          content_type: string;
        }>();
      if (!attachment)
        return new Response("Attachment not found", { status: 404 });
      const object = await env.UPLOADS.get(attachment.object_key);
      if (!object)
        return new Response("Stored file not found", { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set(
        "content-type",
        attachment.content_type || "application/octet-stream",
      );
      headers.set(
        "content-disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      );
      headers.set("cache-control", "private, no-store");
      return new Response(object.body, { headers });
    }
    const itemId = Number(url.searchParams.get("itemId") || 0);
    if (!itemId)
      return Response.json({ error: "itemId is required" }, { status: 400 });
    const result = await db
      .prepare(
        "SELECT id,item_id,filename,content_type,size,created_at FROM inventory_attachments WHERE item_id=? ORDER BY created_at DESC,id DESC",
      )
      .bind(itemId)
      .all();
    return Response.json({
      attachments: result.results.map((row) => ({
        ...row,
        url: `/api/attachments?download=${(row as Record<string, unknown>).id}`,
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Attachments unavailable",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const db = await ensureCatalog();
    const form = await request.formData();
    const file = form.get("file");
    const itemId = Number(form.get("itemId") || 0);
    if (!(file instanceof File) || !itemId)
      return Response.json(
        { error: "file and itemId are required" },
        { status: 400 },
      );
    if (file.size > 25 * 1024 * 1024)
      return Response.json(
        { error: "Attachments must be 25 MB or smaller" },
        { status: 400 },
      );
    const item = await db
      .prepare("SELECT id FROM inventory_items WHERE id=?")
      .bind(itemId)
      .first();
    if (!item)
      return Response.json({ error: "Item not found" }, { status: 404 });
    const safe =
      file.name.replace(/[^a-zA-Z0-9._()-]+/g, "-").slice(-120) || "attachment";
    const key = `attachments/${itemId}/${crypto.randomUUID()}-${safe}`;
    await env.UPLOADS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    try {
      const attachment = await db
        .prepare(
          "INSERT INTO inventory_attachments (item_id,object_key,filename,content_type,size) VALUES (?,?,?,?,?) RETURNING id,item_id,filename,content_type,size,created_at",
        )
        .bind(
          itemId,
          key,
          file.name,
          file.type || "application/octet-stream",
          file.size,
        )
        .first();
      return Response.json(
        {
          attachment: {
            ...attachment,
            url: `/api/attachments?download=${(attachment as Record<string, unknown>).id}`,
          },
        },
        { status: 201 },
      );
    } catch (error) {
      await env.UPLOADS.delete(key);
      throw error;
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Attachment upload failed",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const db = await ensureCatalog();
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!id)
      return Response.json(
        { error: "Attachment id is required" },
        { status: 400 },
      );
    const attachment = await db
      .prepare("SELECT object_key FROM inventory_attachments WHERE id=?")
      .bind(id)
      .first<{ object_key: string }>();
    if (!attachment)
      return Response.json({ error: "Attachment not found" }, { status: 404 });
    await env.UPLOADS.delete(attachment.object_key);
    await db
      .prepare("DELETE FROM inventory_attachments WHERE id=?")
      .bind(id)
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not delete attachment",
      },
      { status: 400 },
    );
  }
}
