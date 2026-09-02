import { env } from "cloudflare:workers";
import { ensureCatalog } from "../../../../db/catalog";

export async function POST(request:Request){
  const url=new URL(request.url); const action=url.searchParams.get("action");
  if(action==="init"){
    const p=await request.json() as {itemId:number;filename:string;order:number;contentType:string};
    const safe=p.filename.replace(/[^a-zA-Z0-9._()-]+/g,"-");
    const key=`items/${p.itemId}/${String(p.order).padStart(3,"0")}-${crypto.randomUUID()}-${safe}`;
    const upload=await env.UPLOADS.createMultipartUpload(key,{httpMetadata:{contentType:p.contentType}});
    return Response.json({key,uploadId:upload.uploadId});
  }
  if(action==="complete"){
    const p=await request.json() as {key:string;uploadId:string;parts:R2UploadedPart[];itemId:number;filename:string;sourcePath:string;contentType:string;size:number;order:number};
    const upload=env.UPLOADS.resumeMultipartUpload(p.key,p.uploadId); await upload.complete(p.parts);
    const db=await ensureCatalog();
    await db.prepare("INSERT INTO inventory_images (item_id,object_key,filename,source_path,content_type,size,sort_order) VALUES (?,?,?,?,?,?,?)").bind(p.itemId,p.key,p.filename,p.sourcePath,p.contentType,p.size,p.order).run();
    if(p.order===0)await db.prepare("UPDATE inventory_items SET primary_image_key=?,image_count=(SELECT COUNT(*) FROM inventory_images WHERE item_id=?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(p.key,p.itemId,p.itemId).run();
    else await db.prepare("UPDATE inventory_items SET image_count=(SELECT COUNT(*) FROM inventory_images WHERE item_id=?) WHERE id=?").bind(p.itemId,p.itemId).run();
    return Response.json({key:p.key});
  }
  return Response.json({error:"Unknown multipart action"},{status:400});
}

export async function PUT(request:Request){
  const url=new URL(request.url); const key=url.searchParams.get("key"); const uploadId=url.searchParams.get("uploadId"); const partNumber=Number(url.searchParams.get("partNumber"));
  if(!key||!uploadId||!partNumber||!request.body)return Response.json({error:"Missing part parameters"},{status:400});
  const upload=env.UPLOADS.resumeMultipartUpload(key,uploadId); const part=await upload.uploadPart(partNumber,request.body); return Response.json(part);
}
