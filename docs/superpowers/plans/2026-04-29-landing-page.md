# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public landing page at `/` that explains MeshAgent to open-source visitors, with an auth check that redirects logged-in users to `/overview`.

**Architecture:** `app/page.tsx` renders a `LandingPage` client component that uses the existing `useAuth()` hook to redirect logged-in users. All section sub-components are plain TSX (no hooks needed). Tests live in `test/landing-page.test.tsx` following the existing vitest + RTL pattern.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS (custom colors: canvas, surface, muted, accent, purple, success), Vitest + @testing-library/react

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/web/app/globals.css` | Modify | Add `landing-pulse` and `landing-node-pulse` keyframes |
| `apps/web/components/landing/Nav.tsx` | Create | Sticky nav bar |
| `apps/web/components/landing/Hero.tsx` | Create | Hero section with animated agent node row |
| `apps/web/components/landing/WhatIsIt.tsx` | Create | 2-col layout + architecture diagram |
| `apps/web/components/landing/Features.tsx` | Create | 6-card feature grid |
| `apps/web/components/landing/HowItWorks.tsx` | Create | 4-step flow section |
| `apps/web/components/landing/TechStack.tsx` | Create | Tech stack pills |
| `apps/web/components/landing/FooterCta.tsx` | Create | Bottom CTA section + footer bar |
| `apps/web/components/landing/LandingPage.tsx` | Create | `'use client'` — composes all sections, handles auth redirect |
| `apps/web/app/page.tsx` | Modify | Remove hard redirect, render `<LandingPage />` |
| `apps/web/test/landing-page.test.tsx` | Create | Auth redirect behavior tests |

---

## Task 1: CSS Keyframe Animations

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Open globals.css and find the existing keyframes block**

Run: `grep -n "@keyframes" apps/web/app/globals.css`

You will see `pulse-dot`, `blink`, `fadeUp` already defined. Add the landing-specific ones after the last keyframe block.

- [ ] **Step 2: Add two new keyframes at the end of globals.css**

Append after the existing keyframe definitions (before the last line of the file):

```css
/* Landing page — badge dot pulse */
@keyframes landing-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.landing-pulse { animation: landing-pulse 2s ease-in-out infinite; }

/* Landing page — agent node glow pulse */
@keyframes landing-node-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.25); }
}
.landing-node-pulse { animation: landing-node-pulse 2s ease-in-out infinite; }
```

- [ ] **Step 3: Verify no duplicate keyframe names**

Run: `grep -c "landing-pulse\|landing-node-pulse" apps/web/app/globals.css`

Expected output: `4` (2 @keyframes + 2 class definitions)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(landing): add CSS keyframe animations for landing page"
```

---

## Task 2: Nav Component

**Files:**
- Create: `apps/web/components/landing/Nav.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link'

const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com/meshagent/mesh-agent'

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-12 py-4 border-b border-white/5 bg-[rgba(10,8,18,0.8)] backdrop-blur-md">
      <div className="flex items-center gap-2.5 font-bold text-[17px] text-[#f1f5f9]">
        <span className="w-2 h-2 rounded-full bg-[#a78bfa] shadow-[0_0_8px_#a78bfa] landing-pulse" />
        MeshAgent
      </div>

      <div className="hidden md:flex items-center gap-7">
        <a href="#features" className="text-sm text-muted hover:text-[#f1f5f9] transition-colors">Features</a>
        <a href="#how-it-works" className="text-sm text-muted hover:text-[#f1f5f9] transition-colors">How it works</a>
        <Link href="/docs" className="text-sm text-muted hover:text-[#f1f5f9] transition-colors">Docs</Link>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-muted hover:text-[#f1f5f9] transition-colors">GitHub</a>
      </div>

      <Link
        href="/login"
        className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-[#7c3aed] to-[#2563eb]"
      >
        Login →
      </Link>
    </nav>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `apps/web/`:
```bash
pnpm tsc --noEmit
```
Expected: no errors mentioning `Nav.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/landing/Nav.tsx
git commit -m "feat(landing): add Nav component"
```

---

## Task 3: Hero Component

**Files:**
- Create: `apps/web/components/landing/Hero.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link'

const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com/meshagent/mesh-agent'

const AGENT_NODES = [
  { label: 'frontend', color: '#a78bfa', delay: '0s' },
  { label: 'backend',  color: '#38bdf8', delay: '0.3s' },
  { label: 'mobile',   color: '#4ade80', delay: '0.6s' },
  { label: 'devops',   color: '#fb923c', delay: '0.9s' },
  { label: 'designer', color: '#f472b6', delay: '1.2s' },
  { label: 'qa',       color: '#facc15', delay: '1.5s' },
  { label: 'reviewer', color: '#ef4444', delay: '1.8s' },
]

