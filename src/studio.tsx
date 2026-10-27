import { useEffect, useMemo, useState } from "react";
import { STYLES, styleById, type StyleId } from "@/lib/comics/catalog";
import { GENRES } from "@/lib/comics/catalog";
import { planBeats, rewriteCopy } from "@/lib/comics/ai.functions";
import { fallbackBeat } from "@/lib/comics/ink-prompt";
import {
  newIssue,
  SMALL_CHANGES,
  type Act,
  type CastMember,
  type ComicPage,
  type Issue,
  type Purchase,
  type Role,
} from "@/lib/comics/types";

const KEY = "perfect-comics-v1";
const SPRITE_CACHE_KEY = "comic-bot-sprites-v1";
const COVER_PRICE = 2;
const ACT_PRICE = 6;
const ISSUE_PRICE = 20;
const ANGLE_LABELS = ["FRONT", "BACK", "LEFT SIDE", "RIGHT SIDE"] as const;

// Works on Web (percfectai.com & comicbot) AND inside iOS/Android Capacitor App
const API_BASE =
  typeof window !== "undefined" &&
  (window.location.protocol === "capacitor:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname.endsWith("comicbot.si"))
    ? "https://percfectai.com/comics/"
    : import.meta.env.BASE_URL;

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

/** Stitches Top Character (4 angles: Front, Back, Side, Side) + Bottom Character (4 angles: Front, Back, Side, Side) */
async function pairSheet(top: string[], bottom: string[]): Promise<string> {
  const res = await fetch(`${API_BASE}api/sheet`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ top: top.slice(0, 4), bottom: bottom.slice(0, 4) }),
  });
  const data = await res.json().catch(() => null);
  return data?.ok && typeof data.url === "string" ? data.url : "";
}

/** AI-generates a 2x4 Dual-Character Turnaround Sprite Card directly via /api/ink (kind: "sprite") */
async function generateAiSpriteCard(
  styleId: StyleId,
  title: string,
  topChar?: CastMember,
  bottomChar?: CastMember
): Promise<string> {
  const topDesc = topChar
    ? `${topChar.name} (${topChar.role}): ${(topChar as any).look || (topChar as any).description || topChar.name}`
    : "Lead hero in signature comic costume";
  const bottomDesc = bottomChar
    ? `${bottomChar.name} (${bottomChar.role}): ${(bottomChar as any).look || (bottomChar as any).description || bottomChar.name}`
    : topDesc;

  const seedRefs = [
    ...(topChar?.refUrl ? [topChar.refUrl] : []),
    ...(bottomChar?.refUrl ? [bottomChar.refUrl] : []),
  ].slice(0, 2);

  const res = await fetch(`${API_BASE}api/ink`, {
    method: "POST",
    credentials: "include",
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
      ctx.strokeText("COMIC BOT PREVIEW", 0, y);
      ctx.fillText("COMIC BOT PREVIEW", 0, y);
    }
    ctx.restore();
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return src;
  }
}

function normalize(issue: Issue): Issue {
  return {
    ...newIssue(),
    ...issue,
    purchase: owned(issue),
  };
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
  } catch {
    /* ignore */
  }
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

type IssueSprites = Record<
  string,
  {
    sheetA?: string; // Cast[0] (Top 4: F/B/L/R) + Cast[1] (Bottom 4: F/B/L/R)
    sheetB?: string; // Cast[2] (Top 4: F/B/L/R) + Cast[3] (Bottom 4: F/B/L/R)
  }
>;

