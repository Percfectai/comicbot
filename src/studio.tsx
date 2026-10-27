import { useEffect, useMemo, useState } from "react";
import { STYLES, styleById, type StyleId } from "@/lib/comics/catalog";
import { GENRES } from "@/lib/comics/catalog";
import { planBeats, rewriteCopy } from "@/lib/comics/ai.functions";
import { fallbackBeat } from "@/lib/comics/ink-prompt";
import {
  newIssue,
  SMALL_CHANGES,
  type CastMember,
  type ComicPage,
  type Issue,
  type Purchase,
  type Role,
} from "@/lib/comics/types";

const KEY = "perfect-comics-v1";
const SPRITE_CACHE_KEY = "perfect-comics-sprites-v1";
const COVER_PRICE = 2;
const ACT_PRICE = 6;
const ANGLE_LABELS = ["FRONT", "BACK", "LEFT SIDE", "RIGHT SIDE"] as const;

function money(n: number) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function blankPurchase(): Purchase {
  return { cover: false, beginning: false, middle: false, ending: false };
}

function owned(issue: Issue): Purchase {
  return { ...blankPurchase(), ...issue.purchase };
}

function due(p: Purchase) {
  return (
    (p.cover ? 0 : COVER_PRICE) +
    (p.beginning ? 0 : ACT_PRICE) +
    (p.middle ? 0 : ACT_PRICE) +
    (p.ending ? 0 : ACT_PRICE)
  );
}

function bookIsPaid(issue: Issue) {
  const p = owned(issue);
  return p.cover && p.beginning && p.middle && p.ending;
}

function comicNumber(issues: Issue[], currentId: string) {
  const prior = issues.filter((i) => i.id !== currentId && bookIsPaid(i)).length;
  return prior + 1;
}

function blockNums(part: keyof Purchase) {
  if (part === "cover") return [0];
  if (part === "beginning") return [1, 2, 3];
  if (part === "middle") return [4, 5, 6];
  return [7, 8, 9];
}

function viewUrl(issue: Issue, page: ComicPage) {
  if (owned(issue)[page.act] && page.cleanUrl) return page.cleanUrl;
  return page.imageUrl;
}

type Library = { currentId: string; issues: Issue[] };

function forSave(lib: Library): Library {
  return {
    ...lib,
    issues: lib.issues.map((issue) => {
      const own = owned(issue);
      return {
        ...issue,
        pages: issue.pages.map((page) => {
          if (own[page.act]) {
            return page.cleanUrl ? { ...page, imageUrl: page.cleanUrl, cleanUrl: undefined } : page;
          }
          if (!page.cleanUrl) return page;
          const { cleanUrl: _clean, ...rest } = page;
          return rest;
        }),
      };
    }),
  };
}

function shotsOf(member?: { refUrl?: string; angles?: string[] }): string[] {
  if (!member) return [];
  const angles = (member.angles ?? []).filter(Boolean).slice(0, 4);
  if (angles.length) return angles;
  return member.refUrl ? [member.refUrl, member.refUrl, member.refUrl, member.refUrl] : [];
}

async function pairSheet(top: string[], bottom: string[]): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/sheet`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ top: top.slice(0, 4), bottom: bottom.slice(0, 4) }),
  });
  const data = await res.json().catch(() => null);
  return data?.ok && typeof data.url === "string" ? data.url : "";
}

async function generateAiSpriteCard(
  styleId: StyleId,
  title: string,
  topChar?: CastMember,
  bottomChar?: CastMember
): Promise<string> {
  const topDesc = topChar
    ? `${topChar.name} (${topChar.role}): ${topChar.look || topChar.description || topChar.name}`
    : "Lead hero in signature comic costume";
  const bottomDesc = bottomChar
    ? `${bottomChar.name} (${bottomChar.role}): ${bottomChar.look || bottomChar.description || bottomChar.name}`
    : topDesc;
  const seedRefs = [
    ...(topChar?.refUrl ? [topChar.refUrl] : []),
    ...(bottomChar?.refUrl ? [bottomChar.refUrl] : []),
  ].slice(0, 2);
  const res = await fetch(`${import.meta.env.BASE_URL}api/ink`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "sprite",
      page: 0,
      styleId,
      title,
      cast: `${topDesc} | ${bottomDesc}`,
      spriteMeta: { top: topDesc, bottom: bottomDesc },
      refs: seedRefs,
    }),
  });
  const data = await res.json().catch(() => null);
  return data?.ok && typeof data.url === "string" ? data.url : "";
}

async function stamp(src: string): Promise<string> {
  try {
    const res = await fetch(src);
    if (!res.ok) return src;
    const blob = await res.blob();
    const local = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("stamp"));
      el.src = local;
    });
    URL.revokeObjectURL(local);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return src;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-0.5);
    ctx.font = `800 ${Math.max(28, Math.round(canvas.width / 8))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 180));
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const step = Math.round(canvas.height / 3);
    for (const y of [-step, 0, step]) {
      ctx.strokeText("PERFECT COMICS PREVIEW", 0, y);
      ctx.fillText("PERFECT COMICS PREVIEW", 0, y);
    }
    ctx.restore();
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return src;
  }
}