export function Hero() {
  return (
    <section
      className="text-center px-6 pt-24 pb-20 relative overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,58,237,0.25) 0%, transparent 70%)',
      }}
    >
      {/* Badge */}
      <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full mb-7 border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.1)] text-[#a78bfa] text-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] landing-pulse" />
        Open Source · Self-hosted
      </div>

      {/* Headline */}
      <h1 className="text-5xl md:text-6xl font-extrabold leading-tight tracking-tight mb-5 text-[#f1f5f9]">
        Your AI dev team,<br />
        <span style={{ background: 'linear-gradient(90deg,#a78bfa,#38bdf8,#4ade80)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          unified &amp; observable
        </span>
      </h1>

      <p className="text-lg text-muted max-w-lg mx-auto mb-10">
        Dispatch Claude, Gemini, and Cursor agents with natural language.
        Track progress in real-time. Ship faster.
      </p>

      {/* CTA buttons */}
      <div className="flex flex-wrap gap-3 justify-center mb-16">
        <Link
          href="/login"
          className="px-7 py-3.5 rounded-xl text-[15px] font-semibold text-white bg-gradient-to-r from-[#7c3aed] to-[#2563eb] shadow-[0_4px_24px_rgba(124,58,237,0.4)]"
        >
          Login to dashboard →
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="px-7 py-3.5 rounded-xl text-[15px] font-semibold text-[#e2e8f0] border border-white/15 bg-white/[0.04]"
        >
          ★ Star on GitHub
        </a>
      </div>

      {/* Agent node row */}
      <div className="flex flex-wrap justify-center gap-5">
        {AGENT_NODES.map(({ label, color, delay }) => (
          <div key={label} className="flex flex-col items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full landing-node-pulse"
              style={{ background: color, boxShadow: `0 0 10px ${color}`, animationDelay: delay }}
            />
            <span className="text-[11px] uppercase tracking-wide text-dim">{label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Compile check**

Run from `apps/web/`:
```bash
pnpm tsc --noEmit
```
Expected: no errors mentioning `Hero.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/landing/Hero.tsx
git commit -m "feat(landing): add Hero section with agent node row"
```

---

## Task 4: WhatIsIt Component

**Files:**
- Create: `apps/web/components/landing/WhatIsIt.tsx`

- [ ] **Step 1: Create the file**

```tsx
export function WhatIsIt() {
  return (
    <div className="bg-white/[0.02] px-6 py-20">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-bold uppercase tracking-[2px] text-[#a78bfa] mb-3">What is MeshAgent</p>

        <div className="grid md:grid-cols-2 gap-10 items-center mt-12">
          {/* Text */}
          <div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-[#f1f5f9]">
              A control center for<br />AI development teams
            </h2>
            <p className="text-muted mb-4 leading-relaxed">
              MeshAgent is an open-source platform that lets you manage multiple AI agents —
              each with a specialized role — from a single browser interface.
            </p>
            <p className="text-muted leading-relaxed">
              Type a task in natural language. The Lead AI analyzes it, proposes a plan,
              dispatches agents to the right roles, and streams their output back in real-time.
              No CLI juggling, no manual worktree management.
            </p>
          </div>

          {/* Architecture diagram */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 font-mono text-xs space-y-3">
            <div className="flex items-center gap-2">
              <Box color="purple">Browser / PWA</Box>
              <Arrow />
              <span className="text-dim">HTTPS</span>
            </div>
            <div className="flex items-center gap-2">
              <Box color="blue">Next.js Web</Box>
              <span className="text-dim">↔</span>
              <Box color="blue">Fastify API</Box>
            </div>
            <div className="pl-2 text-dim">↓ dispatches</div>
            <div className="flex items-center gap-2">
              <Box color="green">Orchestrator</Box>
              <Arrow />
              <span className="text-dim">spawns</span>
            </div>
            <div className="pl-6 flex gap-2 flex-wrap">
              <Box color="orange">claude</Box>
              <Box color="orange">gemini</Box>
              <Box color="orange">cursor</Box>
            </div>
            <div className="pt-2 border-t border-white/[0.06] flex gap-2 flex-wrap">
              {['PostgreSQL', 'Redis', 'MinIO'].map(s => (
                <span key={s} className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-dim text-[10px]">{s}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Box({ color, children }: { color: 'purple' | 'blue' | 'green' | 'orange'; children: React.ReactNode }) {
  const styles = {
    purple: 'bg-[rgba(167,139,250,0.1)] border-[rgba(167,139,250,0.3)] text-[#a78bfa]',
    blue:   'bg-[rgba(56,189,248,0.1)]  border-[rgba(56,189,248,0.3)]  text-[#38bdf8]',
    green:  'bg-[rgba(74,222,128,0.1)]  border-[rgba(74,222,128,0.3)]  text-[#4ade80]',
    orange: 'bg-[rgba(251,146,60,0.1)]  border-[rgba(251,146,60,0.3)]  text-[#fb923c]',
  }
  return (
    <span className={`px-3 py-1 rounded border text-[11px] whitespace-nowrap ${styles[color]}`}>
      {children}
    </span>
  )
}

function Arrow() {
  return <span className="text-dim">↓</span>
}
```

- [ ] **Step 2: Compile check**

Run from `apps/web/`:
```bash
pnpm tsc --noEmit
```
Expected: no errors mentioning `WhatIsIt.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/landing/WhatIsIt.tsx
git commit -m "feat(landing): add WhatIsIt section with architecture diagram"
```

---

## Task 5: Features Component

**Files:**
- Create: `apps/web/components/landing/Features.tsx`

- [ ] **Step 1: Create the file**

```tsx
const FEATURES = [
  {
    icon: '💬',
    title: 'Lead Chat',
    desc: 'Describe tasks in plain English. The Lead AI proposes a brief — you confirm, agents execute.',
  },
  {
    icon: '📋',
    title: 'Kanban Board',
    desc: 'Real-time task tracking across Backlog → In Progress → Review → Done with drag-and-drop.',
  },
  {
    icon: '📡',
    title: 'Live Monitoring',
    desc: 'Watch all agents work simultaneously with live output streaming via WebSocket.',
  },
  {
    icon: '🔄',
    title: 'Automated Review Loop',
    desc: 'Reviewer agent finds issues → select which to fix → subtasks auto-created and dispatched.',
  },
  {
    icon: '🐙',
    title: 'GitHub Integration',
    desc: 'Pull PRs, commits, and issues. Agents create pull requests directly from completed tasks.',
  },
  {
    icon: '📱',
    title: 'PWA — Works Everywhere',
    desc: 'Install on iOS, Android, or desktop. Full control of your agents from your phone.',
  },
]

export function Features() {
  return (
    <div id="features" className="bg-white/[0.02] px-6 py-20">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-bold uppercase tracking-[2px] text-[#a78bfa] mb-3">Features</p>
        <h2 className="text-3xl md:text-4xl font-bold text-[#f1f5f9] mb-12">Everything your team needs</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {FEATURES.map(({ icon, title, desc }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 transition-all duration-200 hover:border-[rgba(167,139,250,0.3)] hover:-translate-y-0.5"
            >
              <div className="text-2xl mb-3">{icon}</div>
              <h3 className="font-semibold text-[15px] text-[#f1f5f9] mb-1.5">{title}</h3>
              <p className="text-[13px] text-dim leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Compile check**

Run from `apps/web/`:
```bash
pnpm tsc --noEmit
```
Expected: no errors mentioning `Features.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/landing/Features.tsx
git commit -m "feat(landing): add Features section"
```

---

## Task 6: HowItWorks Component

**Files:**
- Create: `apps/web/components/landing/HowItWorks.tsx`

- [ ] **Step 1: Create the file**

```tsx
const STEPS = [
  {
    num: '1',
    title: 'Describe',
    desc: 'Type your task in the Lead Chat using natural language',
    color: '#a78bfa',
  },
  {
    num: '2',
    title: 'Dispatch',
    desc: 'Lead AI analyzes the task and assigns it to the right agent roles',
    color: '#38bdf8',
  },
  {
    num: '3',
    title: 'Monitor',
    desc: 'Watch agents work in real-time on the Kanban board with live output',
    color: '#4ade80',
  },
  {
    num: '4',
    title: 'Ship',
    desc: 'Review agent output, approve PRs, and merge — all from your browser',
    color: '#fb923c',
  },
]

export function HowItWorks() {
  return (
    <div id="how-it-works" className="px-6 py-20">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-bold uppercase tracking-[2px] text-[#a78bfa] mb-3">How it works</p>
        <h2 className="text-3xl md:text-4xl font-bold text-[#f1f5f9] mb-12">From idea to PR in 4 steps</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative">
          {/* Connector line (desktop only) */}
          <div
            className="hidden md:block absolute top-7 left-[10%] right-[10%] h-px opacity-40"
            style={{ background: 'linear-gradient(90deg,#7c3aed,#2563eb,#0ea5e9,#4ade80)' }}
          />

          {STEPS.map(({ num, title, desc, color }) => (
            <div key={num} className="flex flex-col items-center text-center">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg mb-4 border-2 relative z-10"
                style={{
                  color,
                  borderColor: color,
                  background: `${color}26`,
                }}
              >
                {num}
              </div>
              <h3 className="font-semibold text-[14px] text-[#f1f5f9] mb-1.5">{title}</h3>
              <p className="text-[12px] text-dim leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Compile check**

Run from `apps/web/`:
```bash
pnpm tsc --noEmit
```
Expected: no errors mentioning `HowItWorks.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/landing/HowItWorks.tsx
git commit -m "feat(landing): add HowItWorks section"
```

---

## Task 7: TechStack Component

**Files:**
- Create: `apps/web/components/landing/TechStack.tsx`

- [ ] **Step 1: Create the file**

```tsx
const STACK = [
  'Claude Code CLI',
  'Gemini',
  'Cursor Agent',
  'Next.js 14',
  'Fastify',
  'PostgreSQL',
  'Redis',
  'Docker',
  'GitHub Webhooks',
]

export function TechStack() {
  return (
    <div className="bg-white/[0.02] px-6 py-20 text-center">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-bold uppercase tracking-[2px] text-[#a78bfa] mb-3">Tech Stack</p>
        <h2 className="text-3xl md:text-4xl font-bold text-[#f1f5f9] mb-10">Built on proven open-source tools</h2>

        <div className="flex flex-wrap justify-center gap-4">
          {STACK.map(name => (
            <span
              key={name}
              className="px-5 py-2.5 rounded-full border border-white/[0.1] bg-white/[0.05] text-[13px] font-medium text-[#cbd5e1]"
            >
              ✦ {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Compile check**

Run from `apps/web/`:
```bash
pnpm tsc --noEmit
```
Expected: no errors mentioning `TechStack.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/landing/TechStack.tsx
git commit -m "feat(landing): add TechStack section"
```

---

## Task 8: FooterCta Component

**Files:**
- Create: `apps/web/components/landing/FooterCta.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link'

const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com/meshagent/mesh-agent'

export function FooterCta() {
  return (
    <>
      <div
        className="text-center px-6 py-24"
        style={{
          background: 'radial-gradient(ellipse 60% 60% at 50% 100%, rgba(124,58,237,0.2) 0%, transparent 70%)',
        }}
      >
        <h2 className="text-4xl md:text-5xl font-extrabold mb-4 text-[#f1f5f9]">
          Ready to ship with<br />
          <span style={{ background: 'linear-gradient(90deg,#a78bfa,#38bdf8,#4ade80)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            your AI team?
          </span>
        </h2>
        <p className="text-muted text-base mb-9">Self-hosted. Open-source. One command to deploy.</p>

        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/login"
            className="px-7 py-3.5 rounded-xl text-[15px] font-semibold text-white bg-gradient-to-r from-[#7c3aed] to-[#2563eb] shadow-[0_4px_24px_rgba(124,58,237,0.4)]"
          >
            Login to dashboard →
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-7 py-3.5 rounded-xl text-[15px] font-semibold text-[#e2e8f0] border border-white/15 bg-white/[0.04]"
          >
            ★ Star on GitHub
          </a>
          <Link
            href="/docs"
            className="px-7 py-3.5 rounded-xl text-[15px] font-semibold text-[#e2e8f0] border border-white/15 bg-white/[0.04]"
          >
            Read the docs
          </Link>
        </div>
      </div>

      <footer className="text-center px-6 py-6 border-t border-white/[0.06] text-dim text-[13px]">
        MeshAgent is open-source software released under the MIT License.
      </footer>
    </>
  )
}
```

- [ ] **Step 2: Compile check**

Run from `apps/web/`:
```bash
pnpm tsc --noEmit
```
Expected: no errors mentioning `FooterCta.tsx`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/landing/FooterCta.tsx
git commit -m "feat(landing): add FooterCta section"
```

---

## Task 9: LandingPage Composition + Auth Redirect

**Files:**
- Create: `apps/web/components/landing/LandingPage.tsx`

This is the only `'use client'` component. It checks auth state and redirects logged-in users.

- [ ] **Step 1: Write the failing test first**

Create `apps/web/test/landing-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider } from '@/lib/auth'
import { LandingPage } from '@/components/landing/LandingPage'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

describe('LandingPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
  })

  it('redirects to /overview when user is authenticated', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', email: 'admin@example.com', role: 'admin' }),
    })

    render(
      <AuthProvider>
        <LandingPage />
      </AuthProvider>
    )

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/overview'))
  })

  it('renders landing page when user is not authenticated', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    })

    render(
      <AuthProvider>
        <LandingPage />
      </AuthProvider>
    )

    await screen.findByText(/unified & observable/i)
    expect(pushMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

Run from `apps/web/`:
```bash
pnpm test test/landing-page.test.tsx
```
Expected: FAIL — `LandingPage` not found / no module

- [ ] **Step 3: Create the LandingPage component**

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { Nav } from './Nav'
import { Hero } from './Hero'
import { WhatIsIt } from './WhatIsIt'
import { Features } from './Features'
import { HowItWorks } from './HowItWorks'
import { TechStack } from './TechStack'
import { FooterCta } from './FooterCta'

export function LandingPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user) {
      router.push('/overview')
    }
  }, [user, loading, router])

  if (loading || user) return null

  return (
    <div className="min-h-screen" style={{ background: '#0a0812' }}>
      <Nav />
      <Hero />
      <WhatIsIt />
      <Features />
      <HowItWorks />
      <TechStack />
      <FooterCta />
    </div>
  )
}
```

**Note:** `useAuth()` returns `{ user, loading, login, logout }`. Verify the exact shape by checking `apps/web/lib/auth.tsx` — look for the `AuthContext` type. If the field is named differently (e.g., `isLoading`), adjust accordingly before proceeding.

- [ ] **Step 4: Run test to confirm it passes**

Run from `apps/web/`:
```bash
pnpm test test/landing-page.test.tsx
```
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/landing/LandingPage.tsx apps/web/test/landing-page.test.tsx
git commit -m "feat(landing): add LandingPage with auth redirect"
```

---

## Task 10: Wire Up app/page.tsx

**Files:**
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Replace the current content**

Current content:
```tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/overview')
}
```

New content:
```tsx
import { LandingPage } from '@/components/landing/LandingPage'

export default function Home() {
  return <LandingPage />
}
```

- [ ] **Step 2: Compile check**

Run from `apps/web/`:
```bash
pnpm tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Run all tests**

Run from `apps/web/`:
```bash
pnpm test
```
Expected: all existing tests still pass + 2 new landing-page tests pass

- [ ] **Step 4: Start dev server and verify visually**

Run from the project root:
```bash
pnpm dev
```
Open `http://localhost:4800` in a browser.

Verify:
- Unauthenticated: landing page renders with dark gradient background, nav, hero, 7 pulsing agent nodes, all sections, footer
- Click "Login →" → navigates to `/login`
- After logging in and coming back to `/`, redirects immediately to `/overview`
- Mobile viewport (`< 768px`): nav links hidden, features stack to single column

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(landing): wire landing page to / route"
```

---

## Self-Review

### Spec Coverage
- [x] `/` shows landing page for unauthenticated → LandingPage renders when `!user`
- [x] Authenticated redirect to `/overview` → `router.push('/overview')` in useEffect
- [x] Nav with Login → button → `href="/login"` in Nav.tsx
- [x] Hero with badge, headline, gradient, buttons, agent nodes → Hero.tsx
- [x] What is MeshAgent section → WhatIsIt.tsx
- [x] 6 feature cards → Features.tsx
- [x] 4-step How it works → HowItWorks.tsx
- [x] Tech stack pills → TechStack.tsx
- [x] Footer CTA + footer bar → FooterCta.tsx
- [x] CSS animations CSS-only → globals.css keyframes, no Framer Motion
- [x] Responsive: `hidden md:flex` for nav links, `grid-cols-1 md:grid-cols-3` for features, `grid-cols-2 md:grid-cols-4` for steps
- [x] GITHUB_URL env var → `NEXT_PUBLIC_GITHUB_URL` with fallback

### Placeholder Scan
None found — all steps contain actual code.

### Type Consistency
- `AGENT_NODES`, `FEATURES`, `STEPS`, `STACK` arrays defined in the same file they're used
- `useAuth()` note added in Task 9 Step 3 to verify `loading` field name before implementing
- `LandingPage` exported as named export, imported as named import in `page.tsx`
