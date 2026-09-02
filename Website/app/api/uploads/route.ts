import { env } from "cloudflare:workers";
import { ensureCatalog } from "../../../db/catalog";

export async function GET(request:Request){
  try{const db=await ensureCatalog();const itemId=Number(new URL(request.url).searchParams.get("itemId"));const result=await db.prepare(`SELECT im.id,im.object_key,im.filename,im.content_type,im.size,im.sort_order FROM inventory_images im JOIN inventory_items ii ON ii.id=im.item_id WHERE im.item_id=? ORDER BY CASE WHEN im.object_key=ii.primary_image_key THEN 0 ELSE 1 END,im.sort_order,im.id`).bind(itemId).all();return Response.json({images:result.results.map(r=>({...r,url:`/api/media?key=${encodeURIComponent(String((r as Record<string,unknown>).object_key))}`}))});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Images unavailable"},{status:500});}
}

export async function POST(request: Request) {
  try {
    const db=await ensureCatalog();
    const form=await request.formData();
    const file=form.get("file"); const itemId=Number(form.get("itemId"));
    const order=Number(form.get("order")||0); const sourcePath=String(form.get("sourcePath")||"");
    if(!(file instanceof File)||!itemId)return Response.json({error:"file and itemId are required"},{status:400});
    const safe=file.name.replace(/[^a-zA-Z0-9._()-]+/g,"-");
    const key=`items/${itemId}/${String(order).padStart(3,"0")}-${crypto.randomUUID()}-${safe}`;
    await env.UPLOADS.put(key,file.stream(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
    await db.prepare("INSERT INTO inventory_images (item_id,object_key,filename,source_path,content_type,size,sort_order) VALUES (?,?,?,?,?,?,?)").bind(itemId,key,file.name,sourcePath,file.type||"application/octet-stream",file.size,order).run();
    if(order===0) await db.prepare("UPDATE inventory_items SET primary_image_key=?,image_count=(SELECT COUNT(*) FROM inventory_images WHERE item_id=?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(key,itemId,itemId).run();
    else await db.prepare("UPDATE inventory_items SET image_count=(SELECT COUNT(*) FROM inventory_images WHERE item_id=?) WHERE id=?").bind(itemId,itemId).run();
    return Response.json({key,url:`/api/media?key=${encodeURIComponent(key)}`},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Upload failed"},{status:400});}
}

export async function PATCH(request:Request){
  try{
    const db=await ensureCatalog();
    const body=await request.json() as {itemId?:number;imageId?:number};
    const itemId=Number(body.itemId);const imageId=Number(body.imageId);
    if(!itemId||!imageId)return Response.json({error:"itemId and imageId are required"},{status:400});
    const image=await db.prepare("SELECT object_key FROM inventory_images WHERE id=? AND item_id=?").bind(imageId,itemId).first<{object_key:string}>();
    if(!image)return Response.json({error:"Image not found for this item"},{status:404});
    await db.prepare("UPDATE inventory_items SET primary_image_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(image.object_key,itemId).run();
    return Response.json({ok:true,url:`/api/media?key=${encodeURIComponent(image.object_key)}`});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Could not set thumbnail"},{status:400});}
}

export async function DELETE(request:Request){
  try{
    const db=await ensureCatalog();const url=new URL(request.url);const itemId=Number(url.searchParams.get("itemId"));const imageId=Number(url.searchParams.get("id"));
    if(!itemId||!imageId)return Response.json({error:"itemId and image id are required"},{status:400});
    const image=await db.prepare(`SELECT im.object_key,ii.primary_image_key FROM inventory_images im JOIN inventory_items ii ON ii.id=im.item_id WHERE im.id=? AND im.item_id=?`).bind(imageId,itemId).first<{object_key:string;primary_image_key:string|null}>();
    if(!image)return Response.json({error:"Image not found for this product"},{status:404});
    const primaryKey=image.primary_image_key||"";
    if(primaryKey===image.object_key)return Response.json({error:"Choose another default thumbnail before deleting this image"},{status:409});
    await db.batch([
      db.prepare("DELETE FROM inventory_images WHERE id=? AND item_id=?").bind(imageId,itemId),
      db.prepare("UPDATE inventory_items SET primary_image_key=?,image_count=(SELECT COUNT(*) FROM inventory_images WHERE item_id=?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(primaryKey||null,itemId,itemId),
    ]);
    await env.UPLOADS.delete(image.object_key);
    return Response.json({ok:true,primaryUrl:primaryKey?`/api/media?key=${encodeURIComponent(primaryKey)}`:""});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Could not delete image"},{status:400})}
}
