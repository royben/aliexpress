import { env } from "cloudflare:workers";
import { ensureCatalog, itemFromRow } from "../../../db/catalog";

type ChatMessage = { role: "user" | "assistant"; text: string };
type InventoryRow = Record<string, unknown> & { id: number };
type FunctionCall = { type: "function_call"; name: string; arguments: string; call_id: string };
type AssistantResult = {
  answer_markdown: string;
  referenced_item_ids: number[];
  missing_items: Array<{ name: string; reason: string; search_query: string }>;
};

function apiKey() {
  const workerEnv = env as unknown as Record<string, unknown>;
  return String(workerEnv.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
}

async function openAI(body: Record<string, unknown>) {
  const key = apiKey();
  if (!key) throw new Error("OPENAI_API_KEY is not configured on the server");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const detail = (data.error as Record<string, unknown> | undefined)?.message;
    throw new Error(String(detail || `OpenAI request failed (${response.status})`));
  }
  return data;
}

function outputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text.trim();
  const output = Array.isArray(response.output) ? (response.output as Array<Record<string, unknown>>) : [];
  return output
    .flatMap((item) => (Array.isArray(item.content) ? (item.content as Array<Record<string, unknown>>) : []))
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function parseStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function itemDetails(row: InventoryRow, compact = false) {
  return {
    id: Number(row.id),
    serial: String(row.serial || ""),
    title: String(row.title || ""),
    category: String(row.category || ""),
    tags: parseStringArray(row.tags),
    description: String(row.plain_description || row.description || "").slice(0, compact ? 700 : 2400),
    quantity: Number(row.quantity || 0),
    location: String(row.location_name || "Not assigned"),
    source: String(row.source || ""),
    price: String(row.price_text || ""),
    has_thumbnail: Boolean(row.primary_image_key),
  };
}

function tokens(value: string) {
  return [...new Set(value.toLowerCase().replace(/[^a-z0-9+.-]+/g, " ").split(/\s+/).filter((token) => token.length > 1))];
}

function rankInventory(rows: InventoryRow[], query: string) {
  const terms = tokens(query);
  return rows
    .map((row) => {
      const title = String(row.title || "").toLowerCase();
      const serial = String(row.serial || "").toLowerCase();
      const category = String(row.category || "").toLowerCase();
      const tags = String(row.tags || "").toLowerCase();
      const description = String(row.plain_description || row.description || "").toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (serial === term) score += 35;
        if (title.includes(term)) score += 9;
        if (tags.includes(term)) score += 6;
        if (category.includes(term)) score += 4;
        if (description.includes(term)) score += 1;
      }
      if (title.includes(query.toLowerCase())) score += 22;
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.row.id) - Number(b.row.id));
}

const tools = [
  {
    type: "function",
    name: "search_inventory",
    description:
      "Search Roy's actual home-lab inventory by product name, four-digit serial number, category, tags, interface, voltage, function, specification, or intended use. Run multiple focused searches when a project needs several kinds of parts.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query", "limit"],
      properties: {
        query: { type: "string", description: "Concise technical search terms or a four-digit serial number." },
        limit: { type: "integer", minimum: 1, maximum: 12 },
      },
    },
  },
  {
    type: "function",
    name: "get_inventory_items",
    description:
      "Retrieve full stored details for inventory item IDs returned by search. Use this before claiming suitability, compatibility, voltage, interface, or wiring details.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["item_ids"],
      properties: {
        item_ids: { type: "array", minItems: 1, maxItems: 10, items: { type: "integer" } },
      },
    },
  },
];

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer_markdown", "referenced_item_ids", "missing_items"],
  properties: {
    answer_markdown: { type: "string" },
    referenced_item_ids: { type: "array", items: { type: "integer" } },
    missing_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "reason", "search_query"],
        properties: {
          name: { type: "string" },
          reason: { type: "string" },
          search_query: { type: "string" },
        },
      },
    },
  },
};

