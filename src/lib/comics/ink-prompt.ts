import type { Issue } from "./types"

export function fallbackBeat(issue: Issue, n: number) {
  if (n === 0) return `Cover splash for ${issue.title || "the issue"}.`
  if (n <= 3) return `Beginning, page ${n}. A new moment.`
  if (n <= 6) return `Middle, page ${n}. The trouble gets worse.`
  return `Ending, page ${n}. The last turn of the story.`
}
