import type { StyleId } from "./catalog"

export type Role = "lead" | "sidekick" | "villain" | "support"
export type Act = "cover" | "beginning" | "middle" | "ending"
export type WriterMode = "quick" | "pageByPage"

export type CastMember = {
  id: string
  name: string
  role: Role
  look?: string
  description?: string
  refUrl?: string
  angles?: string[]
}

export type ComicPage = {
  n: number
  act: Act
  beat: string
  imageUrl?: string
  cleanUrl?: string
}

export type Purchase = {
  cover: boolean
  beginning: boolean
  middle: boolean
  ending: boolean
}

export type Issue = {
  id: string
  title: string
  genre: string
  styleId: StyleId
  summary: string
  beginning: string
  middle: string
  ending: string
  cast: CastMember[]
  pages: ComicPage[]
  purchase: Purchase
}

export const REWRITES = 3
export const SMALL_CHANGES = [
  "Fix the costume color",
  "Keep the same face",
  "Brighter lighting",
  "Clearer silhouette",
]

export function newIssue(): Issue {
  const acts: Act[] = [
    "cover",
    "beginning", "beginning", "beginning",
    "middle", "middle", "middle",
    "ending", "ending", "ending",
  ]
  return {
    id: crypto.randomUUID(),
    title: "My Percfect Hero",
    genre: "Superhero",
    styleId: "classic",
    summary: "",
    beginning: "",
    middle: "",
    ending: "",
    cast: [],
    pages: acts.map((act, n) => ({ n, act, beat: "" })),
    purchase: { cover: false, beginning: false, middle: false, ending: false },
  }
}
