import { createRoot } from "react-dom/client"
import Studio from "./studio"
import "./index.css"

function sheet() {
  const c = document.createElement("canvas")
  c.width = 800
  c.height = 1000
  const g = c.getContext("2d")!
  g.fillStyle = "#111827"
  g.fillRect(0, 0, 800, 1000)
  g.strokeStyle = "#22d3ee"
  g.lineWidth = 4
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * 200
    const y = i < 4 ? 0 : 500
    g.strokeRect(x + 12, y + 12, 176, 476)
    g.fillStyle = "#e2e8f0"
    g.font = "24px sans-serif"
    g.fillText(["FRONT", "BACK", "LEFT", "RIGHT"][i % 4], x + 40, y + 250)
  }
  return c.toDataURL("image/jpeg", 0.8)
}

function pageArt(label: string) {
  const c = document.createElement("canvas")
  c.width = 768
  c.height = 1024
  const g = c.getContext("2d")!
  g.fillStyle = "#0b0f1c"
  g.fillRect(0, 0, 768, 1024)
  g.strokeStyle = "#facc15"
  g.lineWidth = 8
  g.strokeRect(36, 36, 696, 952)
  g.fillStyle = "#fff"
  g.font = "700 42px sans-serif"
  g.fillText(label, 70, 140)
  g.font = "24px sans-serif"
  g.fillStyle = "#94a3b8"
  g.fillText("Preview frame. The real inker is not connected.", 70, 200)
  return c.toDataURL("image/jpeg", 0.8)
}

const nativeFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url.includes("api/sheet")) {
    return new Response(JSON.stringify({ ok: true, url: sheet() }), {
      headers: { "Content-Type": "application/json" },
    })
  }
  if (url.includes("api/ink")) {
    let page = 0
    try {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      page = Number(body.page || 0)
    } catch { /* preview */ }
    const label = page === 0 ? "COVER" : `PAGE ${page}`
    return new Response(JSON.stringify({ ok: true, url: pageArt(label) }), {
      headers: { "Content-Type": "application/json" },
    })
  }
  return nativeFetch(input, init)
}

createRoot(document.getElementById("root")!).render(<Studio />)
