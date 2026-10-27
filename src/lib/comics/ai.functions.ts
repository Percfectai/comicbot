export async function rewriteCopy(input: { target: string; current?: string; title?: string }) {
  const seed = (input.current || "").trim()
  if (seed) return `${seed} The picture stays clear, the costumes stay the same, and this beat moves one step forward.`
  return `${input.title || "The issue"} — ${input.target}. An all-ages scene with a clear action and the same costumes.`
}

export async function planBeats(input: { title?: string }) {
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