function parseResult(response: Record<string, unknown>) {
  const text = outputText(response);
  try {
    return JSON.parse(text) as AssistantResult;
  } catch {
    throw new Error("The lab assistant returned an unreadable answer");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = (body.messages || [])
      .filter((message) => message && ["user", "assistant"].includes(message.role) && String(message.text || "").trim())
      .slice(-16)
      .map((message) => ({ role: message.role, text: String(message.text).slice(0, 6000) }));
    if (!messages.length)
      return Response.json({ error: "A question is required" }, { status: 400 });

    const db = await ensureCatalog();
    const inventoryResult = await db
      .prepare("SELECT i.*,l.name AS location_name FROM inventory_items i LEFT JOIN inventory_locations l ON l.id=i.location_id ORDER BY i.id")
      .all();
    const rows = inventoryResult.results as InventoryRow[];
    const transcript = messages.map((message) => `${message.role === "user" ? "Roy" : "Assistant"}: ${message.text}`).join("\n\n");

    const instructions = `You are Roy's personal home-lab inventory assistant. There is no starting product. Answer the latest question by searching Roy's actual inventory with the provided tools.

For project requests, break the project into required functional parts and search the inventory for each important part. For requests such as voltage conversion, sensing, measurement, control, power, motors, or communications, search using several likely technical names and variants. Retrieve full records before claiming an item is suitable. Be honest when stored descriptions do not prove voltage, interface, current, pinout, or compatibility.

Use only actual inventory results as owned items. Whenever you mention an owned item in answer_markdown, link its name exactly as [Product name](/items/ITEM_ID) and include its ID in referenced_item_ids. Never invent IDs.

When an important required component is not present or no sufficiently suitable item is found, add it to missing_items. Give each missing item a generic marketplace-friendly search_query of 3 to 10 words with key specifications. Do not include a brand unless essential, and do not include site names, search operators, quotation marks, URLs, or explanations in search_query. The application will create separate Google links for AliExpress, Temu, and Amazon.

Keep answer_markdown practical and readable. Explain how the owned items fit together, what is missing, and any safety or compatibility checks. Do not claim the inventory was searched unless you actually called the tools.`;
    const model = String(
      (env as unknown as Record<string, unknown>).OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-terra",
    );
    const format = { type: "json_schema", name: "lab_inventory_answer", strict: true, schema: resultSchema };
    let input: Array<Record<string, unknown>> = [
      { role: "user", content: [{ type: "input_text", text: `Inventory contains ${rows.length} product records.\n\nCONVERSATION\n${transcript}` }] },
    ];
    let response: Record<string, unknown> | null = null;
    let toolCallCount = 0;

    for (let turn = 0; turn < 6; turn++) {
      response = await openAI({
        model,
        store: false,
        include: ["reasoning.encrypted_content"],
        instructions,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
        max_output_tokens: 2400,
        text: { format },
        input,
      });
      const output = Array.isArray(response.output) ? (response.output as Array<Record<string, unknown>>) : [];
      const calls = output.filter((item): item is FunctionCall => item.type === "function_call");
      if (!calls.length) break;
      const toolOutputs: Array<Record<string, unknown>> = [];
      for (const call of calls) {
        toolCallCount++;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments || "{}") as Record<string, unknown>; } catch {}
        let outputValue: unknown;
        if (call.name === "search_inventory") {
          const query = String(args.query || "").trim();
          const limit = Math.min(12, Math.max(1, Number(args.limit || 8)));
          outputValue = {
            query,
            results: rankInventory(rows, query).slice(0, limit).map((entry) => itemDetails(entry.row, true)),
          };
        } else if (call.name === "get_inventory_items") {
          const ids = Array.isArray(args.item_ids) ? args.item_ids.map(Number).filter(Number.isInteger).slice(0, 10) : [];
          outputValue = {
            items: ids
              .map((id) => rows.find((row) => Number(row.id) === id))
              .filter((row): row is InventoryRow => Boolean(row))
              .map((row) => itemDetails(row)),
          };
        } else outputValue = { error: "Unknown inventory tool" };
        toolOutputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(outputValue) });
      }
      input = [...input, ...output, ...toolOutputs];
    }

    if (!response) throw new Error("The lab assistant did not return a response");
    const hasCalls = (Array.isArray(response.output) ? response.output : []).some(
      (item) => (item as Record<string, unknown>).type === "function_call",
    );
    if (hasCalls || !outputText(response)) {
      response = await openAI({
        model,
        store: false,
        include: ["reasoning.encrypted_content"],
        instructions,
        tools,
        tool_choice: "none",
        max_output_tokens: 2400,
        text: { format },
        input: [...input, ...(Array.isArray(response.output) ? (response.output as Array<Record<string, unknown>>) : [])],
      });
    }

    const result = parseResult(response);
    const linkedIds = [...result.answer_markdown.matchAll(/\]\(\/items\/(\d+)\)/g)].map((match) => Number(match[1]));
    const referencedIds = [...new Set([...result.referenced_item_ids.map(Number), ...linkedIds])];
    const references = referencedIds
      .map((id) => rows.find((row) => Number(row.id) === id))
      .filter((row): row is InventoryRow => Boolean(row))
      .map((row) => itemFromRow(row));
    const missingItems = result.missing_items
      .map((missing) => ({
        name: String(missing.name || "").trim(),
        reason: String(missing.reason || "").trim(),
        searchQuery: String(missing.search_query || "").trim(),
      }))
      .filter((missing) => missing.name && missing.searchQuery)
      .slice(0, 10);

    return Response.json({
      answer: result.answer_markdown,
      references,
      missingItems,
      model,
      inventorySearches: toolCallCount,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The lab assistant could not answer" },
      { status: 500 },
    );
  }
}
