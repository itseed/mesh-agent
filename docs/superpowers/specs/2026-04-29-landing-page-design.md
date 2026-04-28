# MeshAgent Landing Page Design

## Goal

Add a public landing page at `/` in the existing `apps/web` Next.js app that explains what MeshAgent is, how it works, and links visitors to Login. Unauthenticated visitors see the landing page; authenticated users are redirected to `/overview`.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Location | `/` route in `apps/web` | No new app/repo needed; auth redirect is natural here |
| Language | English only | Open-source community audience |
| Visual style | Dark gradient (purple → blue → green) | Modern developer tool aesthetic |
| Animations | CSS-only (Tailwind + keyframes) | No new dependencies; keeps bundle light |
| Sections | 6 (see below) | Balanced: tells the story without overwhelming |

## Page Structure

### 1. Nav (sticky)
- Logo: pulsing purple dot + "MeshAgent"
- Links: Features · How it works · Docs · GitHub
- CTA button: "Login →" → links to `/login`

### 2. Hero
- Badge: "Open Source · Self-hosted" (pulsing dot)
- Headline: "Your AI dev team, unified & observable" (gradient on second line)
- Subtext: one-liner about Claude/Gemini/Cursor + natural language dispatch
- Buttons: "Login to dashboard →" (primary) + "★ Star on GitHub" (secondary)
- Agent node row: 7 colored pulsing dots (frontend, backend, mobile, devops, designer, qa, reviewer) — CSS animation only, staggered delay

### 3. What is MeshAgent
- Section label + title: "A control center for AI development teams"
- Two-column layout:
  - Left: 2 paragraphs explaining the concept
  - Right: architecture diagram (styled boxes + arrows) showing Browser → Next.js/Fastify → Orchestrator → claude/gemini/cursor → PostgreSQL/Redis/MinIO

### 4. Features (6 cards, 3-column grid)
| Icon | Title | Description |
|---|---|---|
| 💬 | Lead Chat | Natural language → Lead AI proposes brief → agents execute |
| 📋 | Kanban Board | Real-time Backlog → In Progress → Review → Done |
| 📡 | Live Monitoring | WebSocket streaming of all agent output |
| 🔄 | Automated Review Loop | Reviewer finds issues → subtasks auto-created |
| 🐙 | GitHub Integration | Pull PRs/commits/issues; agents create PRs |
| 📱 | PWA — Works Everywhere | Install on iOS/Android/desktop |

### 5. How it works (4 steps, connected by gradient line)
1. **Describe** — Type task in Lead Chat (natural language)
2. **Dispatch** — Lead AI assigns to right agent roles
3. **Monitor** — Watch Kanban board + live output stream
4. **Ship** — Review output, approve PRs, merge

### 6. Tech Stack
Pills row: Claude Code CLI · Gemini · Cursor Agent · Next.js 14 · Fastify · PostgreSQL · Redis · Docker · GitHub Webhooks

### 7. Footer CTA
- Headline: "Ready to ship with your AI team?"
- Subtext: "Self-hosted. Open-source. One command to deploy."
- Buttons: "Login to dashboard →" + "★ Star on GitHub" + "Read the docs"

### 8. Footer bar
- "MeshAgent is open-source software released under the MIT License."

## Routing Behavior

- `/` — show landing page if not authenticated; redirect to `/overview` if session cookie valid
- Nav "Login →" and all CTA buttons → `/login`
- "Read the docs" → `/docs` route (renders a placeholder if docs page doesn't exist yet)
- "★ Star on GitHub" → GitHub repo URL (configured via env or hardcoded constant)

## Files to Create/Modify

| File | Action | Notes |
|---|---|---|
| `apps/web/app/page.tsx` | Modify | Replace redirect-only with auth check + landing page render |
| `apps/web/app/components/landing/` | Create dir | Keep landing components isolated |
| `apps/web/app/components/landing/Nav.tsx` | Create | Sticky nav |
| `apps/web/app/components/landing/Hero.tsx` | Create | Hero section with agent nodes |
| `apps/web/app/components/landing/WhatIsIt.tsx` | Create | 2-col layout + arch diagram |
| `apps/web/app/components/landing/Features.tsx` | Create | 6-card grid |
| `apps/web/app/components/landing/HowItWorks.tsx` | Create | 4-step flow |
| `apps/web/app/components/landing/TechStack.tsx` | Create | Pills + footer CTA combined |
| `apps/web/app/components/landing/FooterCta.tsx` | Create | Bottom CTA section |
| `apps/web/app/globals.css` | Modify | Add CSS keyframe animations (pulse, nodePulse) |

## Visual Spec

- **Background**: `#0a0812`
- **Gradient text**: `linear-gradient(90deg, #a78bfa, #38bdf8, #4ade80)`
- **Primary button**: `linear-gradient(90deg, #7c3aed, #2563eb)` with purple glow shadow
- **Secondary button**: glass border `rgba(255,255,255,0.15)`, fill `rgba(255,255,255,0.04)`
- **Cards**: `rgba(255,255,255,0.04)` bg, `rgba(255,255,255,0.08)` border, hover lifts 2px + purple border
- **Section label**: `#a78bfa`, uppercase, letter-spacing 2px
- **Body text**: `#94a3b8`
- **Agent node colors**: frontend `#a78bfa` · backend `#38bdf8` · mobile `#4ade80` · devops `#fb923c` · designer `#f472b6` · qa `#facc15` · reviewer `#ef4444`
- **Nav**: sticky, `backdrop-filter: blur(12px)`, bg `rgba(10,8,18,0.8)`
- **Hero radial glow**: `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,58,237,0.25) 0%, transparent 70%)`

## Auth Logic in `page.tsx`

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import LandingPage from './components/landing/LandingPage'

export default async function Home() {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')
  if (token) redirect('/overview')
  return <LandingPage />
}
```

The exact cookie name must match what the existing auth flow sets — check `apps/web` auth middleware before implementing.

## Responsive Behavior

- Mobile (`< 768px`): nav links hidden, single-column features grid, 2-column steps grid, arch diagram stacks below text
- Tablet+: full layout as described above

## Out of Scope

- i18n / Thai language support
- Screenshot or video embed in hero
- Framer Motion animations
- Docs page content
- GitHub star count badge (API call)
