import { env } from "cloudflare:workers";

const tagRules: Array<[RegExp, string]> = [
  [/\busb[ -]?c\b/i, "USB-C"],
  [/\busb\b/i, "USB"],
  [/\bi2c\b/i, "I2C"],
  [/\bspi\b/i, "SPI"],
  [/\buart\b/i, "UART"],
  [/\brs[ -]?232\b/i, "RS-232"],
  [/\besp32\b/i, "ESP32"],
  [/\besp8266\b/i, "ESP8266"],
  [/\bstm32\b/i, "STM32"],
  [/\braspberry\s*pi\b/i, "Raspberry Pi"],
  [/\barduino\b/i, "Arduino"],
  [/\bbluetooth\b/i, "Bluetooth"],
  [/\bwi[ -]?fi\b/i, "Wi-Fi"],
  [/\brfid\b/i, "RFID"],
  [/\b3[.]3\s*v\b/i, "3.3V"],
  [/\b5\s*v\b/i, "5V"],
  [/\b9\s*v\b/i, "9V"],
  [/\b12\s*v\b/i, "12V"],
  [/\b24\s*v\b/i, "24V"],
  [/battery|batteries|18650|lithium|lipo|li-ion/i, "Battery"],
  [/rechargeable|charger|charging/i, "Rechargeable"],
  [/buck|boost|converter|regulator|power supply|power adapter|voltage module/i, "Power regulation"],
  [/multimeter|voltmeter|ammeter|tester|gauge|measurement|oscilloscope/i, "Measurement"],
  [/oled|lcd|display|screen|seven.segment|7.segment|tm1637/i, "Display"],
  [/\bled\b|lighting|light strip|lamp/i, "LED"],
  [/sensor|detector|thermistor|encoder|gyroscope|accelerometer/i, "Sensor"],
  [/motor|servo|stepper|actuator/i, "Motor"],
  [/relay|contactor/i, "Relay"],
  [/switch|push.?button|rocker|toggle/i, "Switch"],
  [/connector|terminal|header|socket|plug|\bjst\b/i, "Connector"],
  [/cable|wire|jumper lead/i, "Cable"],
  [/solder|desolder|flux/i, "Soldering"],
  [/plier|stripper|crimper|cutter|screwdriver|wrench|drill|tweezer/i, "Hand tool"],
  [/adhesive|glue|tape|epoxy/i, "Adhesive"],
  [/enclosure|storage|organizer|case|project box/i, "Storage"],
  [/breadboard|prototype|perfboard|\bpcb\b/i, "Prototyping"],
  [/resistor|capacitor|inductor|potentiometer/i, "Passive component"],
  [/transistor|mosfet|diode|rectifier|integrated circuit|\bic\b/i, "Semiconductor"],
  [/screw|nut|bolt|washer|bracket|bearing|gear|shaft|spring/i, "Hardware"],
  [/speaker|microphone|audio|buzzer|amplifier/i, "Audio"],
  [/antenna|wireless|radio|\brf\b/i, "Wireless"],
  [/waterproof|water.?resistant/i, "Waterproof"],
  [/automotive|vehicle|car\b/i, "Automotive"],
  [/robot|robotics/i, "Robotics"],
  [/camera|webcam/i, "Camera"],
  [/fan|heatsink|heat sink|cooling/i, "Cooling"],
  [/rubber band|elastic band/i, "Elastic"],
  [/bookbinding|kraft board|chipboard/i, "Craft material"],
  [/label tag|id tag|luggage tag|keychain tag/i, "Labeling"],
];

const categoryFallbackTags: Record<string, string> = {
  "Adhesives & Consumables": "Adhesive",
  Audio: "Audio",
  Automotive: "Automotive",
  "Cables & Connectors": "Connector",
  "Computing & USB": "Computing",
  "Displays & Indicators": "Display",
  "LEDs & Lighting": "LED",
  "Mechanical & Hardware": "Hardware",
  "Microcontrollers & Development Boards": "Microcontroller",
  "Motors & Motion": "Motor",
  "Passive Components": "Passive component",
  "Power & Batteries": "Power regulation",
  "Prototyping & PCBs": "Prototyping",
  "Relays & Controls": "Switch",
  "Semiconductors & ICs": "Semiconductor",
  Sensors: "Sensor",
  "Storage & Organization": "Storage",
  "Tools & Soldering": "Hand tool",
  "Wireless & Identification": "Wireless",
};

