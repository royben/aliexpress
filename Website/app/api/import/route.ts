import { ensureCatalog, nextInventorySerial } from "../../../db/catalog";

type ImportedItem = {
  serial:string; source:string; sourceRecordId:string; title:string; sourceTitle?:string;
  description?:string; plainDescription?:string; category?:string; priceText?:string;
  currency?:string; quantity?:number; tags?:string[]; suggestedProjects?:string[];
  originalHtmlPath?:string; originalResourcePath?:string;
  rawCategory?:string; rawTags?:string[];
};

export async function GET(){
  try{const db=await ensureCatalog();const counts=await db.prepare("SELECT (SELECT COUNT(*) FROM inventory_items) AS items, (SELECT COUNT(*) FROM inventory_images) AS images").first();const paths=await db.prepare("SELECT source_path FROM inventory_images").all();return Response.json({counts,sourcePaths:paths.results.map(r=>String((r as Record<string,unknown>).source_path))});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Status unavailable"},{status:500});}
}

export async function POST(request: Request) {
  try {
    const db=await ensureCatalog();
    const url=new URL(request.url);
    if(url.searchParams.get("reset")==="1") await db.batch([db.prepare("DELETE FROM inventory_images"),db.prepare("DELETE FROM inventory_items")]);
    const payload=await request.json() as {items:ImportedItem[]};
    const imported:Array<{sourceRecordId:string;id:number;serial:string}> = [];
    for(const p of payload.items||[]) {
      const existing=await db.prepare("SELECT id,serial FROM inventory_items WHERE source=? AND source_record_id=?").bind(p.source,p.sourceRecordId).first<{id:number;serial:string}>();
      const serial=existing?.serial||await nextInventorySerial(db);
      await db.prepare(`INSERT INTO inventory_original_taxonomy (source,source_record_id,raw_category,raw_tags) VALUES (?,?,?,?)
        ON CONFLICT(source,source_record_id) DO UPDATE SET raw_category=excluded.raw_category,raw_tags=excluded.raw_tags`)
        .bind(p.source,p.sourceRecordId,p.rawCategory||"",JSON.stringify(p.rawTags||[])).run();
      await db.prepare(`INSERT INTO inventory_items
        (serial,source,source_record_id,title,source_title,description,plain_description,category,price_text,currency,quantity,tags,suggested_projects,original_html_path,original_resource_path,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(source,source_record_id) DO UPDATE SET title=excluded.title,source_title=excluded.source_title,description=excluded.description,plain_description=excluded.plain_description,category=excluded.category,price_text=excluded.price_text,currency=excluded.currency,quantity=excluded.quantity,tags=excluded.tags,suggested_projects=excluded.suggested_projects,original_html_path=excluded.original_html_path,original_resource_path=excluded.original_resource_path,updated_at=CURRENT_TIMESTAMP`)
        .bind(serial,p.source,p.sourceRecordId,p.title,p.sourceTitle||p.title,p.description||"",p.plainDescription||"",p.category||"Uncategorized",p.priceText||"",p.currency||"",Math.max(1,p.quantity||1),JSON.stringify(p.tags||[]),JSON.stringify(p.suggestedProjects||[]),p.originalHtmlPath||"",p.originalResourcePath||"","Unsorted").run();
      const row=await db.prepare("SELECT id,serial FROM inventory_items WHERE source=? AND source_record_id=?").bind(p.source,p.sourceRecordId).first<{id:number;serial:string}>();
      if(row) imported.push({sourceRecordId:p.sourceRecordId,id:row.id,serial:row.serial});
    }
    return Response.json({imported});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Import failed"},{status:400});}
}
