"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  Bot,
  Box,
  Boxes,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCopy,
  ExternalLink,
  FolderTree,
  LayoutDashboard,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

type ItemReference = {
  id: number;
  serial: string;
  title: string;
  category: string;
  image: string;
};
type MissingItem = { name: string; reason: string; searchQuery: string };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  references?: ItemReference[];
  missingItems?: MissingItem[];
};

function marketplaceUrl(domain: string, query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${query}`)}`;
}

export default function LabAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "assistant", text: "Hey Roy, what would you like to build or find?" },
  ]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [inventoryCount, setInventoryCount] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/items?limit=1000")
      .then((response) => response.json())
      .then((result) => setInventoryCount(result.items?.length || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const question = text.trim();
    if (!question || sending) return;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: question,
    };
    const requestMessages = [...messages, userMessage];
    setMessages(requestMessages);
    setText("");
    setError("");
    setSending(true);
    try {
      const response = await fetch("/api/lab-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: requestMessages.map(({ role, text }) => ({ role, text })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The lab assistant could not answer");
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.answer,
          references: result.references || [],
          missingItems: result.missingItems || [],
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The lab assistant could not answer");
    } finally {
      setSending(false);
    }
  }

  async function copyChat() {
    const transcript = messages
      .map((message) => `${message.role === "user" ? "Roy" : "Assistant"}: ${message.text}`)
      .join("\n\n");
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="app-shell lab-assistant-app">
      <aside className="sidebar">
        <Link className="brand" href="/"><div className="brand-mark"><Boxes size={20} /></div><span>Parts<span>Atlas</span></span></Link>
        <nav>
          <p>Workspace</p>
          <Link className="sidebar-link" href="/?view=Overview"><LayoutDashboard />Overview</Link>
          <Link className="sidebar-link" href="/?view=Inventory"><Archive />Inventory{inventoryCount > 0 && <span>{inventoryCount}</span>}</Link>
          <Link className="sidebar-link" href="/?view=Locations"><FolderTree />Locations</Link>
          <Link className="sidebar-link" href="/identify"><Camera />Identify</Link>
          <p>Intelligence</p>
          <Link className="sidebar-link active" href="/assistant"><Sparkles />Lab assistant<span className="beta">AI</span></Link>
          <p>System</p>
          <Link className="sidebar-link" href="/?view=Settings"><Settings />Settings</Link>
          <Link className="sidebar-link" href="/?view=Help%20%26%20feedback"><CircleHelp />Help & feedback</Link>
        </nav>
        <div className="storage-card"><div><span>Inventory context</span><b>{inventoryCount.toLocaleString()} products</b></div><div className="meter"><i /></div><small>Available to the assistant</small></div>
        <div className="profile"><div>RL</div><span><b>Roy&apos;s Lab</b><small>Personal workspace</small></span><MoreHorizontal /></div>
      </aside>

      <section className="content lab-assistant-content">
        <header className="topbar">
          <div className="crumb"><span>Home lab</span><ChevronRight /><b>Lab assistant</b></div>
          <div className="top-actions"><Link className="identify-button top-link" href="/identify"><Camera />Identify an item</Link><Link className="add-button top-link" href="/items/new"><Plus />Add item</Link></div>
        </header>

        <div className="lab-assistant-page">
          <header className="lab-assistant-hero">
            <div className="lab-assistant-hero-icon"><Bot /></div>
            <div><p>INVENTORY INTELLIGENCE</p><h1>Lab assistant</h1><span>Plan projects, find the right parts, and discover what is missing.</span></div>
            <aside><i /><b>{inventoryCount.toLocaleString()}</b><span>products searchable</span></aside>
          </header>

          <section className="lab-chat">
            <div className="lab-chat-toolbar">
              <button type="button" onClick={copyChat}>{copied ? <Check /> : <ClipboardCopy />}<span>{copied ? "Copied" : "Copy chat"}</span></button>
            </div>
            <div className="lab-chat-messages product-assistant-messages">
              {messages.map((message) => (
                <article className={message.role} key={message.id}>
                  {message.role === "assistant" && <span className="assistant-avatar"><Sparkles /></span>}
                  <div className="product-chat-bubble">
                    {message.role === "assistant" ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => <a href={href || "#"} target="_blank" rel="noreferrer">{children}<ExternalLink /></a>,
                        }}
                      >{message.text}</ReactMarkdown>
                    ) : message.text}

                    {message.references && message.references.length > 0 && (
                      <div className="product-chat-references">
                        {message.references.map((item) => (
                          <a href={`/items/${item.id}`} target="_blank" rel="noreferrer" key={item.id}>
                            <div>{item.image ? <img src={item.image} alt="" /> : <Box />}</div>
                            <span><b>{item.title}</b><small>{item.serial} &middot; {item.category}</small></span>
                            <ExternalLink />
                          </a>
                        ))}
                      </div>
                    )}

                    {message.missingItems && message.missingItems.length > 0 && (
                      <section className="lab-missing-items">
                        <div className="lab-missing-title"><ShoppingBag /><span><b>Items you may need</b><small>These were not found in your inventory.</small></span></div>
                        {message.missingItems.map((missing, index) => (
                          <article key={`${missing.searchQuery}-${index}`}>
                            <div><b>{missing.name}</b><p>{missing.reason}</p></div>
                            <nav>
                              <a href={marketplaceUrl("aliexpress.com", missing.searchQuery)} target="_blank" rel="noreferrer"><Search />AliExpress<ExternalLink /></a>
                              <a href={marketplaceUrl("temu.com", missing.searchQuery)} target="_blank" rel="noreferrer"><Search />Temu<ExternalLink /></a>
                              <a href={marketplaceUrl("amazon.com", missing.searchQuery)} target="_blank" rel="noreferrer"><Search />Amazon<ExternalLink /></a>
                            </nav>
                          </article>
                        ))}
                      </section>
                    )}
                  </div>
                </article>
              ))}
              {sending && <article className="assistant loading"><span className="assistant-avatar"><Sparkles /></span><div className="product-chat-bubble"><LoaderCircle />Gathering data&hellip;</div></article>}
              {error && <div className="product-assistant-error">{error}</div>}
              <div ref={endRef} />
            </div>

            <form className="lab-chat-input" onSubmit={sendMessage}>
              <textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Ask what you can build, find a part, or describe a problem to solve..." rows={2} />
              <button type="submit" disabled={!text.trim() || sending}><span>Send</span><Send /></button>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
