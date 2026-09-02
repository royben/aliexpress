"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Box,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  ImagePlus,
  Images,
  LoaderCircle,
  MapPin,
  Minus,
  PackagePlus,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";

type Item = {
  id: number;
  serial: string;
  title: string;
  category: string;
  source: string;
  location: string;
  location_id?: number | null;
  quantity: number;
  image: string;
  description: string;
  tags: string[];
  imageCount?: number;
  price_text?: string;
};
type ProductImage = {
  id: number;
  object_key: string;
  url: string;
  filename: string;
  size: number;
};
type Location = { id: number; name: string; parent_id: number | null };
type Attachment = {
  id: number;
  filename: string;
  content_type: string;
  size: number;
  created_at: string;
  url: string;
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function locationPath(id: number | null | undefined, locations: Location[]) {
  if (!id) return "Not assigned";
  const byId = new Map(locations.map((location) => [location.id, location]));
  const parts: string[] = [];
  const visited = new Set<number>();
  let current = byId.get(id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    parts.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return parts.join(" → ") || "Not assigned";
}

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

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [images, setImages] = useState<ProductImage[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState("");
  const [related, setRelated] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [catalogTags, setCatalogTags] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [recentLocationIds, setRecentLocationIds] = useState<number[]>([]);
  const [locationOpen, setLocationOpen] = useState(false);
  const [hero, setHero] = useState("");
  const [thumbnailMessage, setThumbnailMessage] = useState("");
  const [imageDeletingId, setImageDeletingId] = useState<number | null>(null);
  const [imagePendingDelete, setImagePendingDelete] = useState<ProductImage | null>(null);
  const [quantitySaving, setQuantitySaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const load = async () => {
    const [itemData, imageData, catalogData, locationData, attachmentData] =
      await Promise.all([
        fetch(`/api/items?id=${id}`).then((r) => r.json()),
        fetch(`/api/uploads?itemId=${id}`).then((r) => r.json()),
        fetch("/api/items?limit=1000").then((r) => r.json()),
        fetch("/api/locations").then((r) => r.json()),
        fetch(`/api/attachments?itemId=${id}`).then((r) => r.json()),
      ]);
    const next = itemData.items?.[0] || null;
    const candidates: Item[] = catalogData.items || [];
    const ranked = next
      ? candidates
          .filter((candidate) => candidate.id !== next.id)
          .map((candidate) => {
            const sharedTags = candidate.tags.filter((tag) =>
              next.tags.includes(tag),
            ).length;
            const score =
              (candidate.category === next.category ? 10 : 0) +
              sharedTags * 3 +
              (candidate.source === next.source ? 1 : 0);
            return { candidate, score };
          })
          .filter((entry) => entry.score > 0)
          .sort(
            (a, b) =>
              b.score - a.score ||
              a.candidate.title.localeCompare(b.candidate.title),
          )
          .slice(0, 4)
          .map((entry) => entry.candidate)
      : [];
    setItem(next);
    setImages(imageData.images || []);
    setRelated(ranked);
    setCategories(
      [
        ...new Set(
          candidates.map((candidate) => candidate.category).filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    );
    setCatalogTags(
      [
        ...new Set(
          candidates.flatMap((candidate) => candidate.tags).filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    );
    setLocations(locationData.locations || []);
    setAttachments(attachmentData.attachments || []);
    setHero(next?.image || imageData.images?.[0]?.url || "");
    setLoading(false);
  };
  useEffect(() => {
    load();
    try {
      const saved = JSON.parse(
        localStorage.getItem("parts-atlas-recent-locations") || "[]",
      );
      if (Array.isArray(saved))
        setRecentLocationIds(saved.filter(Number.isInteger).slice(0, 5));
    } catch {}
  }, [id]);
  async function upload(files: FileList | null) {
    if (!files || !item) return;
    for (let index = 0; index < files.length; index++) {
      const form = new FormData();
      form.append("itemId", String(item.id));
      form.append("order", String(images.length + index));
      form.append("file", await webReadyImage(files[index]));
      await fetch("/api/uploads", { method: "POST", body: form });
    }
    await load();
  }
  async function uploadAttachments(files: FileList | null) {
    if (!files?.length || !item || attachmentBusy) return;
    setAttachmentBusy(true);
    setAttachmentMessage("");
    try {
      for (let index = 0; index < files.length; index++) {
        const form = new FormData();
        form.append("itemId", String(item.id));
        form.append("file", files[index]);
        const response = await fetch("/api/attachments", {
          method: "POST",
          body: form,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || `Could not upload ${files[index].name}`,
          );
      }
      const data = await fetch(`/api/attachments?itemId=${item.id}`).then(
        (response) => response.json(),
      );
      setAttachments(data.attachments || []);
      setAttachmentMessage(
        `${files.length} ${files.length === 1 ? "file" : "files"} added`,
      );
    } catch (error) {
      setAttachmentMessage(
        error instanceof Error ? error.message : "Attachment upload failed",
      );
    } finally {
      setAttachmentBusy(false);
      if (attachmentInput.current) attachmentInput.current.value = "";
    }
  }
  async function deleteAttachment(attachment: Attachment) {
    if (attachmentBusy || !window.confirm(`Delete ${attachment.filename}?`))
      return;
    setAttachmentBusy(true);
    setAttachmentMessage("");
    const response = await fetch(`/api/attachments?id=${attachment.id}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (response.ok) {
      setAttachments((current) =>
        current.filter((file) => file.id !== attachment.id),
      );
      setAttachmentMessage("Attachment deleted");
    } else setAttachmentMessage(result.error || "Could not delete attachment");
    setAttachmentBusy(false);
  }
  async function saveDetails(details: {
    title: string;
    description: string;
    category: string;
    tags: string[];
    priceText: string;
  }) {
    if (!item) return;
    const response = await fetch("/api/items", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, ...details }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not save product details");
    setItem({ ...item, ...result.item });
    setCategories((current) =>
      [...new Set([...current, result.item.category])].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
    setCatalogTags((current) =>
      [...new Set([...current, ...result.item.tags])].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
    setEditOpen(false);
  }
  async function setDefaultThumbnail() {
    const selected = images.find((image) => image.url === hero);
    if (!item || !selected) return;
    setThumbnailMessage("Savingâ€¦");
    const response = await fetch("/api/uploads", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: item.id, imageId: selected.id }),
    });
    const result = await response.json();
    if (!response.ok) {
      setThumbnailMessage(result.error || "Could not update thumbnail");
      return;
    }
    setItem({ ...item, image: result.url });
    setImages([selected, ...images.filter((image) => image.id !== selected.id)]);
    setThumbnailMessage("Default thumbnail updated");
  }
  async function deleteImage(image: ProductImage) {
    if (!item || imageDeletingId) return;
    setImageDeletingId(image.id);setThumbnailMessage("");
    try {
      const response=await fetch(`/api/uploads?itemId=${item.id}&id=${image.id}`,{method:"DELETE"});const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Could not delete image");
      const remaining=images.filter(candidate=>candidate.id!==image.id);
      setImages(remaining);setItem({...item,image:result.primaryUrl||"",imageCount:remaining.length});
      if(hero===image.url)setHero(result.primaryUrl||remaining[0]?.url||"");
      setThumbnailMessage("Image deleted");
    } catch(error) {setThumbnailMessage(error instanceof Error?error.message:"Could not delete image")}
    finally {setImageDeletingId(null);setImagePendingDelete(null)}
  }
  async function changeQuantity(change: number) {
    if (!item || quantitySaving) return;
    const quantity = Math.max(0, item.quantity + change);
    if (quantity === item.quantity) return;
    setQuantitySaving(true);
    const response = await fetch("/api/items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, quantity }),
    });
    if (response.ok) setItem({ ...item, quantity });
    setQuantitySaving(false);
  }
  async function saveLocation(locationId: number | null) {
    if (!item) return;
    const response = await fetch("/api/items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, locationId }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not update location");
    setItem({
      ...item,
      location_id: locationId,
      location: result.location || "Unsorted",
    });
    if (locationId) {
      const next = [
        locationId,
        ...recentLocationIds.filter((value) => value !== locationId),
      ].slice(0, 5);
      setRecentLocationIds(next);
      localStorage.setItem(
        "parts-atlas-recent-locations",
        JSON.stringify(next),
      );
    }
    setLocationOpen(false);
  }
  async function createLocation(name: string, parentId: number | null) {
    const response = await fetch("/api/locations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not create location");
    const created = result.location as Location;
    setLocations((current) => [...current, created]);
    return created.id;
  }
  if (loading)
    return (
      <main className="product-page-state">
        <Box />
        <p>Loading product…</p>
      </main>
    );
  if (!item)
    return (
      <main className="product-page-state">
        <Box />
        <h1>Product not found</h1>
        <Link href="/">Return to inventory</Link>
      </main>
    );
  const selectedImage = images.find((image) => image.url === hero);
  const isDefault = Boolean(selectedImage && hero === item.image);
  const marketplaceSearchLinks = [
    {name:"AliExpress",url:`https://www.google.com/search?q=${encodeURIComponent(`site:aliexpress.com ${item.title}`)}`},
    {name:"Temu",url:`https://www.google.com/search?q=${encodeURIComponent(`site:temu.com ${item.title}`)}`},
    {name:"Amazon",url:`https://www.google.com/search?q=${encodeURIComponent(`site:amazon.com ${item.title}`)}`},
  ];
  return (
    <main className="product-page">
      <header className="product-top">
        <Link href="/">
          <ArrowLeft />
          Back to PartsAtlas
        </Link>
        <div>
          <span>{item.serial}</span>
          <b>{item.source}</b>
        </div>
      </header>
      <div className="product-layout">
        <section className="product-media">
          <div className="product-hero">
            {hero ? (
              <ZoomableProductImage src={hero} alt={item.title} />
            ) : (
              <div className="no-photo">
                <ImagePlus />
                <span>No product image</span>
              </div>
            )}
          </div>
          <div className="product-gallery-head">
            <div>
              <Images />
              <span>
                <b>Product images</b>
                <small>
                  {thumbnailMessage || `${images.length} stored images`}
                </small>
              </span>
            </div>
            <div className="product-gallery-actions">
              <button
                className={`thumbnail-button ${isDefault ? "is-default" : ""}`}
                disabled={!selectedImage || isDefault}
                onClick={setDefaultThumbnail}
              >
                <Star />
                {isDefault ? "Default thumbnail" : "Set as thumbnail"}
              </button>
              <button onClick={() => input.current?.click()}>
                <ImagePlus />
                Add images
              </button>
            </div>
            <input
              ref={input}
              hidden
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => upload(e.target.files)}
            />
          </div>
          <div className="product-gallery">
            {images.map((image, index) => (
              <div className={`product-gallery-item ${hero === image.url ? "active" : ""} ${item.image === image.url ? "default" : ""}`} key={image.id}>
                <button className="gallery-preview" onClick={() => {setHero(image.url);setThumbnailMessage("")}}>
                  <img src={image.url} alt={`${item.title} image ${index + 1}`} />
                  {item.image === image.url && <span className="default-star" title="Default thumbnail"><Star /></span>}
                </button>
                <button className="gallery-delete" aria-label={`Delete image ${index + 1}`} title="Delete image" disabled={imageDeletingId===image.id} onClick={()=>setImagePendingDelete(image)}><Trash2 /></button>
              </div>
            ))}
          </div>
        </section>
        <section className="product-info">
          <div className="product-source">
            <span>{item.source}</span>
            <div className="product-source-actions">
              <button
                className="edit-product-button"
                onClick={() => setEditOpen(true)}
              >
                <Pencil />
                Edit details
              </button>
              <a className="product-export-button" href={`/api/export?id=${item.id}`}>
                <Download />
                Export item
              </a>
            </div>
          </div>
          <h1>{item.title}</h1>
          <div className="product-tags">
            <span className="category">
              <Tag />
              {item.category}
            </span>
            {item.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <p className="product-description">
            {item.description || "No description has been added yet."}
          </p>
          <dl className="product-facts">
            <div>
              <dt>Serial number</dt>
              <dd>{item.serial}</dd>
            </div>
            <div className="quantity-row">
              <dt>Units in inventory</dt>
              <dd>
                <div className="quantity-stepper">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={quantitySaving || item.quantity === 0}
                    onClick={() => changeQuantity(-1)}
                  >
                    <Minus />
                  </button>
                  <strong>{item.quantity}</strong>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={quantitySaving}
                    onClick={() => changeQuantity(1)}
                  >
                    <Plus />
                  </button>
                </div>
                <small>
                  {quantitySaving ? "Savingâ€¦" : "Saved automatically"}
                </small>
              </dd>
            </div>
            <div className="product-location-row">
              <dt>Location</dt>
              <dd>
                <button type="button" onClick={() => setLocationOpen(true)}>
                  <MapPin />
                  <span>{locationPath(item.location_id, locations)}</span>
                  <ChevronRight />
                </button>
              </dd>
            </div>
            <div className="product-price-row">
              <dt>Price</dt>
              <dd className={item.price_text ? "" : "missing-value"}>
                {item.price_text || "No price recorded"}
              </dd>
            </div>
          </dl>
          <button className="product-ai" onClick={() => setAssistantOpen(true)}>
            <Sparkles />
            <span>
              <b>Ask the lab assistant</b>
              <small>
                Find specifications, compatible parts, and project ideas
              </small>
            </span>
          </button>
          <section className="product-files">
            <div>
              <span>
                <h2>Files and attachments</h2>
                {attachmentMessage && <small>{attachmentMessage}</small>}
              </span>
              <button
                disabled={attachmentBusy}
                onClick={() => attachmentInput.current?.click()}
              >
                <Paperclip />
                {attachmentBusy ? "Uploading…" : "Add file"}
              </button>
              <input
                ref={attachmentInput}
                hidden
                type="file"
                multiple
                onChange={(event) => uploadAttachments(event.target.files)}
              />
            </div>
            {attachments.length === 0 ? (
              <div className="product-empty-file">
                <PackagePlus />
                <span>
                  <b>No attachments yet</b>
                  <small>
                    Add datasheets, manuals, receipts, or wiring diagrams.
                  </small>
                </span>
              </div>
            ) : (
              <div className="product-attachment-list">
                {attachments.map((attachment) => (
                  <div className="product-attachment" key={attachment.id}>
                    <span className="attachment-file-icon">
                      <FileText />
                    </span>
                    <span className="attachment-name">
                      <b>{attachment.filename}</b>
                      <small>{fileSize(attachment.size)}</small>
                    </span>
                    <a
                      href={attachment.url}
                      download
                      title={`Download ${attachment.filename}`}
                    >
                      <Download />
                      <span>Download</span>
                    </a>
                    <button
                      disabled={attachmentBusy}
                      onClick={() => deleteAttachment(attachment)}
                      aria-label={`Delete ${attachment.filename}`}
                      title={`Delete ${attachment.filename}`}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <nav className="product-marketplace-links" aria-label="Search product on marketplaces">
            {marketplaceSearchLinks.map(marketplace=><a key={marketplace.name} href={marketplace.url} target="_blank" rel="noreferrer"><Search/>{marketplace.name}<ExternalLink/></a>)}
          </nav>
        </section>
      </div>
      {related.length > 0 && (
        <section className="related-section">
          <div className="related-head">
            <div>
              <p className="eyebrow">More from your lab</p>
              <h2>Related items</h2>
              <span>Matched by category and shared tags</span>
            </div>
          </div>
          <div className="related-grid">
            {related.map((relatedItem) => (
              <Link
                className="related-card"
                href={`/items/${relatedItem.id}`}
                key={relatedItem.id}
              >
                <div className="related-image">
                  {relatedItem.image ? (
                    <img src={relatedItem.image} alt={relatedItem.title} />
                  ) : (
                    <ImagePlus />
                  )}
                </div>
                <div className="related-copy">
                  <span>{relatedItem.serial}</span>
                  <h3>{relatedItem.title}</h3>
                  <p>
                    <Tag />
                    {relatedItem.category}
                  </p>
                  <div>
                    {relatedItem.tags.slice(0, 2).map((tag) => (
                      <small key={tag}>{tag}</small>
                    ))}
                  </div>
                  <strong>
                    View item <ArrowRight />
                  </strong>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      {locationOpen && (
        <LocationDialog
          locations={locations}
          selectedId={item.location_id ?? null}
          recentIds={recentLocationIds}
          onClose={() => setLocationOpen(false)}
          onSave={saveLocation}
          onCreate={createLocation}
        />
      )}
      {editOpen && (
        <ProductEditDialog
          item={item}
          categories={categories}
          availableTags={catalogTags}
          onClose={() => setEditOpen(false)}
          onSave={saveDetails}
        />
      )}
      {imagePendingDelete && (
        <ImageDeleteDialog
          image={imagePendingDelete}
          deleting={imageDeletingId === imagePendingDelete.id}
          onClose={() => !imageDeletingId && setImagePendingDelete(null)}
          onConfirm={() => deleteImage(imagePendingDelete)}
        />
      )}
      {assistantOpen && (
        <ProductAssistantDialog
          item={item}
          onClose={() => setAssistantOpen(false)}
        />
      )}
    </main>
  );
}

type ProductChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  references?: Item[];
};

function ProductAssistantDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [messages, setMessages] = useState<ProductChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Hey Roy, ask me anything about this product",
    },
  ]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function send(question: string) {
    const value = question.trim();
    if (!value || sending) return;
    const userMessage: ProductChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: value,
    };
    const requestMessages = [...messages, userMessage];
    setMessages(requestMessages);
    setText("");
    setError("");
    setSending(true);
    try {
      const response = await fetch("/api/product-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          messages: requestMessages.map(({ role, text }) => ({ role, text })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The assistant could not answer");
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.answer,
          references: result.references || [],
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The assistant could not answer");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="product-assistant-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="product-assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="product-assistant-title">
        <header>
          <div className="product-assistant-heading">
            <span><Bot /></span>
            <div><h2 id="product-assistant-title">Ask the lab assistant</h2><p><i />Product context is active</p></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close assistant"><X /></button>
        </header>

        <div className="product-assistant-context">
          <div>{item.image ? <img src={item.image} alt="" /> : <Box />}</div>
          <span><small>Currently discussing</small><b>{item.title}</b><em>{item.serial} · {item.category}</em></span>
        </div>

        <div className="product-assistant-messages">
          {messages.map((message) => (
            <article className={message.role} key={message.id}>
              {message.role === "assistant" && <span className="assistant-avatar"><Sparkles /></span>}
              <div className="product-chat-bubble">
                {message.role === "assistant" ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <a href={href || "#"} target="_blank" rel="noreferrer">{children}<ExternalLink /></a>
                      ),
                    }}
                  >
                    {message.text}
                  </ReactMarkdown>
                ) : message.text}
                {message.references && message.references.length > 0 && (
                  <div className="product-chat-references">
                    {message.references.map((reference) => (
                      <a href={`/items/${reference.id}`} target="_blank" rel="noreferrer" key={reference.id}>
                        <div>{reference.image ? <img src={reference.image} alt="" /> : <Box />}</div>
                        <span><b>{reference.title}</b><small>{reference.serial} · {reference.category}</small></span>
                        <ExternalLink />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
          {sending && <article className="assistant loading"><span className="assistant-avatar"><Sparkles /></span><div className="product-chat-bubble"><LoaderCircle />Gathering data…</div></article>}
          {error && <div className="product-assistant-error">{error}</div>}
          <div ref={endRef} />
        </div>

        <form onSubmit={(event) => { event.preventDefault(); send(text); }}>
          <textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(text); } }} placeholder="Ask about this product or how it works with your inventory…" rows={2} />
          <button type="submit" disabled={!text.trim() || sending} aria-label="Send message"><Send /></button>
        </form>
      </section>
    </div>
  );
}

function ImageDeleteDialog({
  image,
  deleting,
  onClose,
  onConfirm,
}: {
  image: ProductImage;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, onClose]);

  return (
    <div
      className="image-delete-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !deleting && onClose()}
    >
      <section
        className="image-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-delete-title"
      >
        <div className="image-delete-icon"><AlertTriangle /></div>
        <div className="image-delete-copy">
          <h2 id="image-delete-title">Delete this image?</h2>
          <p>This removes the image permanently from this product.</p>
        </div>
        <div className="image-delete-preview">
          <img src={image.url} alt="Image selected for deletion" />
          <span>{image.filename}</span>
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={deleting}>Cancel</button>
          <button type="button" className="danger" onClick={onConfirm} disabled={deleting}>
            <Trash2 />{deleting ? "Deleting…" : "Delete image"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ProductEditDialog({
  item,
  categories,
  availableTags,
  onClose,
  onSave,
}: {
  item: Item;
  categories: string[];
  availableTags: string[];
  onClose: () => void;
  onSave: (details: {
    title: string;
    description: string;
    category: string;
    tags: string[];
    priceText: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description || "");
  const [priceText, setPriceText] = useState(item.price_text || "");
  const [category, setCategory] = useState(item.category);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryFiltering, setCategoryFiltering] = useState(false);
  const [tags, setTags] = useState(item.tags);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const suggestions = availableTags.filter(
    (tag) =>
      !tags.some((selected) => selected.toLowerCase() === tag.toLowerCase()) &&
      (!tagInput.trim() ||
        tag.toLowerCase().includes(tagInput.trim().toLowerCase())),
  );
  const categoryOptions = categoryFiltering
    ? categories.filter((option) =>
        option.toLowerCase().includes(category.trim().toLowerCase()),
      )
    : categories;
  function addTag(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const canonical =
      availableTags.find(
        (tag) => tag.toLowerCase() === trimmed.toLowerCase(),
      ) || trimmed;
    if (!tags.some((tag) => tag.toLowerCase() === canonical.toLowerCase()))
      setTags((current) => [...current, canonical]);
    setTagInput("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !category.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        category: category.trim(),
        tags,
        priceText: priceText.trim(),
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save product details",
      );
      setSaving(false);
    }
  }
  return (
    <div
      className="product-edit-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <form
        className="product-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-edit-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header>
          <div>
            <span>
              <Pencil />
            </span>
            <div>
              <h2 id="product-edit-title">Edit product details</h2>
              <p>Update how this item appears throughout your inventory.</p>
            </div>
          </div>
          <button type="button" aria-label="Close editor" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="product-edit-fields">
          <label>
            <span>Product name</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Product name"
            />
          </label>
          <label>
            <span>Price</span>
            <input value={priceText} onChange={(event)=>setPriceText(event.target.value)} placeholder="e.g. ₪29.90 or $8.50" />
            <small>Leave empty if the price is unknown.</small>
          </label>
          <label>
            <span>Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this item, and what is it useful for?"
              rows={7}
            />
          </label>
          <div className="product-category-editor">
            <div className="product-editor-label">
              <span>Category</span>
              <small>{categories.length} available</small>
            </div>
            <div
              className="product-category-combobox"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setCategoryOpen(false);
              }}
            >
              <input
                role="combobox"
                aria-expanded={categoryOpen}
                aria-controls="product-category-list"
                value={category}
                onFocus={() => {
                  setCategoryOpen(true);
                  setCategoryFiltering(false);
                }}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setCategoryOpen(true);
                  setCategoryFiltering(true);
                }}
                placeholder="Choose or type a category"
              />
              <button
                type="button"
                aria-label="Show existing categories"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setCategoryOpen((current) => !current);
                  setCategoryFiltering(false);
                }}
              >
                <ChevronDown />
              </button>
              {categoryOpen && (
                <div
                  className="product-category-dropdown"
                  id="product-category-list"
                  role="listbox"
                >
                  {categoryOptions.map((option) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={category === option}
                      className={category === option ? "selected" : ""}
                      key={option}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setCategory(option);
                        setCategoryOpen(false);
                        setCategoryFiltering(false);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                  {categoryOptions.length === 0 && (
                    <p>
                      No matching category. This name will be created when you
                      save.
                    </p>
                  )}
                </div>
              )}
            </div>
            <small>
              Choose an existing category or type a new name directly.
            </small>
          </div>
          <div className="product-tag-editor">
            <div className="product-editor-label">
              <span>Tags</span>
              <small>{availableTags.length} available</small>
            </div>
            {tags.length > 0 && (
              <div className="selected-product-tags">
                {tags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    onClick={() =>
                      setTags((current) =>
                        current.filter((value) => value !== tag),
                      )
                    }
                  >
                    {tag}
                    <X />
                  </button>
                ))}
              </div>
            )}
            <div className="tag-entry">
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="Search or type a new tag"
              />
              <button
                type="button"
                disabled={!tagInput.trim()}
                onClick={() => addTag(tagInput)}
              >
                <Plus />
                Add tag
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="tag-suggestions">
                {suggestions.map((tag) => (
                  <button type="button" key={tag} onClick={() => addTag(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            )}
            {suggestions.length === 0 && (
              <p className="no-tag-suggestions">
                {tagInput.trim()
                  ? "No matching unselected tags. You can add it as a new tag."
                  : "All available tags are selected."}
              </p>
            )}
            <small>
              Select existing tags or type a new tag and press Enter.
            </small>
          </div>
          {error && <p className="product-edit-error">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="save-product-details"
            disabled={saving || !title.trim() || !category.trim()}
            type="submit"
          >
            <Save />
            {saving ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ZoomableProductImage({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFitSize(null);
  }, [src]);

  function fitImage() {
    const container=frame.current;const element=image.current;
    if(!container||!element||!element.naturalWidth||!element.naturalHeight)return;
    const availableWidth=Math.max(1,container.clientWidth-28);const availableHeight=Math.max(1,container.clientHeight-28);
    const scale=Math.min(1,availableWidth/element.naturalWidth,availableHeight/element.naturalHeight);
    setFitSize({width:Math.max(1,Math.floor(element.naturalWidth*scale)),height:Math.max(1,Math.floor(element.naturalHeight*scale))});
  }

  useEffect(()=>{
    const container=frame.current;if(!container)return;
    const observer=new ResizeObserver(fitImage);observer.observe(container);fitImage();
    return()=>observer.disconnect();
  },[src]);

  function setZoomLevel(value: number) {
    const next = Math.min(5, Math.max(1, Math.round(value * 10) / 10));
    setZoom(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  }

  function reset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div
      ref={frame}
      className={`zoomable-product-image ${zoom > 1 ? "can-pan" : ""}`}
      onWheel={(event) => {
        event.preventDefault();
        setZoomLevel(zoom + (event.deltaY < 0 ? 0.2 : -0.2));
      }}
      onDoubleClick={reset}
      onPointerDown={(event) => {
        if (zoom === 1) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          panX: pan.x,
          panY: pan.y,
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        setPan({
          x: drag.current.panX + event.clientX - drag.current.startX,
          y: drag.current.panY + event.clientY - drag.current.startY,
        });
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <img
        ref={image}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={fitImage}
        style={{
          width:fitSize?`${fitSize.width}px`:undefined,
          height:fitSize?`${fitSize.height}px`:undefined,
          maxWidth:fitSize?"none":undefined,
          maxHeight:fitSize?"none":undefined,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
        }}
      />
      <div
        className="product-zoom-controls"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom === 1}
          onClick={() => setZoomLevel(zoom - 0.2)}
        >
          <Minus />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom === 5}
          onClick={() => setZoomLevel(zoom + 0.2)}
        >
          <Plus />
        </button>
        <button
          type="button"
          aria-label="Reset image view"
          title="Reset image view"
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          onClick={reset}
        >
          <RotateCcw />
        </button>
      </div>
      {zoom === 1 && <span className="product-zoom-hint">Scroll to zoom</span>}
    </div>
  );
}

function LocationDialog({
  locations,
  selectedId,
  recentIds,
  onClose,
  onSave,
  onCreate,
}: {
  locations: Location[];
  selectedId: number | null;
  recentIds: number[];
  onClose: () => void;
  onSave: (locationId: number | null) => Promise<void>;
  onCreate: (name: string, parentId: number | null) => Promise<number>;
}) {
  const [candidate, setCandidate] = useState<number | null>(selectedId);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(locations.map((location) => location.id)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const recent = recentIds
    .map((id) => locations.find((location) => location.id === id))
    .filter((location): location is Location => Boolean(location));
  const matches = locations.filter((location) =>
    locationPath(location.id, locations)
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  function toggle(id: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderBranch(parentId: number | null, depth = 0): ReactNode {
    return locations
      .filter((location) => location.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((location) => {
        const hasChildren = locations.some(
          (child) => child.parent_id === location.id,
        );
        const isExpanded = expanded.has(location.id);
        return (
          <div key={location.id}>
            <div
              className={`location-tree-row ${candidate === location.id ? "selected" : ""}`}
              style={{ paddingLeft: `${12 + depth * 24}px` }}
            >
              <button
                type="button"
                className="location-tree-toggle"
                aria-label={
                  isExpanded ? "Collapse location" : "Expand location"
                }
                onClick={() => hasChildren && toggle(location.id)}
                disabled={!hasChildren}
              >
                {hasChildren ? (
                  isExpanded ? (
                    <ChevronDown />
                  ) : (
                    <ChevronRight />
                  )
                ) : (
                  <span />
                )}
              </button>
              <button
                type="button"
                className="location-tree-select"
                onClick={() => setCandidate(location.id)}
              >
                <Folder />
                <span>{location.name}</span>
              </button>
            </div>
            {hasChildren && isExpanded && renderBranch(location.id, depth + 1)}
          </div>
        );
      });
  }

  async function create() {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError("");
    try {
      const id = await onCreate(name, candidate);
      if (candidate) setExpanded((current) => new Set([...current, candidate]));
      setCandidate(id);
      setNewName("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create location",
      );
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(candidate);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not move item",
      );
      setSaving(false);
    }
  }

  return (
    <div
      className="location-picker-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="location-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="location-picker-icon">
              <MapPin />
            </span>
            <span>
              <h2 id="location-picker-title">Choose item location</h2>
              <p>Select a folder or create a more specific place.</p>
            </span>
          </div>
          <button
            type="button"
            aria-label="Close location picker"
            onClick={onClose}
          >
            <X />
          </button>
        </header>

        <label className="location-search">
          <Search />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search locations…"
          />
        </label>

        {recent.length > 0 && !query && (
          <div className="location-recent">
            <b>Recent</b>
            <div>
              {recent.map((location) => (
                <button
                  type="button"
                  className={candidate === location.id ? "selected" : ""}
                  key={location.id}
                  onClick={() => setCandidate(location.id)}
                >
                  <MapPin />
                  {locationPath(location.id, locations)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="location-tree">
          <button
            type="button"
            className={`location-unassigned ${candidate === null ? "selected" : ""}`}
            onClick={() => setCandidate(null)}
          >
            <Box />
            <span>
              <b>Unassigned</b>
              <small>Item has not been stored yet</small>
            </span>
          </button>
          {query ? (
            <div className="location-search-results">
              {matches.map((location) => (
                <button
                  type="button"
                  className={candidate === location.id ? "selected" : ""}
                  key={location.id}
                  onClick={() => setCandidate(location.id)}
                >
                  <Folder />
                  <span>{locationPath(location.id, locations)}</span>
                </button>
              ))}
              {matches.length === 0 && <p>No matching locations found.</p>}
            </div>
          ) : (
            <div className="location-tree-list">{renderBranch(null)}</div>
          )}
        </div>

        <div className="location-create">
          <div>
            <FolderPlus />
            <span>
              <b>
                Create a location{" "}
                {candidate ? "inside selected folder" : "at the top level"}
              </b>
              <small>
                {candidate ? locationPath(candidate, locations) : "Top level"}
              </small>
            </span>
          </div>
          <div>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  create();
                }
              }}
              placeholder="New location name"
            />
            <button
              type="button"
              disabled={!newName.trim() || saving}
              onClick={create}
            >
              <Plus /> Create
            </button>
          </div>
        </div>

        <div className="location-current">
          <span>Move to</span>
          <b>{locationPath(candidate, locations)}</b>
        </div>
        {error && <p className="location-error">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="location-save"
            disabled={saving}
            onClick={save}
          >
            <MapPin /> {saving ? "Saving…" : "Move item here"}
          </button>
        </footer>
      </section>
    </div>
  );
}
