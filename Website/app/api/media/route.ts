import { env } from "cloudflare:workers";

export async function GET(request:Request){
  const key=new URL(request.url).searchParams.get("key");
  if(!key)return new Response("Missing key",{status:400});
  const object=await env.UPLOADS.get(key);
  if(!object)return new Response("Not found",{status:404});
  const headers=new Headers(); object.writeHttpMetadata(headers); headers.set("etag",object.httpEtag); headers.set("cache-control","public, max-age=31536000, immutable");
  return new Response(object.body,{headers});
}
