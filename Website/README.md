# PartsAtlas

PartsAtlas is Roy's personal home-lab inventory system. It exists to turn a large collection of mostly undocumented electronics, modules, motors, tools, cables, gadgets, consumables, and mechanical parts into a searchable catalog that can answer three practical questions:

1. What is this item?
2. Where did I put it?
3. What can I build with the things I already own?

The application combines the recovered AliExpress and Temu order data in one structured database, stores product media separately in object storage, supports day-to-day inventory management, and adds camera-assisted identification plus inventory-aware AI assistants.

This repository is the working application, not a mock-up. The local project lives at:

```text
C:\Lab Orders\aliexpress\Website
```

## Current catalog snapshot

The following figures were read from the running local application on 2026-09-02. They are a snapshot, not hard-coded limits:

| Metric | Current value |
| --- | ---: |
| Products | 520 |
| AliExpress products | 396 |
| Temu products | 124 |
| Estimated units, including multi-packs | 11,946 |
| Product images currently referenced by the database | 6,328 |
| Categories | 20 |
| Distinct tags | 52 |
| Products without a tag | 0 |
| Products with a recorded price | 106 |
| Products assigned to a location | 2 |
| Products still unsorted | 518 |
| Location records | 5 |

`import-report.json` is an older import-time snapshot. It reports 6,337 source images found on disk and no missing listed image files. The live database currently reports 6,328 images because the catalog has changed since that report was generated. The old report also contains the pre-refactor serial-number format; the live database uses four-digit numeric serials.

## Product philosophy and decisions

- AliExpress, Temu, Amazon, manually entered products, and any future source belong in one catalog. `source` distinguishes their origin.
- Product images and attachments are stored in Cloudflare R2-compatible object storage. D1 stores their metadata and object keys. Binary media is not stored inside the SQL database.
- Locations form a tree, such as `Shelves -> Shelf A -> Box 1`.
- Serial numbers are deliberately human-friendly four-digit strings from `0001` through `9999`, suitable for printed labels and manual entry.
- A product currently has one category and any number of tags.
- Every product must have at least one tag. If none is supplied, the server infers one from the product text or falls back to a controlled category tag.
- Quantity is a non-negative whole number. Zero is valid.
- Price is currently stored as display text rather than normalized money, allowing values such as `₪29.90`, `$8.50`, a range, or another source-specific representation.
- Product identification prioritizes finding what a generic item actually is. It does not assume that an AliExpress or Temu product is a branded original merely because it resembles one.
- Marketplace research uses separate Google searches restricted to AliExpress, Temu, and Amazon. It does not attempt to reproduce Google Lens through an unsupported reverse-image API.

## User-facing application

### Overview

The overview is a dashboard rather than a duplicate of the inventory page. It shows:

- unique product count;
- estimated total units;
- how many products have locations;
- total product images;
- the largest categories;
- recently modified/imported products;
- a shortcut to the inventory;
- a shortcut to the lab assistant.

### Inventory

The inventory is available from `/?view=Inventory` and loads up to 1,000 products from `/api/items` into the client.

It supports:

- free-text search across product name, serial, category, and tags in the client;
- source filtering;
- category and tag facets rendered as multi-select buttons with count badges;
- search boxes for both category and tag facets;
- grid and compact list layouts;
- a three-card desktop grid;
- compact list rows with one title line and one description line;
- non-cropped, aspect-ratio-preserving product images on a white image background;
- category, tags, source, quantity, location, and four-digit serial metadata;
- opening the product preview sidebar by selecting a card;
- opening the full product page in a separate tab from the card's external-link button.

Selected category and tag filters survive a refresh in browser local storage under `parts-atlas-inventory-filters`. Source filters, the search query, and the selected grid/list view are not currently persisted.

Filtering semantics are:

- selected sources: match any selected source;
- selected categories: match any selected category;
- selected tags: match at least one selected tag;
- the active source, category, tag, and text filter groups are combined with AND.

The API's default database order is `updated_at DESC, id DESC`: most recently modified products first, then the higher database ID when timestamps tie. Because automatic tag repair updates `updated_at`, a maintenance backfill can affect the visible default order.

### Product preview sidebar

The inventory sidebar provides a fast preview without leaving the inventory. It includes the fitted hero image, gallery thumbnails, product identity and descriptive information, category/source/quantity/location details, attachment controls, and an `Open product page` action. The full-page action opens a separate browser tab so the inventory remains available.

### Full product page

The dedicated route is `/items/<database-id>`. It is the main product-management surface.

Current features include:

- a large aspect-ratio-preserving image preview;
- no automatic upscaling above an image's natural dimensions at the default zoom;
- zoom in, zoom out, reset, and pointer-based panning;
- an image gallery in which the default thumbnail is always listed first;
- selecting a different default thumbnail;
- uploading more product images;
- deleting non-default images through a styled centered confirmation dialog;
- protection against deleting the current default thumbnail until another image is made default;
- editing the product name, description, category, tags, and price;
- a searchable category combobox that accepts existing values or creates a new free-text category;
- tag search, selection, removal, and creation;
- a fixed-height, vertically scrollable description region to keep the right column manageable;
- a four-digit serial-number display;
- plus/minus quantity controls that save automatically and allow zero;
- a tree location picker with search, recent locations, unassigned state, and creation of a child or root location;
- a price row directly below location, including an explicit `No price recorded` state;
- related inventory items;
- image and attachment management;
- a ZIP export;
- a product-aware assistant modal;
- compact Google marketplace searches for the product name at the bottom of the right column.

The product page's three marketplace links open distinct Google searches:

```text
site:aliexpress.com <product name>
site:temu.com <product name>
site:amazon.com <product name>
```

### Add a new item

New products use a dedicated product-like page at `/items/new`, not a small modal.

The page supports:

- required product name;
- description;
- required category selected from existing categories or entered as a new value;
- source: `Manual`, `AliExpress`, `Temu`, `Amazon`, or `Other`;
- free-form display price;
- quantity, including zero;
- existing or newly created tags;
- a searchable location tree;
- creation of root or child locations;
- multiple product images with a chosen default image;
- multiple attachments;
- automatic four-digit serial assignment after creation.

Images are uploaded with the chosen default first, making it `sort_order = 0` and the primary thumbnail. After the item and its files are created, the browser navigates to the new product page.

### Locations

Locations are adjacency-list tree nodes. Every row has a name and an optional `parent_id`. A root has no parent. The interface can drill through and create a hierarchy that resembles folder selection.

On first access, an empty location table is seeded with:

- `Shelves`;
- `Drawers`;
- `Unsorted bags`.

Assigning a location changes the product status to `Stored`. Clearing the location changes it to `Unsorted`. Status is currently an internal consequence of location assignment, not a user-facing workflow that needs a separate inventory dropdown.

### Identify an unknown item

The dedicated camera page is `/identify`.

The browser workflow is:

1. Start the camera or upload a photo.
2. Choose a camera from the selector. The selected device ID is remembered in local storage as `partsatlas-preferred-camera`.
3. Move and resize the capture rectangle over the item.
4. Press `Capture and identify`.
5. The browser maps the visible selection rectangle back to the original video frame coordinates and renders that crop to a JPEG at quality `0.88`.
6. The selected crop, not merely a screenshot of the CSS-sized preview, is sent to the identification API.
7. OpenAI performs a structured visual analysis.
8. The server text-ranks the whole catalog, selects the strongest candidates, loads their default thumbnails, and asks the vision model to compare the unknown image with those candidates.
9. Up to six inventory matches are returned with confidence, similarities, differences, and an explanation.
10. Roy can open candidate products in separate tabs and confirm `This is the product`.
11. After confirmation, the captured crop can be added to that product's image gallery.

The camera preview has a black background, maintains the feed's aspect ratio, and centers the video. `Retake` restores the live stream. The selected camera survives navigation and refresh; identification results deliberately do not. The page clears the former `partsatlas-identification-results` session-storage entry on load.

The first AI pass returns strict structured fields:

- likely generic name;
- category;
- description;
- exactly visible text;
- markings;
- visual features;
- useful search terms;
- one editable marketplace search query;
- confidence.

Candidate generation and comparison currently work as follows:

- every inventory row is scored using terms from the visual analysis;
- rarer terms receive greater inverse-document-frequency weight;
- titles, original source titles, tags, categories, and descriptions contribute different weights;
- the top 10 metadata candidates are ranked;
- up to the top 8 proceed to visual comparison;
- one image is used per candidate: its current default thumbnail;
- candidate images larger than 3.5 MB are skipped for the model comparison;
- candidate thumbnails are sent at low image detail while the unknown crop is sent at high detail;
- the model returns one to six candidates and is instructed to keep confidence low when only the broad category matches.

The page also provides:

- an `AI sees` summary;
- editable separate Google links for AliExpress, Temu, and Amazon based on the AI's marketplace-friendly query;
- an optional `Analyze this item using the web` action that sends the same captured image, plus the existing visual analysis, to an OpenAI web-search-enabled response;
- Markdown rendering for the detailed web analysis.

The web-analysis prompt intentionally emphasizes generic marketplace terminology, common variants, likely specifications, practical verification, and uncertainty. It strips inline URLs and citation links from the answer because marketplace search links are presented separately.

Captured images are not saved automatically. They are persisted only when Roy explicitly confirms a product and chooses `Add captured image`.

