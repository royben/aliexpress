import { env } from "cloudflare:workers";
import { ensureCatalog, itemFromRow } from "../../../db/catalog";

type ChatMessage = { role: "user" | "assistant"; text: string };
type InventoryRow = Record<string, unknown> & {
  id: number;
  primary_image_key?: string | null;
};
type FunctionCall = {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
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
  const output = Array.isArray(response.output)
    ? (response.output as Array<Record<string, unknown>>)
    : [];
  return output
    .flatMap((item) =>
      Array.isArray(item.content)
        ? (item.content as Array<Record<string, unknown>>)
        : [],
    )
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
  const description = String(row.plain_description || row.description || "");
  return {
    id: Number(row.id),
    serial: String(row.serial || ""),
    title: String(row.title || ""),
    category: String(row.category || ""),
    tags: parseStringArray(row.tags),
    description: description.slice(0, compact ? 650 : 2200),
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

function rankInventory(rows: InventoryRow[], query: string, currentId: number) {
  const terms = tokens(query);
  return rows
    .filter((row) => Number(row.id) !== currentId)
    .map((row) => {
      const title = String(row.title || "").toLowerCase();
      const serial = String(row.serial || "").toLowerCase();
      const category = String(row.category || "").toLowerCase();
      const tags = String(row.tags || "").toLowerCase();
      const description = String(row.plain_description || row.description || "").toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (serial === term) score += 30;
        if (title.includes(term)) score += 8;
        if (tags.includes(term)) score += 5;
        if (category.includes(term)) score += 3;
        if (description.includes(term)) score += 1;
      }
      if (title.includes(query.toLowerCase())) score += 20;
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.row.id) - Number(b.row.id));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

async function thumbnail(row: InventoryRow) {
  const key = String(row.primary_image_key || "");
  if (!key) return null;
  const object = await env.UPLOADS.get(key);
  if (!object || object.size > 4_500_000) return null;
  const contentType = object.httpMetadata?.contentType || "image/jpeg";
  if (!contentType.startsWith("image/")) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

const tools = [
  {
    type: "function",
    name: "search_inventory",
    description:
      "Search the owner's real inventory by product name, serial number, category, tags, specifications, or intended use. Use this whenever another inventory item might help answer the question.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query", "limit"],
      properties: {
        query: { type: "string", description: "Concise inventory search terms or a four-digit serial number." },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
  },
  {
    type: "function",
    name: "get_inventory_items",
    description:
      "Retrieve fuller details for specific inventory item IDs found by search. Use before making compatibility, wiring, voltage, or project recommendations involving those items.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["item_ids"],
      properties: {
        item_ids: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: { type: "integer" },
        },
      },
    },
  },
];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { itemId?: number; messages?: ChatMessage[] };
    const itemId = Number(body.itemId || 0);
    const messages = (body.messages || [])
      .filter((message) => message && ["user", "assistant"].includes(message.role) && String(message.text || "").trim())
      .slice(-14)
      .map((message) => ({ role: message.role, text: String(message.text).slice(0, 5000) }));
    if (!itemId || !messages.length)
      return Response.json({ error: "An item and a question are required" }, { status: 400 });

    const db = await ensureCatalog();
    const result = await db
      .prepare(
        "SELECT i.*,l.name AS location_name FROM inventory_items i LEFT JOIN inventory_locations l ON l.id=i.location_id ORDER BY i.id",
      )
      .all();
    const rows = result.results as InventoryRow[];
    const current = rows.find((row) => Number(row.id) === itemId);
    if (!current) return Response.json({ error: "Product not found" }, { status: 404 });

    const image = await thumbnail(current);
    const transcript = messages
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`)
      .join("\n\n");
    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: `CURRENT PRODUCT CONTEXT\n${JSON.stringify(itemDetails(current), null, 2)}\n\nCONVERSATION\n${transcript}`,
      },
    ];
    if (image) content.push({ type: "input_image", image_url: image, detail: "high" });

    const instructions = `You are the inventory assistant for a personal electronics and home-lab collection. The current product record and its default thumbnail are always supplied. Answer the latest user question accurately and practically.

You have tools for searching the owner's actual inventory. If the question asks what can be built with this item, whether it works with another item, mentions a serial/product, or would benefit from companion parts, search the inventory before answering. Search more than once with different technical terms when useful, then retrieve full records for the best candidates. Do not claim electrical compatibility without checking available voltage, interface, connector, logic-level, current, and power details. Clearly state what cannot be verified from the stored records.

Whenever you mention another inventory product, format its name as a Markdown link to its exact local product page: [Product name](/items/ITEM_ID). Never invent an item ID. Links must open only /items/<numeric-id>. Use concise Markdown with useful bullets or short sections. Do not mention tool calls or internal database mechanics.`;
    const model = String(
      (env as unknown as Record<string, unknown>).OPENAI_MODEL ||
        process.env.OPENAI_MODEL ||
        "gpt-5.6-terra",
    );

    let input: Array<Record<string, unknown>> = [{ role: "user", content }];
    let response: Record<string, unknown> | null = null;
    let toolCallCount = 0;
    for (let turn = 0; turn < 5; turn++) {
      response = await openAI({
        model,
        store: false,
        include: ["reasoning.encrypted_content"],
        instructions,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
        max_output_tokens: 1800,
        input,
      });
      const output = Array.isArray(response.output)
        ? (response.output as Array<Record<string, unknown>>)
        : [];
      const calls = output.filter(
        (item): item is FunctionCall => item.type === "function_call",
      );
      if (!calls.length) break;

      const toolOutputs: Array<Record<string, unknown>> = [];
      for (const call of calls) {
        toolCallCount++;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
        } catch {}
        let outputValue: unknown;
        if (call.name === "search_inventory") {
          const query = String(args.query || "").trim();
          const limit = Math.min(10, Math.max(1, Number(args.limit || 6)));
          outputValue = {
            query,
            results: rankInventory(rows, query, itemId)
              .slice(0, limit)
              .map((entry) => itemDetails(entry.row, true)),
          };
        } else if (call.name === "get_inventory_items") {
          const ids = Array.isArray(args.item_ids)
            ? args.item_ids.map(Number).filter(Number.isInteger).slice(0, 8)
            : [];
          outputValue = {
            items: ids
              .map((id) => rows.find((row) => Number(row.id) === id))
              .filter((row): row is InventoryRow => Boolean(row))
              .map((row) => itemDetails(row)),
          };
        } else outputValue = { error: "Unknown inventory tool" };
        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(outputValue),
        });
      }
      input = [...input, ...output, ...toolOutputs];
    }

    if (!response) throw new Error("The assistant did not return a response");
    let answer = outputText(response);
    const remainingCalls = (Array.isArray(response.output) ? response.output : []).some(
      (item) => (item as Record<string, unknown>).type === "function_call",
    );
    if (remainingCalls || !answer) {
      const finalResponse = await openAI({
        model,
        store: false,
        include: ["reasoning.encrypted_content"],
        instructions,
        tools,
        tool_choice: "none",
        max_output_tokens: 1800,
        input: [
          ...input,
          ...(Array.isArray(response.output)
            ? (response.output as Array<Record<string, unknown>>)
            : []),
        ],
      });
      answer = outputText(finalResponse);
    }
    if (!answer) throw new Error("The assistant returned an empty answer");

    const referencedIds = [
      ...new Set(
        [...answer.matchAll(/\]\(\/items\/(\d+)\)/g)].map((match) => Number(match[1])),
      ),
    ];
    const references = referencedIds
      .map((id) => rows.find((row) => Number(row.id) === id))
      .filter((row): row is InventoryRow => Boolean(row))
      .map((row) => itemFromRow(row));

    return Response.json({ answer, references, model, inventorySearches: toolCallCount });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The lab assistant could not answer" },
      { status: 500 },
    );
  }
}
