"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  FolderPlus,
  FolderTree,
  ImagePlus,
  Images,
  LoaderCircle,
  MapPin,
  Minus,
  PackagePlus,
  Paperclip,
  Plus,
  Save,
  Search,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";

type InventoryItem = { category?: string; tags?: string[] };
type Location = { id: number; name: string; parent_id: number | null };
type DraftImage = { id: string; file: File; url: string };

async function webReadyImage(file: File) {
  if (file.size < 800 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.8),
  );
  bitmap.close();
  return blob
    ? new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, {
        type: "image/webp",
      })
    : file;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NewItemPage() {
  const [categories, setCategories] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [source, setSource] = useState("Manual");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [defaultImageId, setDefaultImageId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<number | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/items?limit=1000").then((response) => response.json()),
      fetch("/api/locations").then((response) => response.json()),
    ])
      .then(([itemData, locationData]) => {
        const items = (itemData.items || []) as InventoryItem[];
        setCategories(
          [...new Set(items.map((item) => item.category || "").filter(Boolean))].sort(
            (a, b) => a.localeCompare(b),
          ),
        );
        setAvailableTags(
          [...new Set(items.flatMap((item) => item.tags || []).filter(Boolean))].sort(
            (a, b) => a.localeCompare(b),
          ),
        );
        setLocations(locationData.locations || []);
      })
      .catch(() => setError("Could not load the existing inventory choices."));
  }, []);

  const defaultImage =
    images.find((image) => image.id === defaultImageId) || images[0] || null;
  const matchingTags = useMemo(() => {
    const query = tagInput.trim().toLowerCase();
    return availableTags
      .filter((tag) => !tags.includes(tag) && (!query || tag.toLowerCase().includes(query)))
      .slice(0, 16);
  }, [availableTags, tagInput, tags]);

  function chooseImages(files: FileList | null) {
    if (!files) return;
    const next = [...files]
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      }));
    if (!next.length) return;
    setImages((current) => [...current, ...next]);
    setDefaultImageId((current) => current || next[0].id);
  }

  function removeImage(image: DraftImage) {
    URL.revokeObjectURL(image.url);
    const remaining = images.filter((candidate) => candidate.id !== image.id);
    setImages(remaining);
    if (defaultImageId === image.id) setDefaultImageId(remaining[0]?.id || null);
  }

  function addTag(value = tagInput) {
    const normalized = value.trim();
    if (!normalized) return;
    setTags((current) =>
      current.some((tag) => tag.toLowerCase() === normalized.toLowerCase())
        ? current
        : [...current, normalized],
    );
    setTagInput("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError("Product name is required.");
    if (!category.trim()) return setError("Category is required.");
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category: category.trim(),
          tags,
          price: price.trim(),
          quantity,
          source,
          locationId,
          status: locationId ? "Stored" : "Unsorted",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create item");
      const itemId = Number(data.item.id);
      setCreatedId(itemId);

      const orderedImages = [
        ...images.filter((image) => image.id === defaultImageId),
        ...images.filter((image) => image.id !== defaultImageId),
      ];
      for (let order = 0; order < orderedImages.length; order++) {
        const upload = new FormData();
        upload.append("itemId", String(itemId));
        upload.append("order", String(order));
        upload.append("file", await webReadyImage(orderedImages[order].file));
        const uploadResponse = await fetch("/api/uploads", {
          method: "POST",
          body: upload,
        });
        if (!uploadResponse.ok) {
          const result = await uploadResponse.json();
          throw new Error(result.error || "An image could not be uploaded");
        }
      }

      for (const file of attachments) {
        const upload = new FormData();
        upload.append("itemId", String(itemId));
        upload.append("file", file);
        const uploadResponse = await fetch("/api/attachments", {
          method: "POST",
          body: upload,
        });
        if (!uploadResponse.ok) {
          const result = await uploadResponse.json();
          throw new Error(result.error || "An attachment could not be uploaded");
        }
      }
      window.location.href = `/items/${itemId}`;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create item");
      setSaving(false);
    }
  }

  return (
    <main className="new-item-page">
      <header className="new-item-top">
        <Link href="/?view=Inventory">
          <ArrowLeft /> Back to inventory
        </Link>
        <div>
          <span>New inventory item</span>
          <Link href="/?view=Inventory" className="new-item-cancel">
            Cancel
          </Link>
          <button type="submit" form="new-item-form" disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Save />}
            {saving ? "Creating item…" : "Create item"}
          </button>
        </div>
      </header>

      <form id="new-item-form" className="new-item-layout" onSubmit={submit}>
        <section className="new-item-media new-item-card">
          <div className="new-item-section-head">
            <div>
              <Images />
              <span>
                <b>Product images</b>
                <small>Choose the image you will recognize most easily.</small>
              </span>
            </div>
            <button type="button" onClick={() => imageInput.current?.click()}>
              <ImagePlus /> Add images
            </button>
            <input
              ref={imageInput}
              hidden
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                chooseImages(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <button
            type="button"
            className={`new-item-image-stage ${defaultImage ? "has-image" : ""}`}
            onClick={() => imageInput.current?.click()}
          >
            {defaultImage ? (
              <img src={defaultImage.url} alt="Default product preview" />
            ) : (
              <span>
                <ImagePlus />
                <b>Add clear product photos</b>
                <small>PNG, JPG, WEBP, or other browser-supported images</small>
              </span>
            )}
          </button>

          {images.length > 0 && (
            <div className="new-item-image-grid">
              {images.map((image) => {
                const isDefault = image.id === defaultImageId;
                return (
                  <article className={isDefault ? "default" : ""} key={image.id}>
                    <button type="button" onClick={() => setDefaultImageId(image.id)}>
                      <img src={image.url} alt={image.file.name} />
                      {isDefault && <span><Star />Default</span>}
                    </button>
                    <button
                      type="button"
                      className="remove"
                      onClick={() => removeImage(image)}
                      aria-label={`Remove ${image.file.name}`}
                    >
                      <Trash2 />
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          <div className="new-item-attachments">
            <div className="new-item-section-head">
              <div>
                <Paperclip />
                <span>
                  <b>Files and attachments</b>
                  <small>Datasheets, manuals, receipts, or wiring diagrams.</small>
                </span>
              </div>
              <button type="button" onClick={() => attachmentInput.current?.click()}>
                <Plus /> Add file
              </button>
              <input
                ref={attachmentInput}
                hidden
                type="file"
                multiple
                onChange={(event) => {
                  setAttachments((current) => [
                    ...current,
                    ...[...(event.target.files || [])],
                  ]);
                  event.target.value = "";
                }}
              />
            </div>
            {attachments.length ? (
              <div className="new-item-file-list">
                {attachments.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}-${index}`}>
                    <FileText />
                    <span><b>{file.name}</b><small>{fileSize(file.size)}</small></span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((current) => current.filter((_, i) => i !== index))
                      }
                      aria-label={`Remove ${file.name}`}
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="new-item-no-files"><Paperclip />No attachments selected</div>
            )}
          </div>
        </section>

        <section className="new-item-details new-item-card">
          <div className="new-item-intro">
            <span><PackagePlus /></span>
            <div><p>ADD TO INVENTORY</p><h1>Create a new item</h1><small>The four-digit serial number will be assigned automatically.</small></div>
          </div>

          <div className="new-item-fields">
            <label className="wide">
              <span>Product name <em>Required</em></span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. ESP32 development board" required />
            </label>
            <label className="wide">
              <span>Description</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Specifications, markings, intended use, or anything that will help identify it later…" />
            </label>
            <label>
              <span>Category <em>Required</em></span>
              <input value={category} onChange={(event) => setCategory(event.target.value)} list="new-item-categories" placeholder="Select or type a category" required />
              <datalist id="new-item-categories">{categories.map((value) => <option value={value} key={value} />)}</datalist>
              <small>A new category is created when the name does not already exist.</small>
            </label>
            <label>
              <span>Source</span>
              <select value={source} onChange={(event) => setSource(event.target.value)}>
                <option>Manual</option><option>AliExpress</option><option>Temu</option><option>Amazon</option><option>Other</option>
              </select>
            </label>
            <label>
              <span>Price</span>
              <input value={price} onChange={(event) => setPrice(event.target.value)} placeholder="e.g. ₪29.90 or $8.50" />
              <small>Leave empty when the price is unknown.</small>
            </label>
            <label>
              <span>Units in inventory</span>
              <div className="new-item-quantity">
                <button type="button" disabled={quantity === 0} onClick={() => setQuantity((value) => Math.max(0, value - 1))}><Minus /></button>
                <input type="number" min="0" value={quantity} onChange={(event) => setQuantity(Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0))} />
                <button type="button" onClick={() => setQuantity((value) => value + 1)}><Plus /></button>
              </div>
            </label>
          </div>

          <section className="new-item-tags">
            <div className="new-item-subhead"><Tag /><span><b>Tags</b><small>Select existing tags or type a new one.</small></span></div>
            {tags.length > 0 && <div className="new-item-selected-tags">{tags.map((tag) => <button type="button" key={tag} onClick={() => setTags((current) => current.filter((value) => value !== tag))}>{tag}<X /></button>)}</div>}
            <div className="new-item-tag-entry"><Search /><input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="Find or create a tag…" /><button type="button" onClick={() => addTag()} disabled={!tagInput.trim()}><Plus />Add</button></div>
            {matchingTags.length > 0 && <div className="new-item-tag-options">{matchingTags.map((tag) => <button type="button" key={tag} onClick={() => addTag(tag)}>{tag}</button>)}</div>}
          </section>

          <LocationSelector locations={locations} selected={locationId} onSelect={setLocationId} onLocations={setLocations} />

          {error && <div className="new-item-error"><span>{error}</span>{createdId && <Link href={`/items/${createdId}`}>Open the created item</Link>}</div>}
        </section>
      </form>
    </main>
  );
}

function LocationSelector({ locations, selected, onSelect, onLocations }: { locations: Location[]; selected: number | null; onSelect: (id: number | null) => void; onLocations: (locations: Location[]) => void }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const selectedLocation = locations.find((location) => location.id === selected);

  async function createLocation() {
    if (!newName.trim()) return;
    const response = await fetch("/api/locations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newName.trim(), parentId: selected }) });
    const data = await response.json();
    if (!response.ok) return;
    const created = data.location as Location;
    onLocations([...locations, created]);
    onSelect(created.id);
    setNewName("");
    setCreating(false);
  }

  const shown = query.trim()
    ? locations.filter((location) => location.name.toLowerCase().includes(query.trim().toLowerCase()))
    : locations;

  function render(parentId: number | null, depth = 0): ReactNode {
    return shown
      .filter((location) => (location.parent_id ?? null) === parentId)
      .map((location) => (
        <div key={location.id}>
          <button type="button" className={selected === location.id ? "selected" : ""} style={{ paddingLeft: 12 + depth * 22 }} onClick={() => onSelect(location.id)}>
            <ChevronRight /><Archive /><span>{location.name}</span>{selected === location.id && <Check />}
          </button>
          {!query.trim() && render(location.id, depth + 1)}
        </div>
      ));
  }

  return (
    <section className="new-item-location">
      <div className="new-item-subhead"><MapPin /><span><b>Location</b><small>{selectedLocation ? `Selected: ${selectedLocation.name}` : "No location selected"}</small></span><button type="button" onClick={() => setCreating((value) => !value)}><FolderPlus />New location</button></div>
      <label className="new-item-location-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a shelf, box, drawer, or bag…" /></label>
      <div className="new-item-location-tree">
        <button type="button" className={selected === null ? "selected" : ""} onClick={() => onSelect(null)}><FolderTree /><span>Not assigned</span>{selected === null && <Check />}</button>
        {query.trim() ? shown.map((location) => <button type="button" className={selected === location.id ? "selected" : ""} key={location.id} onClick={() => onSelect(location.id)}><Archive /><span>{location.name}</span>{selected === location.id && <Check />}</button>) : render(null)}
      </div>
      {creating && <div className="new-item-create-location"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={selectedLocation ? `New location inside ${selectedLocation.name}` : "New root location"} /><button type="button" onClick={createLocation} disabled={!newName.trim()}><Plus />Create</button></div>}
    </section>
  );
}