function normalize(issue: Issue): Issue {
  return { ...newIssue(), ...issue, purchase: owned(issue) };
}

function load(): Library {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Library;
      if (Array.isArray(parsed.issues) && parsed.issues.length) {
        const issues = parsed.issues.map(normalize);
        return {
          currentId: issues.some((i) => i.id === parsed.currentId) ? parsed.currentId : issues[0].id,
          issues,
        };
      }
    }
  } catch { /* ignore */ }
  const first = newIssue();
  return { currentId: first.id, issues: [first] };
}

function pageLabel(n: number) {
  return n === 0 ? "COVER" : `PAGE ${n}`;
}

function shrinkRef(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 768;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

type IssueSprites = Record<string, { sheetA?: string; sheetB?: string }>;

export default function Studio() {
  const [lib, setLib] = useState<Library>(load);
  const [spritesByIssue, setSpritesByIssue] = useState<IssueSprites>(() => {
    try { return JSON.parse(localStorage.getItem(SPRITE_CACHE_KEY) || "{}"); }
    catch { return {}; }
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePageN, setActivePageN] = useState<number>(0);
  const [readerOpen, setReaderOpen] = useState<boolean>(false);

  const issue = useMemo(
    () => lib.issues.find((i) => i.id === lib.currentId) || lib.issues[0],
    [lib]
  );
  const currentSprites = spritesByIssue[issue.id] || {};

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(forSave(lib))); } catch { /* quota */ }
  }, [lib]);
  useEffect(() => {
    try { localStorage.setItem(SPRITE_CACHE_KEY, JSON.stringify(spritesByIssue)); } catch { /* quota */ }
  }, [spritesByIssue]);

  const patch = (changes: Partial<Issue>) => {
    setLib((prev) => ({
      ...prev,
      issues: prev.issues.map((it) => (it.id === issue.id ? { ...it, ...changes } : it)),
    }));
  };
  const patchPage = (n: number, changes: Partial<ComicPage>) => {
    patch({ pages: issue.pages.map((p) => (p.n === n ? { ...p, ...changes } : p)) });
  };
  const setIssueSprite = (slot: "sheetA" | "sheetB", url: string) => {
    setSpritesByIssue((prev) => ({
      ...prev,
      [issue.id]: { ...(prev[issue.id] || {}), [slot]: url },
    }));
  };

  const buy = (part: keyof Purchase | "all") => {
    const p = owned(issue);
    const nextP: Purchase = part === "all"
      ? { cover: true, beginning: true, middle: true, ending: true }
      : { ...p, [part]: true };
    const updatedPages = issue.pages.map((pg) => {
      if (nextP[pg.act] && pg.cleanUrl) return { ...pg, imageUrl: pg.cleanUrl };
      return pg;
    });
    patch({ purchase: nextP, pages: updatedPages });
  };

  const buildOrGenerateSpriteSheet = async (slot: "sheetA" | "sheetB", forceAi = false): Promise<string> => {
    const topChar = slot === "sheetA" ? issue.cast[0] : issue.cast[2];
    const bottomChar = slot === "sheetA" ? issue.cast[1] : issue.cast[3];
    setBusy(`Building ${slot === "sheetA" ? "Sprite Card A" : "Sprite Card B"}...`);
    setError(null);
    try {
      const topShots = shotsOf(topChar);
      const botShots = shotsOf(bottomChar);
      let url = "";
      if (!forceAi && (topShots.length > 0 || botShots.length > 0)) {
        url = await pairSheet(topShots.length ? topShots : botShots, botShots.length ? botShots : topShots);
      }
      if (!url) url = await generateAiSpriteCard(issue.styleId, issue.title, topChar, bottomChar);
      if (!url) throw new Error("Could not build character sprite card.");
      setIssueSprite(slot, url);
      return url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sprite card failed.");
      return "";
    } finally {
      setBusy(null);
    }
  };

  const uploadCharAngle = async (charId: string, angleIdx: number, file?: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await shrinkRef(file);
      patch({
        cast: issue.cast.map((c) => {
          if (c.id !== charId) return c;
          const nextAngles = [...(c.angles || ["", "", "", ""])];
          while (nextAngles.length < 4) nextAngles.push("");
          nextAngles[angleIdx] = dataUrl;
          return { ...c, refUrl: c.refUrl || dataUrl, angles: nextAngles };
        }),
      });
    } catch {
      setError("Could not read character angle image.");
    }
  };

  const onRewrite = async (
    target: "summary" | "beginning" | "middle" | "ending" | "cover" | "page",
    _invent: boolean,
    pageN?: number
  ) => {
    setBusy(`Writing ${target}...`);
    setError(null);
    try {
      const current = target === "page" || target === "cover"
        ? issue.pages.find((p) => p.n === (pageN ?? 0))?.beat || ""
        : issue[target] || "";
      const text = await rewriteCopy({ target, current, title: issue.title });
      if (target === "page" || target === "cover") patchPage(pageN ?? 0, { beat: text });
      else patch({ [target]: text });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Writer failed.");
    } finally {
      setBusy(null);
    }
  };

  const onPlanAllBeats = async () => {
    setBusy("Planning 10-page issue beats...");
    setError(null);
    try {
      const beats = await planBeats({ title: issue.title });
      patch({
        pages: issue.pages.map((p, idx) => ({
          ...p,
          beat: beats[idx] || p.beat || fallbackBeat(issue, p.n),
        })),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not plan 10-page beats.");
    } finally {
      setBusy(null);
    }
  };

  const ink = async (n: number, note?: string) => {
    const targetPage = issue.pages.find((p) => p.n === n);
    if (!targetPage) return;
    setBusy(`Inking ${pageLabel(n)}...`);
    setError(null);
    try {
      let sheetA = currentSprites.sheetA;
      let sheetB = currentSprites.sheetB;
      if (!sheetA && issue.cast.length > 0) sheetA = await buildOrGenerateSpriteSheet("sheetA", false);
      if (!sheetB && issue.cast.length > 2) sheetB = await buildOrGenerateSpriteSheet("sheetB", false);
      const prevPage = n > 0 ? issue.pages.find((p) => p.n === n - 1) : undefined;
      const prevPageRef = prevPage ? prevPage.cleanUrl || prevPage.imageUrl || "" : "";
      const refs: string[] = [];
      if (n === 0) {
        if (sheetA) refs.push(sheetA);
        if (sheetB) refs.push(sheetB);
      } else {
        if (prevPageRef) refs.push(prevPageRef);
        if (sheetA) refs.push(sheetA);
        if (sheetB) refs.push(sheetB);
      }
      const res = await fetch(`${import.meta.env.BASE_URL}api/ink`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: note ? "small" : n === 0 ? "cover" : "interior",
          page: n,
          styleId: issue.styleId,
          title: issue.title,
          beat: targetPage.beat || fallbackBeat(issue, n),
          note: note || "",
          hasPrevPage: Boolean(prevPageRef),
          refs: refs.slice(0, 3),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok || !data.url) throw new Error(data?.error || "Ink failed.");
      const cleanUrl = data.url as string;
      const displayUrl = owned(issue)[targetPage.act] ? cleanUrl : await stamp(cleanUrl);
      patchPage(n, { cleanUrl, imageUrl: displayUrl || cleanUrl });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to ink page.");
    } finally {
      setBusy(null);
    }
  };

  const addCharacter = () => {
    const idx = issue.cast.length + 1;
    const role: Role = idx === 1 ? "lead" : idx === 2 ? "sidekick" : idx === 3 ? "villain" : "support";
    const nextChar: CastMember = {
      id: `char-${Date.now()}-${idx}`,
      name: `Character ${idx}`,
      role,
      look: "Distinctive comic costume, clear silhouette, memorable colors",
      angles: ["", "", "", ""],
    };
    patch({ cast: [...issue.cast, nextChar] });
  };

  const activePage = issue.pages.find((p) => p.n === activePageN) || issue.pages[0];
  const prevPageObj = activePageN > 0 ? issue.pages.find((p) => p.n === activePageN - 1) : undefined;
  const purchaseState = owned(issue);
  const totalDue = due(purchaseState);

  return (
    <div className="min-h-screen bg-[#070910] text-slate-100 font-sans pb-20">
      <header className="sticky top-0 z-30 border-b-2 border-cyan-400/40 bg-[#0b0f1c]/95 backdrop-blur-md px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="px-3 py-1 bg-gradient-to-r from-yellow-400 via-amber-300 to-cyan-400 text-black font-black tracking-tighter text-lg rounded -skew-x-6 shadow-[3px_3px_0px_#d946ef]">
              PERFECT COMICS STUDIO
            </div>
            <span className="text-xs font-mono text-cyan-300 hidden sm:inline">
              ISSUE #{comicNumber(lib.issues, issue.id)} • 10 PAGES ($20 FULL BOOK)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {busy && (
              <span className="px-3 py-1.5 rounded-lg bg-amber-400/20 border border-amber-400 text-amber-300 text-xs font-bold animate-pulse">
                {busy}
              </span>
            )}
            <button onClick={() => setReaderOpen(!readerOpen)} className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold uppercase tracking-wider">
              {readerOpen ? "Back to Studio" : "Read 10-Page Issue"}
            </button>
            {totalDue > 0 ? (
              <button onClick={() => buy("all")} className="px-4 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs uppercase tracking-wider shadow-[3px_3px_0px_#22d3ee]">
                Unlock Full 10-Page Book ({money(totalDue)})
              </button>
            ) : (
              <span className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-xs font-black">
                FULL ISSUE UNLOCKED
              </span>
            )}
          </div>
        </div>
      </header>
      {error && (
        <div className="max-w-7xl mx-auto mt-4 px-4">
          <div className="bg-rose-950/90 border-2 border-rose-500 text-rose-200 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-bold">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-xs underline">Dismiss</button>
          </div>
        </div>
      )}
      {readerOpen ? (
        <main className="max-w-5xl mx-auto p-6 space-y-8">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white">{issue.title}</h1>
              <p className="text-xs font-mono text-cyan-400 uppercase">
                Cover + 9 Interior Pages • Style: {styleById(issue.styleId)?.name || issue.styleId}
              </p>
            </div>
            <button onClick={() => setReaderOpen(false)} className="px-4 py-2 rounded-lg bg-cyan-400 text-black font-black text-xs uppercase">
              Return to Editor
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {issue.pages.map((pg) => {
              const url = viewUrl(issue, pg);
              return (
                <div key={pg.n} className="bg-black border-4 border-white rounded-xl overflow-hidden shadow-[8px_8px_0px_#22d3ee] flex flex-col">
                  <div className="bg-white text-black px-4 py-2 flex items-center justify-between text-xs font-black uppercase">
                    <span>{pageLabel(pg.n)} • {pg.act.toUpperCase()}</span>
                  </div>
                  <div className="aspect-[3/4] w-full bg-slate-950 flex items-center justify-center">
                    {url ? <img src={url} alt={pageLabel(pg.n)} className="w-full h-full object-cover" /> : (
                      <button onClick={() => { setReaderOpen(false); setActivePageN(pg.n); ink(pg.n); }} className="px-4 py-2 rounded-lg bg-yellow-400 text-black font-black text-xs uppercase">
                        Ink {pageLabel(pg.n)}
                      </button>
                    )}
                  </div>
                  <div className="p-3 bg-slate-950 border-t border-slate-800 text-xs text-slate-300">{pg.beat || fallbackBeat(issue, pg.n)}</div>
                </div>
              );
            })}
          </div>
        </main>
      ) : (
        <main className="max-w-7xl mx-auto p-4 lg:p-8 space-y-8">
          <section className="bg-[#0e1424] border-2 border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Step 1 • Comic Issue Setup</span>
                <h2 className="text-xl font-black text-white">Title, Genre, Art Style & Story Arcs</h2>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { const fresh = newIssue(); setLib((prev) => ({ currentId: fresh.id, issues: [fresh, ...prev.issues] })); }} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-cyan-300 border border-slate-700">
                  + New Issue
                </button>
                <button onClick={onPlanAllBeats} disabled={Boolean(busy)} className="px-4 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs uppercase tracking-wider">
                  AI Write All 10 Page Beats
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Comic Title</label>
                <input value={issue.title} onChange={(e) => patch({ title: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Genre</label>
                <select value={issue.genre} onChange={(e) => patch({ genre: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white">
                  {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Art Style</label>
                <select value={issue.styleId} onChange={(e) => patch({ styleId: e.target.value as StyleId })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-cyan-300">
                  {STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {(["summary", "beginning", "middle", "ending"] as const).map((field) => (
                <div key={field} className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-cyan-400">
                      {field === "summary" ? "Overall Issue Summary" : field === "beginning" ? "Act I: Pages 1–3 ($6)" : field === "middle" ? "Act II: Pages 4–6 ($6)" : "Act III: Pages 7–9 ($6)"}
                    </span>
                    <button onClick={() => onRewrite(field, true)} disabled={Boolean(busy)} className="text-[11px] font-bold text-yellow-400 hover:underline">AI Invent</button>
                  </div>
                  <textarea value={issue[field] || ""} onChange={(e) => patch({ [field]: e.target.value })} rows={3} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:border-cyan-400 focus:outline-none" />
                </div>
              ))}
            </div>
          </section>
          <section className="bg-[#0e1424] border-2 border-yellow-400/40 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono uppercase tracking-widest text-yellow-400">Step 2 • Sprite cards</span>
                <h2 className="text-xl font-black text-white">Two characters per card. Four shots on top, four on the bottom.</h2>
              </div>
              <button onClick={addCharacter} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-cyan-400/40 text-xs font-black text-cyan-300 uppercase">
                + Add Cast Character ({issue.cast.length}/4)
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {(["sheetA", "sheetB"] as const).map((slot, sheetIdx) => {
                const topIdx = sheetIdx === 0 ? 0 : 2;
                const botIdx = sheetIdx === 0 ? 1 : 3;
                const topChar = issue.cast[topIdx];
                const botChar = issue.cast[botIdx];
                const sheetUrl = currentSprites[slot];
                return (
                  <div key={slot} className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <h3 className="text-lg font-black text-white">{sheetIdx === 0 ? "SPRITE CARD A (Characters 1 & 2)" : "SPRITE CARD B (Characters 3 & 4)"}</h3>
                      <div className="flex items-center gap-2">
                        <button onClick={() => buildOrGenerateSpriteSheet(slot, false)} disabled={Boolean(busy)} className="px-3 py-1.5 rounded-lg bg-cyan-400 text-black font-black text-xs uppercase">Stitch 2×4 Sheet</button>
                        <button onClick={() => buildOrGenerateSpriteSheet(slot, true)} disabled={Boolean(busy)} className="px-3 py-1.5 rounded-lg bg-yellow-400 text-black font-black text-xs uppercase">AI Draw 2×4 Sprite</button>
                      </div>
                    </div>
                    {[
                      { label: "TOP ROW", char: topChar, idx: topIdx },
                      { label: "BOTTOM ROW", char: botChar, idx: botIdx },
                    ].map(({ label, char, idx }) => (
                      <div key={idx} className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-700 space-y-3">
                        <div className="text-[11px] font-black uppercase text-slate-300">{label} • Character #{idx + 1}</div>
                        {char ? (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input value={char.name} onChange={(e) => patch({ cast: issue.cast.map((c) => c.id === char.id ? { ...c, name: e.target.value } : c) })} className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white" />
                              <input value={char.look || ""} onChange={(e) => patch({ cast: issue.cast.map((c) => c.id === char.id ? { ...c, look: e.target.value } : c) })} placeholder="Costume, colors, hair" className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200" />
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              {ANGLE_LABELS.map((angleName, angleIdx) => {
                                const shotUrl = (char.angles && char.angles[angleIdx]) || "";
                                return (
                                  <label key={angleName} className="cursor-pointer aspect-[3/4] rounded-lg bg-slate-950 border border-slate-700 overflow-hidden flex items-center justify-center relative">
                                    <span className="absolute top-1 text-[9px] font-mono font-bold text-cyan-300 bg-black/80 px-1 rounded">{angleName}</span>
                                    {shotUrl ? <img src={shotUrl} alt={angleName} className="absolute inset-0 w-full h-full object-cover" /> : <span className="text-[10px] text-slate-500">Upload</span>}
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadCharAngle(char.id, angleIdx, e.target.files?.[0])} />
                                  </label>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <button onClick={addCharacter} className="w-full py-3 rounded-lg border border-dashed border-slate-700 text-xs font-bold text-slate-400">+ Add Character #{idx + 1}</button>
                        )}
                      </div>
                    ))}
                    <div className="bg-black/80 border border-slate-800 rounded-xl p-3 flex items-center gap-4">
                      <div className="w-24 h-32 rounded-lg bg-slate-900 border border-yellow-400/50 overflow-hidden flex items-center justify-center">
                        {sheetUrl ? <img src={sheetUrl} alt={slot} className="w-full h-full object-cover" /> : <span className="text-[10px] text-slate-500 text-center px-2">Not built</span>}
                      </div>
                      <p className="text-xs text-slate-400">Top: {topChar?.name || "Char 1"} • Bottom: {botChar?.name || "Char 2"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-[#0e1424] border-2 border-slate-800 rounded-2xl p-4 space-y-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-cyan-400">10-Page Comic Book</h3>
              <div className="grid grid-cols-2 gap-3 max-h-[720px] overflow-y-auto">
                {issue.pages.map((pg) => {
                  const url = viewUrl(issue, pg);
                  const isPaid = purchaseState[pg.act];
                  return (
                    <button key={pg.n} onClick={() => setActivePageN(pg.n)} className={`text-left rounded-xl p-2.5 border-2 ${pg.n === activePageN ? "border-cyan-400 bg-slate-800" : "border-slate-800 bg-slate-950"}`}>
                      <div className="flex justify-between text-[11px] font-black mb-1">
                        <span className="text-cyan-300">{pageLabel(pg.n)}</span>
                        <span className={isPaid ? "text-emerald-300" : "text-amber-300"}>{isPaid ? "OWNED" : pg.act === "cover" ? "$2" : "$6 ACT"}</span>
                      </div>
                      <div className="aspect-[3/4] bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center">
                        {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-slate-500">{pg.n === 0 ? "Refs: cards" : `Refs: page ${pg.n - 1} + cards`}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="lg:col-span-7 bg-[#0e1424] border-2 border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-900 border border-cyan-500/40 rounded-lg p-2 text-[11px]">
                  <div className="font-black text-cyan-400">Ref 1 • previous page</div>
                  <div>{activePage.n === 0 ? "Cover has no previous page" : `Page ${activePage.n - 1}`}</div>
                  {prevPageObj?.imageUrl && <img src={prevPageObj.imageUrl} alt="" className="mt-2 h-16 object-cover" />}
                </div>
                <div className="bg-slate-900 border border-yellow-400/40 rounded-lg p-2 text-[11px]">
                  <div className="font-black text-yellow-400">Ref 2 • card A</div>
                  <div>{issue.cast[0]?.name || "Char 1"} / {issue.cast[1]?.name || "Char 2"}</div>
                </div>
                <div className="bg-slate-900 border border-fuchsia-400/40 rounded-lg p-2 text-[11px]">
                  <div className="font-black text-fuchsia-400">Ref 3 • card B</div>
                  <div>{issue.cast[2]?.name || "Char 3"} / {issue.cast[3]?.name || "Char 4"}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-2xl font-black text-white">{pageLabel(activePage.n)}</h3>
                <div className="flex gap-2">
                  <button onClick={() => onRewrite(activePage.n === 0 ? "cover" : "page", true, activePage.n)} className="px-3 py-2 rounded-lg bg-slate-800 text-xs font-bold text-yellow-300">AI Write Beat</button>
                  <button onClick={() => ink(activePage.n)} disabled={Boolean(busy)} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-yellow-300 text-black font-black text-xs uppercase">Ink {pageLabel(activePage.n)}</button>
                </div>
              </div>
              <textarea value={activePage.beat} onChange={(e) => patchPage(activePage.n, { beat: e.target.value })} rows={3} placeholder={fallbackBeat(issue, activePage.n)} className="w-full bg-slate-950 border-2 border-slate-800 rounded-xl p-3.5 text-sm text-white" />
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                <div className="md:col-span-8 aspect-[3/4] bg-black border-4 border-white rounded-xl overflow-hidden flex items-center justify-center">
                  {viewUrl(issue, activePage) ? <img src={viewUrl(issue, activePage)} alt="" className="w-full h-full object-cover" /> : <div className="text-slate-400 font-black">{pageLabel(activePage.n)} canvas</div>}
                </div>
                <div className="md:col-span-4 space-y-3">
                  {SMALL_CHANGES.map((note) => (
                    <button key={note} onClick={() => ink(activePage.n, note)} disabled={Boolean(busy) || !viewUrl(issue, activePage)} className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-[11px] font-bold text-slate-200 disabled:opacity-40">{note}</button>
                  ))}
                  {!purchaseState[activePage.act] && (
                    <button onClick={() => buy(activePage.act)} className="w-full py-2 rounded-lg bg-yellow-400 text-black font-black text-xs uppercase">
                      Unlock {activePage.act} ({money(activePage.act === "cover" ? COVER_PRICE : ACT_PRICE)})
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
