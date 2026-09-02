import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import sharp from "sharp";

const root = path.resolve(process.cwd(), "..");
const aliCsv = path.join(root, "Ali Express.csv");
const temuCsv = path.join(root, "Temu.csv");
const aliAssets = path.join(root, "Ali Express Items");
const temuAssets = path.join(root, "Temu Items");
const baseUrl = process.env.PARTS_ATLAS_URL || "http://localhost:3000";
const recordsOnly = process.argv.includes("--records-only");
const largeOnly = process.argv.includes("--large-only");

const splitList = value => String(value || "").split(",").map(x => x.trim()).filter(Boolean);
const stableId = value => createHash("sha1").update(value).digest("hex").slice(0, 20);
const leaf = value => path.basename(String(value || "").replace(/[\\/]+$/, ""));
const integer = value => Math.max(1, Number.parseInt(String(value || "1"), 10) || 1);

const CATEGORY_RULES = [
  ["Automotive", /\b(car|automotive|vehicle|obd|bmw|motorcycle|truck|license plate|dashboard|caravan)\b/i],
  ["Storage & Organization", /\b(storage|organizer|tool bag|parts box|carrying case|drawer|container|enclosure|junction box|project box)\b/i],
  ["Tools & Soldering", /\b(solder(?:ing)?|rework|tool|tweezers?|screwdriver|drill|pliers?|cutter|magnifier|multimeter|tester|caliper|ruler|airbrush|welding iron|heat gun|bench vise)\b/i],
  ["Relays & Controls", /\b(relay|rocker switch|push button|button switch|joystick|keypad|remote control|toggle switch|touch switch|tact(?:ile)? switch)\b/i],
  ["Prototyping & PCBs", /\b(breadboard|protoshield|prototype board|pcb prototype|circuit board)\b/i],
  ["Computing & USB", /\b(usb hub|mouse|keyboard|webcam|laptop|computer|ssd|sata|drawing tablet|card reader|wifi usb adapter|pcie card|ethernet switch|network switch|media player|tv box|surveillance camera)\b/i],
  ["Wireless & Identification", /\b(rfid|nfc|bluetooth tracker|wifi adapter|wireless adapter|antenna|transponder|nrf24|rf transceiver|gps tracker|smart tracker|beacon|wifi repeater|wifi extender)\b/i],
  ["Microcontrollers & Development Boards", /\b(esp32|esp8266|nodemcu|stm32|raspberry pi|development board|microcontroller board|wemos|lilypad|samd21|atmega|io port expander|arduino (uno|nano|mega|pro|starter kit))\b/i],
  ["Displays & Indicators", /\b(oled|lcd|display|screen|indicator|led matrix|digital meter|voltmeter|ammeter)\b/i],
  ["Sensors", /\b(sensor|detector|thermocouple|gyroscope|accelerometer|ultrasonic|barometer|hygrometer|encoder module)\b/i],
  ["Motors & Motion", /\b(motor|servo|stepper|actuator|solenoid|pump|fan|motion controller)\b/i],
  ["Power & Batteries", /\b(power supply|battery|charger|charging|buck|boost|converter|voltage regulator|inverter|power adapter|dc-dc|ac-dc)\b/i],
  ["Audio", /\b(audio|speaker|microphone|headphone|earphone|earbuds?|amplifier|dac|xlr|sound|buzzer)\b/i],
  ["Passive Components", /\b(resistor|capacitor|inductor|potentiometer|thermistor|varistor|rheostat)\b/i],
  ["Semiconductors & ICs", /\b(transistor|mosfet|diode|integrated circuit|\bic\b|op.?amp|logic gate|rectifier|thyristor)\b/i],
  ["LEDs & Lighting", /\b(led|lamp|lighting|light strip|flashlight|bulb|license plate light)\b/i],
  ["Cables & Connectors", /\b(cable|connector|terminal|socket|plug|header|jumper wire|wire kit|wiring harness|adapter cable)\b/i],
  ["Mechanical & Hardware", /\b(screw|nut|bolt|washer|spring|bearing|bracket|hinge|pulley|gear|heatsink|mount|fastener|magnet|acrylic|plexiglass|plastic sheet|pvc sheet|rubber band|basswood)\b/i],
  ["Adhesives & Consumables", /\b(glue|adhesive|tape|flux|heat shrink|filament|cleaner|remover|solder wire)\b/i],
];