### Product-aware assistant

`Ask the lab assistant` on a product page opens a modal conversation already scoped to that product.

The backend receives:

- the product's stored name, serial, category, tags, descriptions, quantity, location, source, price, and thumbnail availability;
- the current default thumbnail itself when it is an image no larger than 4.5 MB;
- up to the last 14 non-empty chat messages, each truncated to 5,000 characters.

The model can call two private server-side inventory tools:

- `search_inventory` for ranked searches by title, serial, category, tags, specification, or intended use;
- `get_inventory_items` for fuller details about selected records.

The loop allows up to five model turns. The assistant is told to check stored evidence before making compatibility, voltage, interface, current, power, wiring, or project claims. References to other owned products are Markdown links in the form `/items/<id>` and are rendered as clickable cards that open separately.

The modal begins with `Hey Roy, ask me anything about this product`, renders Markdown, and displays `Gathering data...` while the backend works.

### General lab assistant

The navigation's `Lab assistant` page is `/assistant`. It has no starting product context and is designed for questions such as:

- What can I build with products I already own?
- Which products can perform a particular task?
- How can I regulate a voltage to 3.3 V?
- What can measure a battery's charge or power level?
- Which parts are missing from a proposed robot or electronics project?

The backend supplies the same inventory search and record-retrieval tools, permits up to six model turns, and can make parallel tool calls. It receives up to the last 16 messages, each capped at 6,000 characters. Its final response is strict structured JSON containing:

- Markdown answer text;
- referenced owned product IDs;
- missing products, each with a reason and marketplace-friendly search query.

Owned products are linked to `/items/<id>` and open in new tabs. A missing product receives three separate Google searches restricted to AliExpress, Temu, and Amazon. Search queries are instructed to be generic, specification-oriented, three to ten words, and free of site names or search operators because the UI adds those.

The page begins with `Hey Roy, what would you like to build or find?`, renders Markdown, shows `Gathering data...` while processing, and includes a copy-chat action. The clipboard transcript format is:

```text
Roy: first question
Assistant: first answer
Roy: follow-up
Assistant: follow-up answer
```

Chat state is held in the page's React state. Refreshing the page starts a new general-assistant conversation.

### Navigation

The current primary destinations are Overview, Inventory, Locations, Identify item, Lab assistant, Settings, and Help & feedback. `Project ideas` was intentionally removed from the menu. Some secondary destinations remain placeholders rather than complete management screens.

## Architecture

```text
Browser / React UI
        |
        v
Vinext App Router + route handlers
        |
        +----------------------+-----------------------+
        |                      |                       |
        v                      v                       v
Cloudflare D1             Cloudflare R2          OpenAI Responses API
structured catalog        images/attachments     vision, tools, web search
```

### Technology stack

- React 19.2.6
- TypeScript 5.9 with strict checking and no emit
- Vinext 1.0 beta, providing a Next.js-compatible App Router on Vite
- Vite 8
- Cloudflare Workers runtime with `nodejs_compat`
- Cloudflare D1, exposed as the `DB` binding
- Cloudflare R2, exposed as the `UPLOADS` binding
- Cloudflare Images-compatible transform binding for Vinext image optimization
- Drizzle ORM and Drizzle Kit for schema definitions/migration generation
- `csv-parse` for catalog ingestion
- `sharp` for import-time image downscaling and WebP conversion
- `fflate` for ZIP exports
- `react-markdown` and `remark-gfm` for assistant output
- Lucide React icons
- Manrope UI font and IBM Plex Mono metadata/serial font

### Runtime and hosting configuration

`.openai/hosting.json` connects the Sites project to:

```json
{
  "project_id": "appgprj_6a974138a33881918ed79c0974946922",
  "d1": "DB",
  "r2": "UPLOADS"
}
```

The local Vite configuration creates project-local Miniflare/Wrangler D1 and R2 bindings using those names. Local runtime state is stored under `.wrangler/` and is ignored by Git. The worker entry point is `worker/index.ts`; normal requests go to the Vinext App Router, while `/_vinext/image` uses the image-optimization handler.

The database and media bindings are intentionally the same interface locally and in the hosted application, avoiding an SQLite-to-another-database rewrite later. D1 uses SQLite-compatible SQL, but the application is built against the Cloudflare binding rather than a standalone `.sqlite` application file.

## Data model

The active runtime schema is created defensively by `ensureCatalog()` in `db/catalog.ts`. API routes call it before catalog access. The live source of truth is the `inventory_*` family below.

### `inventory_items`

