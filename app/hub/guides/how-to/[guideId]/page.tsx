"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type KeyboardEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { loadSession } from "@/lib/session";

type GuideDetail = {
  id: string;
  title: string;
  content: string;
  restricted?: boolean;
  lastEdited: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^\)]+\))/g).filter(Boolean);
  return parts.map((part, idx) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={idx}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={idx}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={idx} className="rounded bg-[#f3f0e2] px-1">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
    if (link) {
      return (
        <a key={idx} href={link[2]} target="_blank" rel="noreferrer" className="text-[#2f5ba0] underline">
          {link[1]}
        </a>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function renderMarkdown(content: string) {
  const lines = content.split("\n");
  const output: ReactElement[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      output.push(<div key={`sp-${idx}`} className="h-2" />);
      return;
    }
    if (trimmed.startsWith("### ")) {
      output.push(<h3 key={idx} className="text-lg font-semibold">{renderInlineMarkdown(trimmed.slice(4))}</h3>);
      return;
    }
    if (trimmed.startsWith("## ")) {
      output.push(<h2 key={idx} className="text-xl font-semibold">{renderInlineMarkdown(trimmed.slice(3))}</h2>);
      return;
    }
    if (trimmed.startsWith("# ")) {
      output.push(<h1 key={idx} className="text-2xl font-semibold">{renderInlineMarkdown(trimmed.slice(2))}</h1>);
      return;
    }
    if (trimmed.startsWith("- ")) {
      output.push(
        <li key={idx} className="ml-5 list-disc text-sm leading-relaxed text-[#3e4c24]">
          {renderInlineMarkdown(trimmed.slice(2))}
        </li>
      );
      return;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      output.push(
        <li key={idx} className="ml-5 list-decimal text-sm leading-relaxed text-[#3e4c24]">
          {renderInlineMarkdown(trimmed.replace(/^\d+\.\s/, ""))}
        </li>
      );
      return;
    }
    if (trimmed.startsWith("> ")) {
      output.push(
        <blockquote key={idx} className="border-l-4 border-[#d0c9a4] bg-white/70 px-3 py-2 text-sm italic text-[#4b522d]">
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      );
      return;
    }
    output.push(
      <p key={idx} className="text-sm leading-relaxed text-[#3e4c24]">
        {renderInlineMarkdown(trimmed)}
      </p>
    );
  });

  return output;
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after = before,
  fallback = "text"
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || fallback;
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  const nextStart = start + before.length;
  const nextEnd = nextStart + selected.length;
  return { next, nextStart, nextEnd };
}

export default function GuideDetailPage() {
  const params = useParams();
  const guideId = useMemo(() => params?.guideId as string, [params]);

  const [guide, setGuide] = useState<GuideDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userType, setUserType] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const session = loadSession();
    const normalized = (session?.userType || "").toLowerCase();
    setIsAdmin(normalized === "admin");
    setUserType(normalized);
  }, []);

  useEffect(() => {
    if (!guideId) return;
    const loadGuide = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/guides?id=${encodeURIComponent(guideId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load guide");
        if (!isAdmin && data.guide?.restricted) {
          setError("This guide is restricted to admins.");
          setGuide(null);
          return;
        }
        setGuide(data.guide || null);
      } catch (err) {
        console.error(err);
        setError("Unable to load this guide right now. Please try again shortly.");
      } finally {
        setLoading(false);
      }
    };
    loadGuide();
  }, [guideId, isAdmin]);

  async function saveGuide(partial: Partial<GuideDetail>) {
    if (!guide || !isAdmin) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/guides", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userType,
          id: guide.id,
          title: partial.title ?? guide.title,
          content: partial.content ?? guide.content,
          restricted: partial.restricted ?? guide.restricted,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaveState("saved");
    } catch (err) {
      console.error(err);
      setSaveState("error");
    }
  }

  function scheduleSave(nextGuide: GuideDetail) {
    setGuide(nextGuide);
    setSaveState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveGuide(nextGuide);
    }, 700);
  }

  function applyFormat(before: string, after = before, fallback?: string) {
    const textarea = editorRef.current;
    if (!textarea || !guide) return;
    const { next, nextStart, nextEnd } = wrapSelection(textarea, before, after, fallback);
    const nextGuide = { ...guide, content: next };
    scheduleSave(nextGuide);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextStart, nextEnd);
    });
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!event.metaKey && !event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      applyFormat("**", "**", "bold text");
    }
    if (key === "i") {
      event.preventDefault();
      applyFormat("*", "*", "italic text");
    }
    if (key === "k") {
      event.preventDefault();
      applyFormat("[", "](https://)", "link text");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/hub/guides/how-to"
          className="inline-flex items-center gap-2 rounded-full border border-[#cdd7ab] bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#4b522d] shadow-sm hover:bg-[#f1edd8]"
        >
          All Guides
        </Link>
        {isAdmin && (
          <span className="text-xs font-semibold text-[#4b522d]">
            {saveState === "saving" ? "Auto-saving..." : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Ready"}
          </span>
        )}
      </div>

      <header className="rounded-xl bg-[#a0b764] text-white px-4 py-3 shadow">
        <h1 className="text-2xl font-semibold tracking-[0.14em] uppercase">
          {guide?.title || "Guide"}
        </h1>
        <p className="text-sm text-white/80">
          Updated {guide ? new Date(guide.lastEdited).toLocaleString() : "—"}
        </p>
      </header>

      {loading && <div className="rounded-lg border border-dashed border-[#d5d7bc] bg-white/70 p-6 text-center text-sm text-[#737b54]">Loading guide...</div>}
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

      {!loading && !error && guide && (
        <>
          {isAdmin && (
            <section className="rounded-xl border border-[#d0c9a4] bg-white/90 p-4 shadow-sm space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  value={guide.title}
                  onChange={(event) => scheduleSave({ ...guide, title: event.target.value })}
                  className="rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm"
                  placeholder="Guide title"
                />
                <label className="flex items-center gap-2 text-sm text-[#4b522d]">
                  <input
                    type="checkbox"
                    checked={Boolean(guide.restricted)}
                    onChange={(event) => scheduleSave({ ...guide, restricted: event.target.checked })}
                  />
                  Admin-only page
                </label>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button type="button" onClick={() => applyFormat("**", "**", "bold")} className="rounded border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1">Bold</button>
                <button type="button" onClick={() => applyFormat("*", "*", "italic")} className="rounded border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1">Italic</button>
                <button type="button" onClick={() => applyFormat("# ", "", "Heading")} className="rounded border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1">H1</button>
                <button type="button" onClick={() => applyFormat("- ", "", "List item")} className="rounded border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1">Bullet</button>
                <button type="button" onClick={() => applyFormat("1. ", "", "List item")} className="rounded border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1">Numbered</button>
                <button type="button" onClick={() => applyFormat("> ", "", "Quote")} className="rounded border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1">Quote</button>
                <button type="button" onClick={() => applyFormat("`", "`", "code")} className="rounded border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1">Code</button>
                <button type="button" onClick={() => applyFormat("[", "](https://)", "link text")} className="rounded border border-[#d0c9a4] bg-[#f7f4e5] px-2 py-1">Link</button>
              </div>
              <textarea
                ref={editorRef}
                value={guide.content}
                onChange={(event) => scheduleSave({ ...guide, content: event.target.value })}
                onKeyDown={onEditorKeyDown}
                className="min-h-[340px] w-full rounded-md border border-[#d0c9a4] bg-white px-3 py-2 text-sm font-mono"
                placeholder="Write markdown here..."
              />
              <p className="text-xs text-[#6b7348]">Keyboard shortcuts: Ctrl/Cmd+B bold, Ctrl/Cmd+I italic, Ctrl/Cmd+K link.</p>
            </section>
          )}

          <article className="rounded-xl border border-[#d0c9a4] bg-[#f8f4e3] p-5 shadow-sm space-y-3">
            {guide.content.trim() ? renderMarkdown(guide.content) : <p className="text-sm text-[#7a7f54]">No content available for this guide yet.</p>}
          </article>
        </>
      )}
    </div>
  );
}