export default function Studio() {
  const [lib, setLib] = useState<Library>(load);
  const [spritesByIssue, setSpritesByIssue] = useState<IssueSprites>(() => {
    try {
      return JSON.parse(localStorage.getItem(SPRITE_CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activePageN, setActivePageN] = useState<number>(0);
  const [readerOpen, setReaderOpen] = useState<boolean>(false);

  const issue = useMemo(
    () => lib.issues.find((i) => i.id === lib.currentId) || lib.issues[0],
    [lib]
  );

  const currentSprites = spritesByIssue[issue.id] || {};

  useEffect(() => {
    document.title = "Comic Bot — AI Comic Book Maker";
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(forSave(lib)));
    } catch {
      /* quota */
    }
  }, [lib]);

  useEffect(() => {
    try {
      localStorage.setItem(SPRITE_CACHE_KEY, JSON.stringify(spritesByIssue));
    } catch {
      /* quota */
    }
  }, [spritesByIssue]);

  const patch = (changes: Partial<Issue>) => {
    setLib((prev) => ({
      ...prev,
      issues: prev.issues.map((it) => (it.id === issue.id ? { ...it, ...changes } : it)),
    }));
  };

  const patchPage = (n: number, changes: Partial<ComicPage>) => {
    patch({
      pages: issue.pages.map((p) => (p.n === n ? { ...p, ...changes } : p)),
    });
  };

  const setIssueSprite = (slot: "sheetA" | "sheetB", url: string) => {
    setSpritesByIssue((prev) => ({
      ...prev,
      [issue.id]: {
        ...(prev[issue.id] || {}),
        [slot]: url,
      },
    }));
  };

  const buy = (part: keyof Purchase | "all") => {
    const p = owned(issue);
    const nextP: Purchase =
      part === "all"
        ? { cover: true, beginning: true, middle: true, ending: true }
        : { ...p, [part]: true };

    const updatedPages = issue.pages.map((pg) => {
      if (nextP[pg.act] && pg.cleanUrl) {
        return { ...pg, imageUrl: pg.cleanUrl };
      }
      return pg;
    });
    patch({ purchase: nextP, pages: updatedPages });
  };

  const buildOrGenerateSpriteSheet = async (slot: "sheetA" | "sheetB", forceAi = false): Promise<string> => {
    const topChar = slot === "sheetA" ? issue.cast[0] : issue.cast[2];
    const bottomChar = slot === "sheetA" ? issue.cast[1] : issue.cast[3];

    setBusy(`Comic Bot: Building ${slot === "sheetA" ? "Sprite Card A (Chars 1 & 2)" : "Sprite Card B (Chars 3 & 4)"}...`);
    setError(null);
    try {
      const topShots = shotsOf(topChar);
      const botShots = shotsOf(bottomChar);

      let url = "";
      if (!forceAi && (topShots.length > 0 || botShots.length > 0)) {
        url = await pairSheet(
          topShots.length ? topShots : botShots,
          botShots.length ? botShots : topShots
        );
      }
      if (!url) {
        url = await generateAiSpriteCard(issue.styleId, issue.title, topChar, bottomChar);
      }
      if (!url) {
        throw new Error("Could not build character sprite card.");
      }
      setIssueSprite(slot, url);
      return url;
    } catch (e: any) {
      setError(e?.message || "Sprite card failed.");
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
    invent: boolean,
    pageN?: number
  ) => {
    setBusy(`Comic Bot Writer: ${target}...`);
    setError(null);
    try {
      const castText = issue.cast
        .map((c) => `${c.name} (${c.role}): ${(c as any).look || (c as any).description || ""}`)
        .join("; ");
      const current =
        target === "page" || target === "cover"
          ? issue.pages.find((p) => p.n === (pageN ?? 0))?.beat || ""
          : (issue as any)[target] || "";

      const text = await rewriteCopy({
        target,
        styleId: issue.styleId,
        invent,
        title: issue.title,
        genre: issue.genre,
        cast: castText,
        context: issue.summary || "",
        current,
      });

      if (target === "page" || target === "cover") {
        patchPage(pageN ?? 0, { beat: text });
      } else {
        patch({ [target]: text } as Partial<Issue>);
      }
    } catch (e: any) {
      setError(e?.message || "Writer failed.");
    } finally {
      setBusy(null);
    }
  };

  const onPlanAllBeats = async () => {
    setBusy("Comic Bot: Planning 10-page issue beats...");
    setError(null);
    try {
      const castText = issue.cast
        .map((c) => `${c.name} (${c.role}): ${(c as any).look || (c as any).description || ""}`)
        .join("; ");
      const beats = await planBeats({
        title: issue.title,
        genre: issue.genre,
        cast: castText,
        summary: issue.summary || "",
        beginning: (issue as any).beginning || "",
        middle: (issue as any).middle || "",
        ending: (issue as any).ending || "",
      });
      patch({
        pages: issue.pages.map((p, idx) => ({
          ...p,
          beat: beats[idx] || p.beat || fallbackBeat(issue, p.n),
        })),
      });
    } catch (e: any) {
      setError(e?.message || "Could not plan 10-page beats.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * CORE 3-REFERENCE INKER:
   *   Ref 1 = Previous Page (Page N-1 clean image, or Cover for Page 1)
   *   Ref 2 = Dual Character Sprite Card A (Top 4: Char 1 F/B/L/R, Bottom 4: Char 2 F/B/L/R)
   *   Ref 3 = Dual Character Sprite Card B (Top 4: Char 3 F/B/L/R, Bottom 4: Char 4 F/B/L/R)
   */
  const ink = async (n: number, note?: string) => {
    const targetPage = issue.pages.find((p) => p.n === n);
    if (!targetPage) return;

    setBusy(`Comic Bot Inking ${pageLabel(n)} (3-Ref Continuity)...`);
    setError(null);
    try {
      let sheetA = currentSprites.sheetA;
      let sheetB = currentSprites.sheetB;

      if (!sheetA && issue.cast.length > 0) {
        sheetA = await buildOrGenerateSpriteSheet("sheetA", false);
      }
      if (!sheetB && issue.cast.length > 2) {
        sheetB = await buildOrGenerateSpriteSheet("sheetB", false);
      }

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

      const castSummary = issue.cast
        .map((c) => `${c.name} (${c.role}): ${(c as any).look || (c as any).description || ""}`)
        .join("; ");

      const actSummary =
        targetPage.act === "beginning"
          ? (issue as any).beginning
          : targetPage.act === "middle"
          ? (issue as any).middle
          : targetPage.act === "ending"
          ? (issue as any).ending
          : issue.summary;

      const res = await fetch(`${API_BASE}api/ink`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: note ? "small" : n === 0 ? "cover" : "interior",
          page: n,
          styleId: issue.styleId,
          title: issue.title,
          cast: castSummary,
          beat: targetPage.beat || fallbackBeat(issue, n),
          note: note || "",
          actSummary: actSummary || "",
          hasPrevPage: Boolean(prevPageRef),
          refs: refs.slice(0, 3),
          spriteMeta: {
            sheet1Top: issue.cast[0]
              ? `${issue.cast[0].name} (${(issue.cast[0] as any).look || ""})`
              : "",
            sheet1Bottom: issue.cast[1]
              ? `${issue.cast[1].name} (${(issue.cast[1] as any).look || ""})`
              : "",
            sheet2Top: issue.cast[2]
              ? `${issue.cast[2].name} (${(issue.cast[2] as any).look || ""})`
              : "",
            sheet2Bottom: issue.cast[3]
              ? `${issue.cast[3].name} (${(issue.cast[3] as any).look || ""})`
              : "",
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!data?.ok || !data.url) {
        throw new Error(data?.error || "Ink failed.");
      }

      const cleanUrl = data.url as string;
      const isActPaid = owned(issue)[targetPage.act];
      const displayUrl = isActPaid ? cleanUrl : await stamp(cleanUrl);

      patchPage(n, {
        cleanUrl,
        imageUrl: displayUrl || cleanUrl,
      });
    } catch (e: any) {
      setError(e?.message || "Failed to ink page.");
    } finally {
      setBusy(null);
    }
  };

  const generateFull10PageIssue = async () => {
    setError(null);
    let sheetA = currentSprites.sheetA;
    let sheetB = currentSprites.sheetB;

    if (!sheetA) sheetA = await buildOrGenerateSpriteSheet("sheetA", false);
    if (!sheetB && issue.cast.length > 2) sheetB = await buildOrGenerateSpriteSheet("sheetB", false);

    let runningPrevUrl = "";
    for (let n = 0; n <= 9; n++) {
      setActivePageN(n);
      setBusy(`Comic Bot Inking: ${pageLabel(n)} of 9...`);
      const pg = issue.pages.find((p) => p.n === n);
      if (!pg) continue;

      const refs =
        n === 0
          ? [sheetA, sheetB].filter(Boolean)
          : [runningPrevUrl, sheetA, sheetB].filter(Boolean).slice(0, 3);

      const castSummary = issue.cast
        .map((c) => `${c.name} (${c.role}): ${(c as any).look || (c as any).description || ""}`)
        .join("; ");

      const res = await fetch(`${API_BASE}api/ink`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: n === 0 ? "cover" : "interior",
          page: n,
          styleId: issue.styleId,
          title: issue.title,
          cast: castSummary,
          beat: pg.beat || fallbackBeat(issue, n),
          hasPrevPage: n > 0 && Boolean(runningPrevUrl),
          refs,
          spriteMeta: {
            sheet1Top: issue.cast[0]?.name || "",
            sheet1Bottom: issue.cast[1]?.name || "",
            sheet2Top: issue.cast[2]?.name || "",
            sheet2Bottom: issue.cast[3]?.name || "",
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok || !data.url) {
        setError(data?.error || `Stopped at ${pageLabel(n)}`);
        break;
      }
      const cleanUrl = data.url as string;
      runningPrevUrl = cleanUrl;
      const isActPaid = owned(issue)[pg.act];
      const displayUrl = isActPaid ? cleanUrl : await stamp(cleanUrl);
      patchPage(n, { cleanUrl, imageUrl: displayUrl || cleanUrl });
    }
    setBusy(null);
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
    } as CastMember;
    patch({ cast: [...issue.cast, nextChar] });
  };

  const activePage = issue.pages.find((p) => p.n === activePageN) || issue.pages[0];
  const prevPageObj = activePageN > 0 ? issue.pages.find((p) => p.n === activePageN - 1) : undefined;
  const purchaseState = owned(issue);
  const totalDue = due(purchaseState);

  return (
    <div className="min-h-screen bg-[#070910] text-slate-100 font-sans pb-20">
      {/* ===================================================================
          TOP COMIC BOT COMMAND BAR
         =================================================================== */}
      <header className="sticky top-0 z-30 border-b-2 border-cyan-400/40 bg-[#0b0f1c]/95 backdrop-blur-md px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="px-3.5 py-1 bg-gradient-to-r from-yellow-400 via-amber-300 to-cyan-400 text-black font-black tracking-tighter text-xl rounded -skew-x-6 shadow-[3px_3px_0px_#d946ef]">
              COMIC BOT
            </div>
            <span className="text-xs font-mono text-cyan-300 hidden sm:inline">
              ISSUE #{comicNumber(lib.issues, issue.id)} • 10 PAGES ($20 FULL BOOK)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {busy && (
              <span className="px-3 py-1.5 rounded-lg bg-amber-400/20 border border-amber-400 text-amber-300 text-xs font-bold animate-pulse">
                ⚡ {busy}
              </span>
            )}
            <button
              onClick={() => setReaderOpen(!readerOpen)}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold uppercase tracking-wider"
            >
              {readerOpen ? "← Back to Comic Bot" : "📖 Read 10-Page Issue"}
            </button>
            <button
              onClick={generateFull10PageIssue}
              disabled={Boolean(busy)}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-black font-black text-xs uppercase tracking-wider shadow-[3px_3px_0px_#facc15] hover:brightness-110 disabled:opacity-50"
            >
              ⚡ Auto-Ink Sprites + All 10 Pages
            </button>
            {totalDue > 0 ? (
              <button
                onClick={() => buy("all")}
                className="px-4 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs uppercase tracking-wider shadow-[3px_3px_0px_#22d3ee]"
              >
                Unlock Full 10-Page Book ({money(totalDue)})
              </button>
            ) : (
              <span className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-xs font-black">
                ✓ FULL ISSUE UNLOCKED
              </span>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto mt-4 px-4">
          <div className="bg-rose-950/90 border-2 border-rose-500 text-rose-200 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-bold">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="text-xs underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="max-w-7xl mx-auto mt-4 px-4">
          <div className="bg-cyan-950/90 border-2 border-cyan-400 text-cyan-200 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-bold">
            <span>✓ {notice}</span>
            <button onClick={() => setNotice(null)} className="text-xs underline">
              Close
            </button>
          </div>
        </div>
      )}

      {readerOpen ? (
        <main className="max-w-5xl mx-auto p-6 space-y-8">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white">{issue.title}</h1>
              <p className="text-xs font-mono text-cyan-400 uppercase">
                Comic Bot Reader • Cover + 9 Interior Pages • Style: {styleById(issue.styleId)?.name || issue.styleId}
              </p>
            </div>
            <button
              onClick={() => setReaderOpen(false)}
              className="px-4 py-2 rounded-lg bg-cyan-400 text-black font-black text-xs uppercase"
            >
              Return to Editor
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {issue.pages.map((pg) => {
              const url = viewUrl(issue, pg);
              return (
                <div
                  key={pg.n}
                  className="bg-black border-4 border-white rounded-xl overflow-hidden shadow-[8px_8px_0px_#22d3ee] flex flex-col"
                >
                  <div className="bg-white text-black px-4 py-2 flex items-center justify-between text-xs font-black uppercase">
                    <span>
                      {pageLabel(pg.n)} • {pg.act.toUpperCase()}
                    </span>
                    <span className="font-mono text-[11px]">
                      {pg.n === 0 ? "SPLASH COVER" : `REFS: P${pg.n - 1} + SPRITE A + SPRITE B`}
                    </span>
                  </div>
                  <div className="aspect-[3/4] w-full bg-slate-950 flex items-center justify-center">
                    {url ? (
                      <img src={url} alt={pageLabel(pg.n)} className="w-full h-full object-cover" />
                    ) : (
                      <div className="p-6 text-center space-y-3">
                        <p className="text-slate-500 font-bold text-sm">{pageLabel(pg.n)} not inked yet</p>
                        <button
                          onClick={() => {
                            setReaderOpen(false);
                            setActivePageN(pg.n);
                            ink(pg.n);
                          }}
                          className="px-4 py-2 rounded-lg bg-yellow-400 text-black font-black text-xs uppercase"
                        >
                          ⚡ Ink {pageLabel(pg.n)}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="p-3 bg-slate-950 border-t border-slate-800 text-xs text-slate-300">
                    {pg.beat || fallbackBeat(issue, pg.n)}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      ) : (
        <main className="max-w-7xl mx-auto p-4 lg:p-8 space-y-8">
          {/* =================================================================
              STEP 1: ISSUE SETUP & ART STYLE
             ================================================================= */}
          <section className="bg-[#0e1424] border-2 border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">
                  Step 1 • Comic Bot Issue Setup
                </span>
                <h2 className="text-xl font-black text-white">Title, Genre, Art Style & Story Arcs</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const fresh = newIssue();
                    setLib((prev) => ({ currentId: fresh.id, issues: [fresh, ...prev.issues] }));
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-cyan-300 border border-slate-700"
                >
                  + New Issue
                </button>
                <button
                  onClick={onPlanAllBeats}
                  disabled={Boolean(busy)}
                  className="px-4 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs uppercase tracking-wider shadow-[3px_3px_0px_#22d3ee]"
                >
                  ✨ AI Write All 10 Page Beats
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Comic Title</label>
                <input
                  value={issue.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none"
                  placeholder="My Comic Bot Hero"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Genre</label>
                <select
                  value={issue.genre}
                  onChange={(e) => patch({ genre: e.target.value })}
                  className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white"
                >
                  {GENRES.map((g: any) => {
                    const val = typeof g === "string" ? g : g.id || g.name;
                    const label = typeof g === "string" ? g : g.name || g.id;
                    return (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Art Style</label>
                <select
                  value={issue.styleId}
                  onChange={(e) => patch({ styleId: e.target.value as StyleId })}
                  className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-bold text-cyan-300"
                >
                  {STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {(["summary", "beginning", "middle", "ending"] as const).map((field) => (
                <div key={field} className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-cyan-400">
                      {field === "summary"
                        ? "Overall Issue Summary"
                        : field === "beginning"
                        ? "Act I: Pages 1–3 ($6)"
                        : field === "middle"
                        ? "Act II: Pages 4–6 ($6)"
                        : "Act III: Pages 7–9 ($6)"}
                    </span>
                    <button
                      onClick={() => onRewrite(field, true)}
                      disabled={Boolean(busy)}
                      className="text-[11px] font-bold text-yellow-400 hover:underline"
                    >
                      ✨ AI Invent
                    </button>
                  </div>
                  <textarea
                    value={(issue as any)[field] || ""}
                    onChange={(e) => patch({ [field]: e.target.value } as Partial<Issue>)}
                    rows={3}
                    placeholder={`Describe the ${field}...`}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* =================================================================
              STEP 2: DUAL-CHARACTER 2x4 SPRITE CARD FORGE
             ================================================================= */}
          <section className="bg-[#0e1424] border-2 border-yellow-400/40 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono uppercase tracking-widest text-yellow-400">
                  Step 2 • Character Consistency Engine (2×4 Turnaround Sprite Cards)
                </span>
                <h2 className="text-xl font-black text-white">
                  Dual Character Sprite Cards (4 Views Top: Front/Back/Side/Side • 4 Views Bottom: Front/Back/Side/Side)
                </h2>
              </div>
              <button
                onClick={addCharacter}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-cyan-400/40 text-xs font-black text-cyan-300 uppercase"
              >
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
                  <div
                    key={slot}
                    className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div>
                        <span className="text-[11px] font-mono uppercase text-cyan-400">
                          Reference Slot #{sheetIdx + 2} • 8-Panel Turnaround
                        </span>
                        <h3 className="text-lg font-black text-white">
                          {sheetIdx === 0
                            ? "SPRITE CARD A (Characters 1 & 2)"
                            : "SPRITE CARD B (Characters 3 & 4)"}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => buildOrGenerateSpriteSheet(slot, false)}
                          disabled={Boolean(busy)}
                          className="px-3 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-black font-black text-xs uppercase"
                        >
                          Stitch 2×4 Sheet
                        </button>
                        <button
                          onClick={() => buildOrGenerateSpriteSheet(slot, true)}
                          disabled={Boolean(busy)}
                          className="px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs uppercase shadow-[2px_2px_0px_#d946ef]"
                        >
                          ⚡ AI Draw 2×4 Sprite
                        </button>
                      </div>
                    </div>

                    {[
                      { label: "TOP ROW (4 Views: Front • Back • Left • Right)", char: topChar, idx: topIdx, accent: "border-cyan-500/40" },
                      { label: "BOTTOM ROW (4 Views: Front • Back • Left • Right)", char: botChar, idx: botIdx, accent: "border-fuchsia-500/40" },
                    ].map(({ label, char, idx, accent }) => (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-xl bg-slate-900/90 border ${accent} space-y-3`}
                      >
                        <div className="text-[11px] font-black uppercase text-slate-300 flex items-center justify-between">
                          <span>{label}</span>
                          <span className="font-mono text-xs text-cyan-300">Character #{idx + 1}</span>
                        </div>

                        {char ? (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input
                                value={char.name}
                                onChange={(e) =>
                                  patch({
                                    cast: issue.cast.map((c) =>
                                      c.id === char.id ? { ...c, name: e.target.value } : c
                                    ),
                                  })
                                }
                                placeholder="Character Name"
                                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white"
                              />
                              <input
                                value={(char as any).look || (char as any).description || ""}
                                onChange={(e) =>
                                  patch({
                                    cast: issue.cast.map((c) =>
                                      c.id === char.id
                                        ? ({ ...c, look: e.target.value, description: e.target.value } as CastMember)
                                        : c
                                    ),
                                  })
                                }
                                placeholder="Costume, colors, hair, face details..."
                                className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                              />
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                              {ANGLE_LABELS.map((angleName, angleIdx) => {
                                const shotUrl = (char.angles && char.angles[angleIdx]) || (angleIdx === 0 ? char.refUrl : "");
                                return (
                                  <label
                                    key={angleName}
                                    className="cursor-pointer group aspect-[3/4] rounded-lg bg-slate-950 border border-slate-700 hover:border-cyan-400 overflow-hidden flex flex-col items-center justify-between p-1.5 text-center relative"
                                  >
                                    <span className="text-[9px] font-mono font-bold text-cyan-300 bg-black/80 px-1.5 py-0.5 rounded z-10">
                                      {angleName}
                                    </span>
                                    {shotUrl ? (
                                      <img
                                        src={shotUrl}
                                        alt={angleName}
                                        className="absolute inset-0 w-full h-full object-cover"
                                      />
                                    ) : (
                                      <span className="text-[10px] text-slate-500 group-hover:text-cyan-300 my-auto px-1">
                                        + Upload {angleName}
                                      </span>
                                    )}
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => uploadCharAngle(char.id, angleIdx, e.target.files?.[0])}
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <button
                            onClick={addCharacter}
                            className="w-full py-3 rounded-lg border border-dashed border-slate-700 text-xs font-bold text-slate-400 hover:text-white hover:border-cyan-400"
                          >
                            + Click to Add Character #{idx + 1} to This Row
                          </button>
                        )}
                      </div>
                    ))}

                    <div className="bg-black/80 border border-slate-800 rounded-xl p-3 flex items-center gap-4">
                      <div className="w-24 h-32 rounded-lg bg-slate-900 border border-yellow-400/50 overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {sheetUrl ? (
                          <img src={sheetUrl} alt={slot} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-mono text-slate-500 text-center px-2">
                            2×4 Sprite Not Built Yet
                          </span>
                        )}
                      </div>
                      <div className="text-xs space-y-1">
                        <div className="font-black text-yellow-400 uppercase">
                          {sheetUrl ? "✓ 2×4 Sprite Card Locked for All 10 Pages" : "Ready to Build 2×4 Sprite Card"}
                        </div>
                        <p className="text-slate-400">
                          Top Row: 4 views ({topChar?.name || "Char 1"}) • Bottom Row: 4 views ({botChar?.name || "Char 2"}).
                          Automatically passed as Reference #{sheetIdx + 2} on every comic page.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* =================================================================
              STEP 3: LIVE 3-REFERENCE PIPELINE BAR + 10-PAGE STUDIO
             ================================================================= */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-[#0e1424] border-2 border-slate-800 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-wider text-cyan-400">
                  10-Page Comic Book (Cover + 9 Pages)
                </h3>
                <span className="text-xs font-mono text-yellow-400">$20 Full Issue</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-2 gap-3 max-h-[720px] overflow-y-auto pr-1">
                {issue.pages.map((pg) => {
                  const isSelected = pg.n === activePageN;
                  const url = viewUrl(issue, pg);
                  const isPaid = purchaseState[pg.act];
                  return (
                    <button
                      key={pg.n}
                      onClick={() => setActivePageN(pg.n)}
                      className={`text-left rounded-xl p-2.5 border-2 transition flex flex-col justify-between ${
                        isSelected
                          ? "bg-slate-800/90 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]"
                          : "bg-slate-950 border-slate-800 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1.5">
                        <span className="text-[11px] font-black px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                          {pageLabel(pg.n)}
                        </span>
                        <span
                          className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                            isPaid
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {isPaid ? "OWNED" : pg.act === "cover" ? "$2" : "$6 ACT"}
                        </span>
                      </div>

                      <div className="aspect-[3/4] w-full rounded-lg bg-slate-900 border border-slate-800 mb-2 overflow-hidden flex items-center justify-center">
                        {url ? (
                          <img src={url} alt={pageLabel(pg.n)} className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center p-2">
                            <div className="text-[11px] font-bold text-slate-500">{pg.act.toUpperCase()}</div>
                            <div className="text-[9px] font-mono text-slate-600 mt-1">
                              {pg.n === 0 ? "Refs: S1 + S2" : `Refs: P${pg.n - 1} + S1 + S2`}
                            </div>
                          </div>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-300 line-clamp-2 w-full">
                        {pg.beat || fallbackBeat(issue, pg.n)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-7 bg-[#0e1424] border-2 border-slate-800 rounded-2xl p-6 space-y-5">
              {/* 3-REFERENCE CONTINUITY BAR */}
              <div className="bg-slate-950 border-2 border-cyan-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-cyan-400">
                    Active 3-Reference Lock for {pageLabel(activePage.n)}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Comic Bot Continuity Engine
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-900 border border-cyan-500/40 rounded-lg p-2.5 flex items-center gap-2.5">
                    <div className="w-12 h-16 bg-black rounded border border-cyan-400 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {prevPageObj && (prevPageObj.cleanUrl || prevPageObj.imageUrl) ? (
                        <img
                          src={prevPageObj.cleanUrl || prevPageObj.imageUrl}
                          alt="Prev Page"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[9px] font-mono text-cyan-300 text-center px-1">
                          {activePage.n === 0 ? "COVER" : `PAGE ${activePage.n - 1}`}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black text-cyan-400 uppercase">Ref #1 • Prev Page</div>
                      <div className="text-xs font-bold text-white truncate">
                        {activePage.n === 0 ? "Cover Splash" : `Page ${activePage.n - 1} Continuity`}
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-yellow-400/40 rounded-lg p-2.5 flex items-center gap-2.5">
                    <div className="w-12 h-16 bg-black rounded border border-yellow-400 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {currentSprites.sheetA ? (
                        <img
                          src={currentSprites.sheetA}
                          alt="Sprite A"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[9px] font-mono text-yellow-300 text-center px-1">2×4 A</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black text-yellow-400 uppercase">Ref #2 • Sprite A</div>
                      <div className="text-[11px] font-bold text-white truncate">
                        Top: {issue.cast[0]?.name || "Char 1"}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        Bot: {issue.cast[1]?.name || "Char 2"}
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-fuchsia-400/40 rounded-lg p-2.5 flex items-center gap-2.5">
                    <div className="w-12 h-16 bg-black rounded border border-fuchsia-400 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {currentSprites.sheetB ? (
                        <img
                          src={currentSprites.sheetB}
                          alt="Sprite B"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[9px] font-mono text-fuchsia-300 text-center px-1">2×4 B</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black text-fuchsia-400 uppercase">Ref #3 • Sprite B</div>
                      <div className="text-[11px] font-bold text-white truncate">
                        Top: {issue.cast[2]?.name || "Char 3"}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        Bot: {issue.cast[3]?.name || "Char 4"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-mono uppercase text-yellow-400">
                    {activePage.act.toUpperCase()} • {pageLabel(activePage.n)} of 9
                  </span>
                  <h3 className="text-2xl font-black text-white">
                    {activePage.n === 0 ? "Comic Bot Cover Maker ($2)" : `Interior Comic ${pageLabel(activePage.n)}`}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onRewrite(activePage.n === 0 ? "cover" : "page", true, activePage.n)}
                    disabled={Boolean(busy)}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-yellow-300 border border-slate-700"
                  >
                    ✨ AI Write Beat
                  </button>
                  <button
                    onClick={() => ink(activePage.n)}
                    disabled={Boolean(busy)}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-yellow-300 text-black font-black text-xs uppercase tracking-wider shadow-[3px_3px_0px_#d946ef]"
                  >
                    ⚡ Ink {pageLabel(activePage.n)}
                  </button>
                </div>
              </div>

              <textarea
                value={activePage.beat}
                onChange={(e) => patchPage(activePage.n, { beat: e.target.value })}
                rows={3}
                placeholder={fallbackBeat(issue, activePage.n)}
                className="w-full bg-slate-950 border-2 border-slate-800 focus:border-cyan-400 rounded-xl p-3.5 text-sm text-white focus:outline-none"
              />

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                <div className="md:col-span-8 aspect-[3/4] w-full bg-black border-4 border-white rounded-xl shadow-[8px_8px_0px_#22d3ee] overflow-hidden flex items-center justify-center">
                  {viewUrl(issue, activePage) ? (
                    <img
                      src={viewUrl(issue, activePage)}
                      alt={pageLabel(activePage.n)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="p-8 text-center space-y-3">
                      <div className="text-lg font-black text-slate-400">{pageLabel(activePage.n)} Canvas</div>
                      <p className="text-xs text-slate-500 max-w-xs mx-auto">
                        Click "Ink {pageLabel(activePage.n)}" above to render with your 3 locked reference images.
                      </p>
                    </div>
                  )}
                </div>

                <div className="md:col-span-4 space-y-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
                    <div className="text-xs font-black uppercase text-fuchsia-400">
                      Small Ink Touch-Ups
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Keep this page layout & panels, only tweak one detail:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(SMALL_CHANGES || ["Fix costume detail", "Fix face consistency", "Brighter neon lighting"]).map(
                        (item: any) => {
                          const label = typeof item === "string" ? item : item.label || item.note;
                          const note = typeof item === "string" ? item : item.prompt || item.note || item.label;
                          return (
                            <button
                              key={label}
                              onClick={() => ink(activePage.n, note)}
                              disabled={Boolean(busy) || !viewUrl(issue, activePage)}
                              className="px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-200 disabled:opacity-40"
                            >
                              {label}
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>

                  {!purchaseState[activePage.act] && (
                    <div className="bg-gradient-to-br from-yellow-500/20 to-fuchsia-500/20 border-2 border-yellow-400/60 rounded-xl p-4 space-y-3">
                      <div className="text-xs font-black uppercase text-yellow-300">
                        Remove Comic Bot Watermark
                      </div>
                      <button
                        onClick={() => buy(activePage.act)}
                        className="w-full py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs uppercase"
                      >
                        Unlock {activePage.act.toUpperCase()} (
                        {money(activePage.act === "cover" ? COVER_PRICE : ACT_PRICE)})
                      </button>
                      <button
                        onClick={() => buy("all")}
                        className="w-full py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-black font-black text-xs uppercase"
                      >
                        Unlock All 10 Pages ({money(totalDue)})
                      </button>
                    </div>
                  )}

                  {/* Required for Apple App Store & Google Play AI App Review */}
                  {viewUrl(issue, activePage) && (
                    <button
                      onClick={() =>
                        setNotice("Image flagged for Comic Bot safety review. You can re-ink this page anytime.")
                      }
                      className="w-full py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-400 hover:text-rose-300"
                    >
                      🚩 Report AI Image
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