| Column | Meaning |
| --- | --- |
| `id` | Internal integer primary key used in `/items/<id>` routes |
| `serial` | Unique four-character numeric label such as `0274` |
| `source` | AliExpress, Temu, Amazon, Manual, Other, or a future source |
| `source_record_id` | Stable source-specific identifier; unique together with `source` |
| `title` | Editable product name shown in the application |
| `source_title` | Original/recovered source product title |
| `description` | Editable/enriched description |
| `plain_description` | Recovered plain source description |
| `category` | One editable category string |
| `price_text` | Free-form display price |
| `currency` | Recovered currency text when available; not currently normalized in editing UI |
| `quantity` | Non-negative whole-number unit estimate |
| `tags` | JSON-encoded string array |
| `suggested_projects` | JSON-encoded legacy/import field; not included in exports and not a current navigation feature |
| `original_html_path` | Original local listing HTML path retained for provenance |
| `original_resource_path` | Original local asset folder retained for provenance |
| `primary_image_key` | R2 object key for the default thumbnail |
| `image_count` | Denormalized product image count |
| `status` | Currently `Stored` or `Unsorted`, driven by location assignment |
| `location_id` | Optional reference to `inventory_locations.id` |
| `notes` | Free-form notes column; not yet exposed by the main product editor |
| `created_at` | Database creation timestamp |
| `updated_at` | Last catalog modification timestamp |

Constraints and indexes:

- unique `serial`;
- unique `(source, source_record_id)`;
- source/status index;
- location index.

### `inventory_images`

Stores image metadata only:

- owning product ID;
- unique R2 object key;
- filename;
- original source path;
- content type;
- byte size;
- sort order;
- creation timestamp.

The gallery orders the primary image first regardless of its historic sort order, then orders the rest by `sort_order` and ID.

### `inventory_attachments`

Stores attachment metadata only:

- owning product ID;
- unique R2 object key;
- filename;
- content type;
- byte size;
- creation timestamp.

### `inventory_locations`

An adjacency-list tree with:

- integer ID;
- name;
- nullable parent ID;
- notes;
- creation timestamp.

There is currently no database-level foreign-key declaration, unique sibling-name constraint, or dedicated location rename/delete API.

### `inventory_original_taxonomy`

Preserves the original imported `item_type` and tag values separately from the smaller curated category/tag system. Rows are unique by source and source record ID. These values are included in a product export even when the user-facing category or tags have since changed.

### Legacy schema declarations

`db/schema.ts` still declares older `locations`, `items`, and `attachments` tables as well as the active `inventory_*` tables. The older tables and the contents of `examples/d1/` are scaffold/history artifacts. Current application APIs use `inventory_*` through `ensureCatalog()` and should be treated as the source of truth.

### Serial-number rules

On catalog access, `ensureCatalog()` checks for old or malformed serials. If any exist, all products are temporarily renamed and then reassigned sequentially as `0001`, `0002`, and so on in database ID order. More than 9,999 products causes a hard error because the chosen label format has no remaining capacity.

New products receive one more than the highest current valid numeric serial, padded to four digits. Deleted serials are not automatically reused.

### Automatic tag rules

When a create or edit request supplies no tags, `ensureItemTags()` searches the title and description for controlled concepts including interfaces, controller families, voltages, power, measurement, displays, sensors, motion, relays, switches, connectors, tools, storage, and other home-lab terms. It keeps up to three inferred tags. If no rule matches, a category-specific fallback is used; only an unknown category falls back to `General`.

Catalog startup also repairs records with empty tags or the old `General` placeholder. This guarantees that the current catalog has no tagless products, but it can update timestamps and therefore affect default inventory order.

## Media and attachment storage

R2 key patterns are:

```text
items/<item-id>/<three-digit-order>-<uuid>-<safe-filename>
attachments/<item-id>/<uuid>-<safe-filename>
```

`GET /api/media?key=...` streams an R2 object with its stored HTTP metadata, ETag, and a one-year immutable public cache header.

Product image upload behavior:

- direct form-data uploads use `/api/uploads`;
- the first image (`order = 0`) becomes the primary image;
- setting a thumbnail changes `primary_image_key` without duplicating the object;
- deleting the primary image returns HTTP 409 until another image is selected;
- image deletion removes both the database row and R2 object;
- image count is recomputed after changes.

Attachment behavior:

- maximum attachment size is 25 MB;
- filenames are preserved for downloads while object keys are sanitized and randomized;
- downloads use `Content-Disposition: attachment` and `Cache-Control: private, no-store`;
- deleting an attachment removes its R2 object and database row.

The repository also has a multipart R2 upload route. It can initialize an upload, accept numbered parts, and complete the object plus database row. The current catalog importer defines a multipart helper but does not call it; normal imports currently use direct upload after optional compression.

## Product ZIP export

`GET /api/export?id=<item-id>` creates an uncompressed ZIP in memory containing:

```text
item-details.json
item-details.md
images/<product image files>
attachments/<attachment files>
```