function cleanTags(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((tag) => String(tag).trim()).filter(Boolean))]
    : [];
}

export function ensureItemTags(
  value: unknown,
  title: unknown,
  description: unknown,
  category: unknown,
) {
  const supplied = cleanTags(value);
  if (supplied.length) return supplied;
  const text = `${String(title || "")} ${String(description || "")}`;
  const inferred = tagRules
    .filter(([pattern]) => pattern.test(text))
    .map(([, tag]) => tag)
    .slice(0, 3);
  if (inferred.length) return [...new Set(inferred)];
  return [categoryFallbackTags[String(category || "")] || "General"];
}

export async function ensureCatalog() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      plain_description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Uncategorized',
      price_text TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      tags TEXT NOT NULL DEFAULT '[]',
      suggested_projects TEXT NOT NULL DEFAULT '[]',
      original_html_path TEXT NOT NULL DEFAULT '',
      original_resource_path TEXT NOT NULL DEFAULT '',
      primary_image_key TEXT,
      image_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Unsorted',
      location_id INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, source_record_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_original_taxonomy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      raw_category TEXT NOT NULL DEFAULT '',
      raw_tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, source_record_id)
    )`),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_inventory_items_source_status ON inventory_items(source, status)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_inventory_images_item ON inventory_images(item_id, sort_order)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_inventory_attachments_item ON inventory_attachments(item_id, created_at)",
    ),
  ]);
  const serialState = await db
    .prepare(
      `SELECT COUNT(*) AS total,
    SUM(CASE WHEN length(serial)=4 AND serial NOT GLOB '*[^0-9]*' THEN 0 ELSE 1 END) AS legacy
    FROM inventory_items`,
    )
    .first<{ total: number; legacy: number }>();
  if (Number(serialState?.legacy || 0) > 0) {
    if (Number(serialState?.total || 0) > 9999)
      throw new Error("Four-digit serial numbers support at most 9,999 items");
    await db
      .prepare("UPDATE inventory_items SET serial='__renumber__' || id")
      .run();
    await db
      .prepare(
        `WITH numbered AS (
      SELECT id, printf('%04d', ROW_NUMBER() OVER (ORDER BY id)) AS next_serial
      FROM inventory_items
    )
    UPDATE inventory_items
    SET serial=(SELECT next_serial FROM numbered WHERE numbered.id=inventory_items.id)`,
      )
      .run();
  }
  const possibleUntagged = await db
    .prepare(
      `SELECT id,title,description,plain_description,category,tags FROM inventory_items
      WHERE tags='' OR tags='[]' OR tags IS NULL OR tags='["General"]'`,
    )
    .all();
  const tagUpdates = possibleUntagged.results.map((row) => {
    const item = row as Record<string, unknown>;
    const tags = ensureItemTags(
      [],
      item.title,
      item.plain_description || item.description,
      item.category,
    );
    return db
      .prepare("UPDATE inventory_items SET tags=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(JSON.stringify(tags), item.id);
  });
  for (let start = 0; start < tagUpdates.length; start += 50)
    await db.batch(tagUpdates.slice(start, start + 50));
  return db;
}

export async function nextInventorySerial(db: typeof env.DB) {
  const row = await db
    .prepare(
      `SELECT MAX(CAST(serial AS INTEGER)) AS highest
    FROM inventory_items
    WHERE length(serial)=4 AND serial NOT GLOB '*[^0-9]*'`,
    )
    .first<{ highest: number | null }>();
  const next = Number(row?.highest || 0) + 1;
  if (next > 9999) throw new Error("No four-digit serial numbers remain");
  return String(next).padStart(4, "0");
}

export function itemFromRow(row: Record<string, unknown>) {
  const primary = row.primary_image_key
    ? `/api/media?key=${encodeURIComponent(String(row.primary_image_key))}`
    : "";
  return {
    ...row,
    image: primary,
    imageCount: Number(row.image_count || 0),
    location: row.location_name || "Unsorted",
    tags: JSON.parse(String(row.tags || "[]")),
    suggestedProjects: JSON.parse(String(row.suggested_projects || "[]")),
  };
}
