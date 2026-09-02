import { env } from "cloudflare:workers";
import { ensureCatalog, itemFromRow } from "../../../db/catalog";

type Analysis = {
  likely_name:string;
  category:string;
  description:string;
  visible_text:string[];
  markings:string[];
  visual_features:string[];
  search_terms:string[];
  marketplace_search_query:string;
  confidence:number;
};

type InventoryRow = Record<string,unknown> & {id:number;primary_image_key?:string|null};

const analysisSchema={
  type:"object",additionalProperties:false,
  required:["likely_name","category","description","visible_text","markings","visual_features","search_terms","marketplace_search_query","confidence"],
  properties:{
    likely_name:{type:"string"},category:{type:"string"},description:{type:"string"},
    visible_text:{type:"array",items:{type:"string"}},markings:{type:"array",items:{type:"string"}},
    visual_features:{type:"array",items:{type:"string"}},search_terms:{type:"array",items:{type:"string"}},
    marketplace_search_query:{type:"string"},
    confidence:{type:"integer",minimum:0,maximum:100},
  },
};

const matchSchema={
  type:"object",additionalProperties:false,required:["matches","no_match_reason"],
  properties:{
    matches:{type:"array",minItems:1,maxItems:6,items:{type:"object",additionalProperties:false,required:["item_id","confidence","reason","similarities","differences"],properties:{item_id:{type:"integer"},confidence:{type:"integer",minimum:0,maximum:100},reason:{type:"string"},similarities:{type:"array",items:{type:"string"}},differences:{type:"array",items:{type:"string"}}}}},
    no_match_reason:{type:"string"},
  },
};

function apiKey(){
  const workerEnv=env as unknown as Record<string,unknown>;
  return String(workerEnv.OPENAI_API_KEY||process.env.OPENAI_API_KEY||"").trim();
}

async function openAI(body:Record<string,unknown>){
  const key=apiKey();if(!key)throw new Error("OPENAI_API_KEY is not configured on the server");
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok){const detail=(data.error as Record<string,unknown>|undefined)?.message;throw new Error(String(detail||`OpenAI request failed (${response.status})`))}
  return data;
}

function outputText(response:Record<string,unknown>){
  if(typeof response.output_text==="string")return response.output_text;
  const output=Array.isArray(response.output)?response.output as Array<Record<string,unknown>>:[];
  return output.flatMap(item=>Array.isArray(item.content)?item.content as Array<Record<string,unknown>>:[]).map(part=>typeof part.text==="string"?part.text:"").join("");
}

function parseJson<T>(response:Record<string,unknown>):T{
  const text=outputText(response).trim();
  try{return JSON.parse(text) as T}catch{throw new Error("The identification model returned an unreadable result")}
}

const ignoredTerms=new Set(["and","the","for","with","from","this","that","item","device","component","electronic","electronics","module","board","pcb","small","black","white","blue","green","red","metal","plastic","pin","pins","connector","connectors","control","kit","diy","style"]);
function tokenize(value:string){return [...new Set(value.toLowerCase().replace(/[^a-z0-9+.-]+/g," ").split(/\s+/).filter(word=>word.length>2&&!ignoredTerms.has(word)&&!/^\d+$/.test(word)))]}

function scoreCandidate(row:InventoryRow,analysis:Analysis,idf:Map<string,number>){
  const title=String(row.title||"").toLowerCase();const sourceTitle=String(row.source_title||"").toLowerCase();
  const description=String(row.plain_description||row.description||"").toLowerCase();const category=String(row.category||"").toLowerCase();const tags=String(row.tags||"").toLowerCase();
  const strong=[...analysis.markings,...analysis.visible_text].flatMap(tokenize);
  const general=tokenize([analysis.likely_name,...analysis.search_terms].join(" "));
  let score=0;
  for(const term of strong){const weight=idf.get(term)||1;if(title.includes(term))score+=18*weight;if(sourceTitle.includes(term))score+=12*weight;if(tags.includes(term))score+=7*weight;if(description.includes(term))score+=2*weight}
  for(const term of general){const weight=idf.get(term)||1;if(title.includes(term))score+=10*weight;if(sourceTitle.includes(term))score+=7*weight;if(tags.includes(term))score+=5*weight;if(category.includes(term))score+=3*weight;if(description.includes(term))score+=weight}
  const nameTokens=tokenize(analysis.likely_name);for(let index=0;index<nameTokens.length-1;index++){const phrase=`${nameTokens[index]} ${nameTokens[index+1]}`;if(title.includes(phrase)||sourceTitle.includes(phrase))score+=28}
  if(analysis.category&&category===analysis.category.toLowerCase())score+=10;
  return score;
}

function bytesToBase64(bytes:Uint8Array){let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary)}