The JSON includes current item data, original taxonomy, image metadata, and attachment metadata. The Markdown is a human-readable summary. Duplicate filenames are made unique with numeric suffixes. Missing R2 objects are skipped rather than aborting the entire archive.

Suggested projects are intentionally excluded from the export.

Because the whole archive is assembled in memory with `zipSync` and compression level 0, very large products could exceed Worker memory limits. A streaming export would be the appropriate future improvement.

## Importing the recovered AliExpress and Temu catalog

The importer is `scripts/import-catalog.mjs`. It expects the following beside the `Website` directory:

```text
C:\Lab Orders\aliexpress\Ali Express.csv
C:\Lab Orders\aliexpress\Temu.csv
C:\Lab Orders\aliexpress\Ali Express Items\
C:\Lab Orders\aliexpress\Temu Items\
C:\Lab Orders\aliexpress\Website\
```

All source paths are computed relative to the parent of the website project. This corrects the original Temu absolute-path problem and avoids embedding one machine's stale path in application URLs. Original local paths are retained as provenance metadata; served images always use R2 pointers.

The AliExpress and Temu CSV schemas differ. The normalization step maps their equivalent concepts into one object:

- source and stable source-record hash;
- title/source title;
- enriched and plain descriptions;
- canonical category;
- price and currency text;
- estimated quantity;
- canonical tags;
- original category/tags;
- suggested projects;
- original HTML and resource paths;
- image paths.

The stable source ID is the first 20 hex characters of SHA-1 over the source, original HTML filename, and source product name. Importing the same source record again updates the existing row rather than creating a duplicate.

### Canonical import taxonomy

The importer reduces noisy source categories to these 20 user-facing categories:

1. Adhesives & Consumables
2. Audio
3. Automotive
4. Cables & Connectors
5. Computing & USB
6. Displays & Indicators
7. LEDs & Lighting
8. Mechanical & Hardware
9. Microcontrollers & Development Boards
10. Motors & Motion
11. Other
12. Passive Components
13. Power & Batteries
14. Prototyping & PCBs
15. Relays & Controls
16. Semiconductors & ICs
17. Sensors
18. Storage & Organization
19. Tools & Soldering
20. Wireless & Identification

Import tags are similarly derived from a controlled set of technical rules, while the original raw values remain in `inventory_original_taxonomy`.

### Import image handling

- Every listed image path is checked and included in `import-report.json`.
- Files larger than 900 KB are resized to fit within 1,600 x 1,600 without enlargement and converted to WebP at quality 78.
- If the result remains larger than 900 KB, it retries within 1,200 x 1,200 at quality 68.
- Smaller files are uploaded unchanged.
- Source image files are never modified.
- Already imported `source_path` values are skipped on subsequent runs.
- Upload jobs run eight at a time.

### Running an import

Start the local application first, then run:

```powershell
cd "C:\Lab Orders\aliexpress\Website"
npm run catalog:import
```

To target another running instance:

```powershell
$env:PARTS_ATLAS_URL = "https://example.invalid"
npm run catalog:import
```

To import/update database records without uploading images:

```powershell
npm run catalog:import -- --records-only
```

The script currently recognizes `--large-only` in its argument parsing but does not implement different behavior for it. Treat that flag as unfinished/dead code.

The import API accepts batches of normalized records and supports `?reset=1`, but reset is destructive and should not be used casually. The reset path deletes image and item rows from D1; it does not currently delete the corresponding R2 objects or all dependent taxonomy/attachment data, so it is not a complete safe reset operation.

## API reference

| Method and route | Purpose |
| --- | --- |
| `GET /api/items` | List items; optional `id`, `q`, `source`, `status`, and `limit` (maximum 1,000) |
| `POST /api/items` | Create an item and assign the next serial |
| `PUT /api/items` | Edit title, description, category, tags, and price text |
| `PATCH /api/items` | Change quantity or location/status |
| `DELETE /api/items?id=...` | Delete an item plus its image/attachment objects and rows |
| `GET /api/locations` | List locations; seeds defaults if empty |
| `POST /api/locations` | Create a root or child location |
| `GET /api/uploads?itemId=...` | List product images, default first |
| `POST /api/uploads` | Upload a product image |
| `PATCH /api/uploads` | Set the default thumbnail |
| `DELETE /api/uploads?itemId=...&id=...` | Delete a non-default image |
| `POST /api/uploads/multipart?action=init` | Start multipart image upload |
| `PUT /api/uploads/multipart?...` | Upload one multipart segment |
| `POST /api/uploads/multipart?action=complete` | Complete multipart upload and register the image |
| `GET /api/attachments?itemId=...` | List attachments |
| `GET /api/attachments?download=...` | Download an attachment |
| `POST /api/attachments` | Upload an attachment, maximum 25 MB |
| `DELETE /api/attachments?id=...` | Delete an attachment |
| `GET /api/media?key=...` | Stream an R2 object |
| `GET /api/export?id=...` | Download one complete product ZIP |
| `GET /api/import` | Return catalog/image status used by the importer |
| `POST /api/import` | Upsert normalized import records |
| `POST /api/identify` | Analyze an unknown image, compare candidates, or run the optional web analysis |
| `POST /api/product-assistant` | Product-context inventory-aware chat |
| `POST /api/lab-assistant` | General inventory-aware project/part chat |

