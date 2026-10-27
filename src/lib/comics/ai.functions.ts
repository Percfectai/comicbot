const API_BASE =
  typeof window !== "undefined" &&
  (window.location.protocol === "capacitor:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname.endsWith("comicbot.si"))
    ? "https://percfectai.com/comics/"
    : import.meta.env.BASE_URL

type RewriteInput = {
  target: string
  styleId?: string
  invent?: boolean
  title?: string
  genre?: string
  cast?: string
  context?: string
  current?: string
}

export async function rewriteCopy(input: RewriteInput) {
  try {
    const res = await fetch(`${API_BASE}api/rewrite`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    const data = await res.json().catch(() => null)
    if (data?.ok && typeof data.text === "string") return data.text
  } catch {
    /* fall through */
  }
  const seed = (input.current || "").trim()
  if (seed) return seed
  return `${input.title || "The issue"} — ${input.target}. An all-ages scene with a clear action.`
}

export async function planBeats(input: {
  title?: string
  genre?: string
  cast?: string
  summary?: string
  beginning?: string
  middle?: string
  ending?: string
}) {
  try {
    const res = await fetch(`${API_BASE}api/plan`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    const data = await res.json().catch(() => null)
    if (data?.ok && Array.isArray(data.beats) && data.beats.length >= 10) {
      return data.beats.slice(0, 10).map((b: unknown) => String(b || ""))
    }
  } catch {
    /* fall through */
  }
  const title = input.title || "the issue"
  return [
    `Cover splash of ${title}.`,
    "Page 1. The lead walks into the place the story starts.",
    "Page 2. A friend or rival shows up.",
    "Page 3. The first real problem lands.",
    "Page 4. They try a plan and it slips.",
    "Page 5. The middle fight or chase.",
    "Page 6. A secret comes out.",
    "Page 7. The last push begins.",
    "Page 8. The hardest moment.",
    "Page 9. The ending image, costumes unchanged.",
  ]
}