async function candidateImage(row:InventoryRow){
  const key=String(row.primary_image_key||"");if(!key)return null;
  const object=await env.UPLOADS.get(key);if(!object||object.size>3_500_000)return null;
  const type=object.httpMetadata?.contentType||"image/jpeg";if(!type.startsWith("image/"))return null;
  const bytes=new Uint8Array(await object.arrayBuffer());
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

async function openAIWebSearch(image:string,analysis?:Analysis){
  const model=String((env as unknown as Record<string,unknown>).OPENAI_MODEL||process.env.OPENAI_MODEL||"gpt-5.6-terra");
  const response=await openAI({model,store:false,tools:[{type:"web_search"}],input:[{role:"user",content:[{type:"input_text",text:`Identify what this home-lab item actually is and what it is used for. The owner mainly buys inexpensive, generic, unbranded, or cloned products from AliExpress and Temu. Do not anchor on a famous brand merely because a branded product looks similar. State an exact brand or catalog number only when supported by clearly readable markings or uniquely identifying evidence in the photographed item; otherwise use the generic product name and explicitly describe uncertainty.

Search for generic marketplace terminology, common variants, likely specifications, functions, connections, and practical ways the owner can verify the identification. Manufacturer documentation may be used as supporting technical evidence, but finding a branded equivalent is not the goal.

Format the answer in Markdown with these useful sections when applicable: What it is, What it does, Identifying features, Likely specifications or variants, and Search terms. Do not put URLs, Markdown links, citations, domain names, or parenthetical source references inside the answer. The application provides a separate Google marketplace search instead.

Existing visual analysis: ${JSON.stringify(analysis||{})}`},{type:"input_image",image_url:image,detail:"high"}]}]});
  const text=outputText(response).replace(/\(\s*(?:\r?\n\s*)?\[[^\]]+\]\(https?:\/\/[^)]+\)(?:\s*\r?\n)?\s*\)/gi,"").replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi,"$1").replace(/\n{3,}/g,"\n\n").trim();
  return {provider:"AI product analysis",text};
}

export async function POST(request:Request){
  try{
    const body=await request.json() as {image?:string;webSearch?:boolean;analysis?:Analysis};
    const image=String(body.image||"");
    if(!image.startsWith("data:image/"))return Response.json({error:"A captured image is required"},{status:400});
    if(image.length>12_000_000)return Response.json({error:"The selected image is too large"},{status:413});
    if(body.webSearch){const web=await openAIWebSearch(image,body.analysis);return Response.json({web})}
    const model=String((env as unknown as Record<string,unknown>).OPENAI_MODEL||process.env.OPENAI_MODEL||"gpt-5.6-terra");
    const first=await openAI({model,store:false,input:[{role:"user",content:[{type:"input_text",text:"Analyze this isolated home-lab item for inventory identification. Read all visible text exactly. Do not invent markings. Describe connectors, package, color, shape, pin count, and likely function. Also produce marketplace_search_query: the single best concise Google search phrase for finding this product on AliExpress, Temu, or Amazon. Prefer generic marketplace terminology over an unsupported brand, include clearly visible model numbers or distinctive specifications, use 4 to 10 words, and do not include site names, search operators, quotes, or explanations. Return the requested structured data."},{type:"input_image",image_url:image,detail:"high"}]}],text:{format:{type:"json_schema",name:"item_visual_analysis",strict:true,schema:analysisSchema}}});
    const analysis=parseJson<Analysis>(first);

    const db=await ensureCatalog();
    const result=await db.prepare(`SELECT i.*,l.name AS location_name FROM inventory_items i LEFT JOIN inventory_locations l ON l.id=i.location_id ORDER BY i.id`).all();
    const rows=result.results as InventoryRow[];
    const queryTerms=tokenize([analysis.likely_name,...analysis.search_terms,...analysis.markings,...analysis.visible_text].join(" "));
    const idf=new Map<string,number>();for(const term of queryTerms){let documents=0;for(const row of rows){const searchable=`${row.title||""} ${row.source_title||""} ${row.category||""} ${row.tags||""} ${row.plain_description||row.description||""}`.toLowerCase();if(searchable.includes(term))documents++}idf.set(term,Math.log((rows.length+1)/(documents+1))+1)}
    const ranked=rows.map(row=>({row,score:scoreCandidate(row,analysis,idf)})).sort((a,b)=>b.score-a.score).slice(0,10);
    const visualCandidates=[] as Array<{row:InventoryRow;image:string|null;score:number}>;
    for(const candidate of ranked.slice(0,8))visualCandidates.push({...candidate,image:await candidateImage(candidate.row)});

    const content:Array<Record<string,unknown>>=[{type:"input_text",text:`Compare the unknown item to these inventory candidates. Return the best candidates even when confidence is low, with honest confidence scores and clear differences; never turn uncertainty into a high score. A high confidence requires strong visual agreement, not merely a similar category. Return item_id values exactly as supplied. Unknown-item analysis: ${JSON.stringify(analysis)}`},{type:"input_image",image_url:image,detail:"high"}];
    for(const candidate of visualCandidates){
      content.push({type:"input_text",text:`Candidate item_id=${candidate.row.id}; serial=${candidate.row.serial}; title=${candidate.row.title}; category=${candidate.row.category}; tags=${candidate.row.tags}; description=${String(candidate.row.plain_description||candidate.row.description||"").slice(0,900)}; metadata_score=${candidate.score}`});
      if(candidate.image)content.push({type:"input_image",image_url:candidate.image,detail:"low"});
    }
    const second=await openAI({model,store:false,input:[{role:"user",content}],text:{format:{type:"json_schema",name:"inventory_visual_matches",strict:true,schema:matchSchema}}});
    const judged=parseJson<{matches:Array<{item_id:number;confidence:number;reason:string;similarities:string[];differences:string[]}>;no_match_reason:string}>(second);
    const rowsById=new Map(visualCandidates.map(candidate=>[Number(candidate.row.id),candidate.row]));
    const matches=judged.matches.filter(match=>rowsById.has(match.item_id)).sort((a,b)=>b.confidence-a.confidence).map(match=>({...match,item:itemFromRow(rowsById.get(match.item_id)!)}));
    return Response.json({analysis,matches,noMatchReason:judged.no_match_reason,model});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Identification failed"},{status:500})}
}