API errors are returned as JSON with an `error` string except media/download responses, which may return plain HTTP error text.

## OpenAI integration

The identification and assistant routes call the OpenAI Responses API directly from the server. The browser never receives the API key.

Required local variable:

```dotenv
OPENAI_API_KEY=your_key_here
```

Optional model override:

```dotenv
OPENAI_MODEL=gpt-5.6-terra
```

If `OPENAI_MODEL` is absent, all three AI backends currently default to `gpt-5.6-terra`.

The existing ignored `.env.local` also contains a `GOOGLE_CLOUD_VISION_API_KEY` entry from the earlier Google web-detection experiment. No current application route reads that variable. Google Vision Web Detection was not considered equivalent to the Google Lens website and is not part of the active workflow.

Security rules:

- never commit `.env.local`;
- never put API keys in client components, README examples, screenshots, or browser storage;
- if a key was pasted into a chat or another exposed channel, revoke it and create a replacement;
- configure hosted secrets through the deployment environment rather than source control.

OpenAI requests use `store: false`. Identification images and product thumbnails are still transmitted to OpenAI when those features are used. The optional web analysis also enables the OpenAI `web_search` tool. These actions can incur API usage charges and depend on network/API availability.

## Local development

Requirements:

- Node.js 22.13 or newer;
- npm;
- the project folder and, for re-import, the sibling CSV/asset folders;
- an OpenAI API key only for identification and assistant features;
- a browser camera permission only for live identification.

Install and run:

```powershell
cd "C:\Lab Orders\aliexpress\Website"
npm install
npm run dev
```

Open:

```text
http://localhost:3000/
```

Useful scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vinext/Vite local development with local D1/R2 bindings |
| `npm run build` | Create a production build |
| `npm run start` | Start the built application |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Drizzle SQL from `db/schema.ts` |
| `npm run catalog:import` | Normalize and import both source catalogs and their media |
| `npm test` | Build, then run the rendered-HTML tests |

Do not run a full production build merely to validate a CSS-only change while the development server is already providing HMR. Run it when changes affect compilation, routing, server code, release verification, or when explicitly needed.

### Environment files

`.env*` is ignored by Git. The local project currently uses `.env.local`. There is no committed `.env.example` at the time of writing. If one is added, it must contain variable names and placeholders only, never real values.

### Local data

Local D1/R2 state is managed by the Cloudflare Vite plugin under project-local `.wrangler/`. Because this installation is intentionally local-only, the complete `.wrangler/` directory is tracked with Git LFS as part of the website backup. Stop the development server before committing so the SQLite database, R2 metadata, and R2 blobs form one consistent snapshot. Deleting that folder can remove the local catalog/media state used by the preview.

The CSV files and original AliExpress/Temu folders are import sources, not the live application's serving layer. Editing them does not update the database until the importer runs.

## Deployment

The project is configured for OpenAI Sites/Cloudflare-backed hosting through `.openai/hosting.json`. Production requires:

- a D1 database bound as `DB`;
- an R2 bucket bound as `UPLOADS`;
- the assets and image transformation bindings expected by the worker/runtime;
- `OPENAI_API_KEY` as a server secret for AI features;
- optionally `OPENAI_MODEL` as a server variable.

The local placeholder D1 ID in `vite.config.ts` is intentionally for local emulation and is not a production database identifier.

No deployment should assume that local `.wrangler` data is automatically copied to production. Catalog records and R2 objects need an explicit import/migration into the target environment.

## Authentication and security status

`app/chatgpt-auth.ts` contains helpers for ChatGPT-authenticated request headers and safe sign-in/sign-out return paths. The current pages and APIs do not call `requireChatGPTUser`, so there is no application-level authorization gate in the active inventory routes.

That is acceptable only for a trusted local environment or a hosting layer that independently restricts access. Before exposing PartsAtlas publicly, add and verify authorization for all read and mutation APIs, particularly:

- inventory and location data;
- media and attachment downloads;
- uploads and deletes;
- exports;
- AI endpoints, which spend API credits.

Other current security/operational characteristics:

- media responses use long-lived public caching once the object key is known;
- attachment downloads are private/no-store;
- upload filenames are sanitized in object keys;
- attachment size is limited, but direct product image upload has no explicit server-side size cap;
- AI image payloads are capped by encoded request length; candidate image loading also has size caps;
- there is no rate limiter or per-user quota in the route code;
- there is no CSRF protection beyond the hosting/browser environment;
- there is no audit log or undo history.

## Styling and UI organization

- `app/globals.css` contains global application styling.
- `app/review.css` contains the larger set of feature-review overrides and detailed component rules accumulated during iteration.
- The main pages are intentionally dense desktop inventory interfaces, but text sizing has been repeatedly adjusted for readability.
- Product imagery generally uses `object-fit: contain`; camera presentation has its own centered aspect-ratio rules.
- External product links use the external-link icon and open new tabs.
- Destructive image confirmation uses an in-app dialog rather than the browser's default message box.

The stylesheet history includes multiple overrides for the same components. Future visual work should consolidate selectors carefully rather than adding another override without checking cascade order.

## Repository map

```text
.openai/hosting.json               Sites project and D1/R2 binding names
app/layout.tsx                     Global metadata, fonts, and root layout
app/page.tsx                       Shell, overview, inventory, locations, preview panel
app/review.css                     Detailed feature and component styling
app/items/new/page.tsx             Dedicated add-item workflow
app/items/[id]/page.tsx            Full product management page and product chat modal
app/identify/page.tsx              Camera/photo identification experience
app/assistant/page.tsx             General inventory-aware lab assistant
app/api/items/route.ts             Catalog CRUD
app/api/locations/route.ts         Location list/create API
app/api/uploads/route.ts           Product image list/upload/default/delete API
app/api/uploads/multipart/route.ts Multipart R2 image API
app/api/attachments/route.ts       Attachment upload/download/delete API
app/api/media/route.ts             R2 media streaming API
app/api/export/route.ts            Per-product ZIP export
app/api/import/route.ts            Catalog import upsert/status API
app/api/identify/route.ts          Vision analysis and inventory comparison
app/api/product-assistant/route.ts Product-context assistant and inventory tools
app/api/lab-assistant/route.ts     General lab assistant and inventory tools
db/catalog.ts                      Runtime schema creation, invariants, row mapping
db/schema.ts                       Drizzle schema, including active and legacy tables
db/index.ts                        Drizzle D1 binding helper
drizzle/                           Generated SQL migrations/meta
scripts/import-catalog.mjs         CSV normalization and image ingestion
worker/index.ts                    Cloudflare/Vinext worker entry and image optimization
vite.config.ts                     Vinext, Sites, and local Cloudflare bindings
import-report.json                 Historical source-file audit from the importer
tests/rendered-html.test.mjs       Stale starter-template tests; see below
```

## Known limitations and technical debt

### Tests are stale

`tests/rendered-html.test.mjs` still tests the original Sites loading-skeleton starter. It expects files and metadata that no longer exist, including `app/_sites-preview`, `react-loading-skeleton`, and the title `Your site is taking shape`. The current `npm test` command builds first and then runs those obsolete assertions. These tests must be replaced with PartsAtlas tests before the command can be considered meaningful.

Recommended replacement coverage:

- item CRUD and four-digit serial allocation;
- automatic tag inference/fallback;
- zero quantity;
- location assignment/status transitions;
- default-thumbnail ordering and deletion protection;
- attachment limits and cleanup;
- export contents;
- importer idempotency;
- identification candidate ranking with mocked OpenAI/R2;
- assistant tool-call loops with mocked OpenAI;
- inventory filters and persistence;
- product page and add-item browser flows.

### Runtime schema and migrations overlap

The app creates/repairs its active schema dynamically in `ensureCatalog()`, while Drizzle migration files and older table declarations also exist. A production hardening pass should choose a single migration authority, move repair/backfill steps into explicit migrations, and remove or archive unused legacy declarations.

### Scale limits

- Four-digit labels cap the catalog at 9,999 items.
- `/api/items` caps a response at 1,000 rows.
- The inventory and both assistants currently load the entire returned catalog into memory.
- Client filtering is suitable for the current 520 products but needs pagination/indexed server-side facets at larger scale.
- AI inventory ranking is an in-process lexical scan, not a vector index.
- ZIP export is fully assembled in memory.

### Search limitations

- Inventory API `q` searches title, tags, and serial; the page adds category search only after loading data.
- Search is SQL `LIKE` plus simple token scoring, without typo tolerance, stemming, or embeddings.
- Product identification visually compares only the default thumbnail of each shortlisted candidate, not every stored image.
- A confirmed previous identification is not fed back as training data or a permanent similarity signal.
- Confidence is model-generated and should be treated as guidance, not measurement.

