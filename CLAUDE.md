# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Neural Map is an AI-powered knowledge graph explorer. Users enter a topic, Claude generates a structured knowledge graph (35-50 nodes with connections), and the app renders it as an interactive neural network on a canvas. Users can click nodes to open a chat panel for deeper exploration of that topic.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Start dev server at localhost:3000
npm run build      # Production build
npm run start      # Start production server
```

No test framework, linter, or type checker is configured.

## Architecture

This is a minimal Next.js 14 App Router project with **three files** that matter:

- **`app/page.js`** — Single `"use client"` component (~800 lines) containing the entire frontend:
  - `NeuralMapApp` — Main component managing app state (`landing` / `loading` / `map`), canvas rendering, pan/zoom, node hit-testing
  - `LandingScreen` — Topic input and suggested topics
  - `LoadingScreen` — Animated loading states during generation
  - `ChatPanel` — Side panel for per-node AI chat with conversation history
  - Prompt builders (`buildGenerationPrompt`, `buildChatSystemPrompt`) — Construct Claude API prompts
  - Graph layout — Force-directed simulation (300 iterations of repulsion + spring forces)
  - Canvas renderer — Runs in a `requestAnimationFrame` loop with node glow, connection pulses, and category filtering

- **`app/api/claude/route.js`** — Server-side proxy to the Anthropic Messages API. Keeps the API key out of the browser. Passes through model, max_tokens, system, and messages fields.

- **`app/globals.css`** — JetBrains Mono font import, dark theme base styles, scrollbar customization.

## Key Patterns

- **All rendering is canvas-based** — Nodes and connections are drawn on a `<canvas>` element, not DOM elements. Hit-testing is manual coordinate math in `getNodeAt()`.
- **Hub nodes** — Nodes with 4+ connections get distinct colors from `HUB_PALETTE` and render larger. All other nodes use `REGULAR_COLOR` (#8BA8A0).
- **No external UI or state libraries** — Pure React state with `useState`/`useRef`. Inline styles throughout (no CSS modules or Tailwind).
- **JSON parsing with repair** — The generation response parser attempts to fix truncated JSON by balancing brackets/braces.
- **Two Claude API call patterns**: generation (one-shot, 8000 tokens, no system prompt) and chat (multi-turn with system prompt containing node context and connections).

## Environment Variables

- `ANTHROPIC_API_KEY` — Required. Set in `.env.local` for development, Vercel dashboard for production.
