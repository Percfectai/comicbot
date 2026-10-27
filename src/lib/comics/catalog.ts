export const STYLES = [
  { id: "classic", name: "Classic comic" },
  { id: "anime", name: "Anime" },
  { id: "realistic", name: "Realistic" },
  { id: "noir", name: "Noir" },
  { id: "cyberpunk", name: "Cyberpunk" },
  { id: "watercolor", name: "Watercolor" },
  { id: "pixel", name: "Pixel" },
  { id: "retro90s", name: "1990s foil" },
] as const

export type StyleId = (typeof STYLES)[number]["id"]

export const GENRES = ["Superhero", "Adventure", "Mystery", "Sci-fi", "Slice of life"]

export function styleById(id: string) {
  return STYLES.find((s) => s.id === id) ?? STYLES[0]
}