### Data-model limitations

- A product has one category, not multiple categories.
- Price is not normalized into amount/currency fields for arithmetic, conversion, or reports.
- Locations lack rename, move, delete, uniqueness, and cycle-validation management APIs.
- `notes`, `currency`, original listing paths, and original taxonomy are not all editable in the main UI.
- `suggested_projects` remains in the data model but is intentionally absent from navigation and exports.
- There are no formal foreign keys or cascading database constraints.
- Deleting a source product cannot currently be undone.

### Import limitations

- The import API's reset option is incomplete and can orphan R2 data.
- The `--large-only` flag is parsed but unused.
- Import currency extraction includes signs recovered from CSV text and may contain mojibake from older encoding.
- Import quantity is forced to at least one, whereas manually created/edited inventory quantity may be zero.
- Source category/tag classification uses regular expressions and will always have edge cases.

### AI and external-service limitations

- AI features require a valid paid API key and network access.
- There is no retry/backoff, timeout policy, streaming answer UI, moderation layer, rate limiter, or usage dashboard.
- A model response can still be incomplete or wrong despite strict schemas and inventory tools.
- Web analysis can be slow because it invokes both vision and web search.
- Marketplace links are conventional Google text searches, not direct marketplace APIs or Google Lens.
- The unused Google Vision key should be removed if that experiment is permanently abandoned.

### UI and accessibility work remaining

- Settings and Help & feedback are not complete administration areas.
- Responsive behavior is optimized primarily for the current desktop workflow.
- Keyboard navigation, focus trapping, screen-reader labels, contrast, and reduced-motion behavior need a dedicated audit.
- Long titles and unusual images should continue to be tested in both grid and list modes.
- CSS should be consolidated to reduce regression risk.

## Backup and recovery recommendations

A complete PartsAtlas backup requires both sides of the storage model:

1. Stop the local development server so D1 and R2 are not being modified.
2. Commit the complete Git-LFS-managed `.wrangler/` directory, which contains the local D1 database and R2 image/attachment storage.
3. Keep the original CSV files and AliExpress/Temu asset folders as provenance and a partial rebuild source.
4. Keep environment-variable names/documentation, but never store secret values in the backup repository.
5. Verify recovery into an isolated environment before relying on the backup.

The per-product ZIP export is useful for portable item records but is not a replacement for the Git-LFS-managed whole local catalog backup. A restored clone must fetch Git LFS objects and should use the locked Wrangler/Miniflare dependency versions. There is not yet a bulk `Export all products` archive route.

## Troubleshooting

### The site does not open

- Confirm `npm run dev` is running in the Website directory.
- Open `http://localhost:3000/`.
- Check that Node meets the minimum version.
- Inspect terminal errors from Vinext, Vite, or the Cloudflare plugin.

### The database or images appear empty

- Confirm `.openai/hosting.json` still names `DB` and `UPLOADS`.
- Do not delete `.wrangler/` if it contains the only local state.
- Make sure the app was started from the correct project directory.
- If rebuilding, run the catalog importer only after verifying the sibling CSV and asset paths.

### AI says the key is missing

- Put `OPENAI_API_KEY=...` in ignored `.env.local`.
- Restart the development server after changing environment variables.
- Do not use a browser/client-side environment variable prefix.

### Camera selection is empty or the feed is blank

- Grant camera permission to `localhost`.
- Press the camera-list refresh control.
- Try `Default camera`, then select the desired device again.
- Stop other applications that may exclusively hold the camera.
- Use photo upload as a fallback.

### An image cannot be deleted

The default thumbnail is protected. Select another image, choose `Set as thumbnail`, and then delete the former default image.

### An imported image is missing

- Inspect `import-report.json` for source-file findings.
- Confirm the CSV image filename maps to the correct product resource directory.
- Check whether the source path is already registered in `/api/import` status.
- Inspect the importer output for failed uploads.

## Near-term hardening priorities

1. Replace the stale starter tests with real API and browser tests.
2. Add authentication/authorization before any public exposure.
3. Add whole-catalog backup/export and a tested restore command.
4. Consolidate runtime schema creation into explicit migrations.
5. Add server-side pagination, sorting controls, and better search.
6. Normalize optional price amount/currency while retaining the original display text.
7. Add full location management.
8. Compare more than one candidate image during identification, within cost and payload limits.
9. Add AI request timeout/retry/streaming and usage visibility.
10. Consolidate CSS and complete an accessibility/responsive audit.

## Final operational note

PartsAtlas already contains real inventory data and media. Treat D1, R2, `.wrangler`, the original order folders, and `.env.local` as valuable state. Before destructive cleanup, re-import, reset, migration, or deployment work, verify the exact target and create a recoverable backup.