const TAG_RULES = [
  ["Arduino", /\barduino\b/i],["ESP32", /\besp32\b/i],["ESP8266", /\besp8266\b/i],["Raspberry Pi", /raspberry pi/i],["STM32", /\bstm32\b/i],
  ["I2C", /\b(i2c|iic)\b/i],["SPI", /\bspi\b/i],["UART", /\b(uart|ttl serial)\b/i],["USB-C", /\b(usb[ -]?c|type[ -]?c)\b/i],["USB", /\busb\b/i],
  ["Bluetooth", /bluetooth/i],["Wi-Fi", /\b(wifi|wi-fi)\b/i],["RFID", /\brfid\b/i],["NFC", /\bnfc\b/i],["CAN bus", /\bcan bus\b/i],["RS-232", /\b(rs-?232|serial port)\b/i],
  ["3.3V", /\b3\.3v\b/i],["5V", /\b5v\b/i],["9V", /\b9v\b/i],["12V", /\b12v\b/i],["24V", /\b24v\b/i],
  ["Waterproof", /waterproof/i],["Rechargeable", /rechargeable/i],["Wireless", /wireless/i],["Portable", /portable/i],
  ["Prototyping", /\b(prototyping|breadboard)\b/i],["Robotics", /robot/i],["Automotive", /\b(car|automotive|vehicle|obd|bmw)\b/i],["Soldering", /solder/i],
  ["Measurement", /\b(measurement|meter|multimeter|caliper|oscilloscope|tester)\b/i],["Woodworking", /woodwork/i],["3D printing", /\b(3d print|filament)\b/i],["CNC", /\bcnc\b/i],
  ["Motor control", /motor (driver|controller|speed)/i],["Battery", /battery/i],["Power regulation", /\b(buck|boost|regulator|converter)\b/i],["Touch", /\b(touch|capacitive)\b/i],
];

function canonicalCategory(row, title){const text=`${title} ${row.item_type||""}`;return CATEGORY_RULES.find(([,pattern])=>pattern.test(text))?.[0]||"Other";}
function canonicalTags(row,title){const text=`${title} ${row.item_type||""}`;return TAG_RULES.filter(([,pattern])=>pattern.test(text)).map(([label])=>label).slice(0,6);}

function normalize(rows, source) {
  return rows.map((row, index) => {
    const sourceName = source === "AliExpress" ? row.item_name : row.product_name;
    const htmlName = source === "AliExpress" ? row.file_name : leaf(row.html_path);
    const resourceName = leaf(row.resource_path);
    const assetRoot = path.join(source === "AliExpress" ? aliAssets : temuAssets, resourceName);
    const imageNames = splitList(source === "AliExpress" ? row.image_urls : row.image_filenames);
    const currency = source === "AliExpress" ? row.currency : (String(row.price || "").match(/[₪$€£]/)?.[0] || "");
    const rawTags=splitList(row.tags);
    return {
      serial: "",
      source,
      sourceRecordId: stableId(`${source}:${htmlName}:${sourceName}`),
      title: sourceName || "Untitled product",
      sourceTitle: sourceName || "",
      description: row.enriched_description || row.plain_description || "",
      plainDescription: row.plain_description || "",
      category: canonicalCategory(row,sourceName),
      priceText: row.price || "",
      currency,
      quantity: integer(row.part_count_estimate_llm || row.parts_count_guess),
      tags: canonicalTags(row,sourceName),
      rawCategory: row.item_type || "",
      rawTags,
      suggestedProjects: splitList(row.suggested_projects),
      originalHtmlPath: path.join(source === "AliExpress" ? aliAssets : temuAssets, htmlName),
      originalResourcePath: assetRoot,
      imagePaths: imageNames.map(name => path.join(assetRoot, name)),
    };
  });
}

async function loadCsv(file) {
  return parse(await readFile(file, "utf8"), {columns:true, skip_empty_lines:true, relax_quotes:true, bom:true});
}

async function postJson(url, body) {
  const response = await fetch(url, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body)});
  if(!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

function mime(file) {
  const ext=path.extname(file).toLowerCase();
  return ({".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp",".gif":"image/gif",".avif":"image/avif"})[ext] || "application/octet-stream";
}

async function upload(itemId, file, order) {
  const info=await stat(file);
  const original=await readFile(file); let bytes=original; let filename=path.basename(file); let contentType=mime(file);
  if(info.size>900*1024){
    bytes=await sharp(original,{animated:false}).resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).webp({quality:78}).toBuffer();
    if(bytes.length>900*1024)bytes=await sharp(original,{animated:false}).resize({width:1200,height:1200,fit:"inside",withoutEnlargement:true}).webp({quality:68}).toBuffer();
    filename=`${path.parse(filename).name}.webp`; contentType="image/webp";
  }
  const form=new FormData();
  form.append("itemId",String(itemId)); form.append("order",String(order)); form.append("sourcePath",file);
  form.append("file",new File([bytes],filename,{type:contentType}));
  const response=await fetch(`${baseUrl}/api/uploads`,{method:"POST",body:form});
  if(!response.ok) throw new Error(`${response.status} ${await response.text()}`);
}

async function uploadMultipart(itemId,file,order,size){
  const contentType=mime(file); const filename=path.basename(file);
  const init=await postJson(`${baseUrl}/api/uploads/multipart?action=init`,{itemId,filename,order,contentType});
  const bytes=await readFile(file); const parts=[]; const chunkSize=6*1024*1024;
  for(let start=0,partNumber=1;start<bytes.length;start+=chunkSize,partNumber++){
    const url=new URL(`${baseUrl}/api/uploads/multipart`); url.searchParams.set("key",init.key); url.searchParams.set("uploadId",init.uploadId); url.searchParams.set("partNumber",String(partNumber));
    const response=await fetch(url,{method:"PUT",body:bytes.subarray(start,Math.min(start+chunkSize,bytes.length)),headers:{"content-type":"application/octet-stream"}});
    if(!response.ok)throw new Error(`${response.status} ${await response.text()}`); parts.push(await response.json());
  }
  await postJson(`${baseUrl}/api/uploads/multipart?action=complete`,{key:init.key,uploadId:init.uploadId,parts,itemId,filename,sourcePath:file,contentType,size,order});
}

async function main() {
  const [aliRows,temuRows]=await Promise.all([loadCsv(aliCsv),loadCsv(temuCsv)]);
  const items=[...normalize(aliRows,"AliExpress"),...normalize(temuRows,"Temu")];
  items.forEach((item,index)=>{item.serial=String(index+1).padStart(4,"0")});
  const report={generatedAt:new Date().toISOString(),sources:{AliExpress:aliRows.length,Temu:temuRows.length},totalItems:items.length,itemsWithoutListedImages:items.filter(item=>item.imagePaths.length===0).map(item=>({serial:item.serial,title:item.title})),listedImages:0,foundImages:0,missingImages:[],imageBytes:0};
  for(const item of items) for(const file of item.imagePaths) {
    report.listedImages++;
    try { const info=await stat(file); if(info.isFile()){report.foundImages++;report.imageBytes+=info.size;} }
    catch { report.missingImages.push(file); }
  }
  await writeFile(path.join(process.cwd(),"import-report.json"),JSON.stringify(report,null,2));
  const idMap=new Map();
  for(let offset=0;offset<items.length;offset+=40){
    const batch=items.slice(offset,offset+40).map(({imagePaths,...item})=>item);
    const result=await postJson(`${baseUrl}/api/import`,{items:batch});
    for(const row of result.imported) idMap.set(row.sourceRecordId,row.id);
    process.stdout.write(`\rImported records ${Math.min(offset+40,items.length)}/${items.length}`);
  }
  process.stdout.write("\n");
  if(!recordsOnly){
    let done=0,failed=0;
    const status=await (await fetch(`${baseUrl}/api/import`)).json(); const present=new Set(status.sourcePaths||[]);
    const jobs=[];
    for(const item of items){const itemId=idMap.get(item.sourceRecordId);for(let order=0;order<item.imagePaths.length;order++){const file=item.imagePaths[order];if(!present.has(file))jobs.push({itemId,file,order});}}
    for(let offset=0;offset<jobs.length;offset+=8){
      await Promise.all(jobs.slice(offset,offset+8).map(async job=>{try{await stat(job.file);await upload(job.itemId,job.file,job.order);}catch(error){failed++; if(!String(error).includes("ENOENT")) console.error(`\n${job.file}: ${error}`);}finally{done++;}}));
      process.stdout.write(`\rUploaded images ${done}/${jobs.length} (${failed} missing/failed)`);
    }
    process.stdout.write("\n");
  }
  console.log(`Catalog ready: ${items.length} items, ${report.foundImages}/${report.listedImages} images found.`);
}

main().catch(error=>{console.error(error);process.exitCode=1;});
