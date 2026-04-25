# MeshAgent

Web platform สำหรับ orchestrate AI dev team agents — เข้าถึงได้จากทุกที่ผ่าน browser รวมถึง mobile และ iPad

ต่อยอดจาก [agent-teams](https://github.com/your-org/agent-teams) CLI ให้รันบน server แบบ always-on พร้อม Kanban dashboard และ GitHub integration

---

## Architecture

```mermaid
graph TB
    subgraph Client
        Browser["🌐 Browser / PWA\n(Mobile, iPad, Desktop)"]
    end

    subgraph Droplet["DigitalOcean Droplet (Docker Compose)"]
        Nginx["🔒 Nginx\nHTTPS + Reverse Proxy"]
        Web["Next.js PWA\n:3000"]
        API["Fastify API\n:3001"]
        Orch["Orchestration Service\n:3002"]
        DB["PostgreSQL\n:5432"]
        Redis["Redis\n:6379"]
    end

    subgraph Agents["Claude Code Agents"]
        Frontend["frontend"]
        Backend["backend"]
        Mobile["mobile"]
        DevOps["devops"]
        Designer["designer"]
        QA["qa"]
        Reviewer["reviewer"]
    end

    GitHub["🐙 GitHub\nWebhooks + API"]

    Browser -->|HTTPS| Nginx
    Nginx -->|proxy| Web
    Nginx -->|/api| API
    Nginx -->|/api/ws WebSocket| API

    Web <-->|REST + WebSocket| API
    API --> DB
    API --> Redis
    API -->|dispatch| Orch

    Orch -->|spawn subprocess| Agents
    Agents -->|stdout stream| Redis
    Redis -->|pub/sub| API
    API -->|WebSocket push| Browser

    GitHub -->|webhook| API
    API -->|Octokit| GitHub
```

---

## Features

| Feature | Description |
|---|---|
| **Kanban Board** | Backlog → In Progress → Review → Done พร้อม drag-and-drop |
| **Agent Monitoring** | เห็น live output ทุก agent พร้อมกัน real-time ผ่าน WebSocket |
| **Command Bar** | สั่งงาน agent จาก quick bar หรือขยายเป็น modal ทุกหน้า |
| **GitHub Integration** | PRs, commits, issues, webhook trigger agents อัตโนมัติ |
| **Projects** | จัดการ projects และ paths เหมือน projects.json แต่ผ่าน UI |
| **PWA** | ติดตั้งบน iOS/Android ได้ ใช้งาน offline บางส่วน |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS |
| Backend | Fastify 4, Drizzle ORM, PostgreSQL 16 |
| Realtime | WebSocket, Redis pub/sub |
| Orchestration | Node.js subprocess, Claude Code CLI |
| Infrastructure | Docker Compose, Nginx, Let's Encrypt |

---

## Sequence Diagrams

### Dispatch Agent จาก Mobile

```mermaid
sequenceDiagram
    actor User as 👤 User (Mobile)
    participant Web as Next.js PWA
    participant API as Fastify API
    participant Orch as Orchestrator
    participant Claude as Claude Code CLI
    participant Redis

    User->>Web: พิมพ์ prompt ใน Command Bar
    Web->>API: POST /agents { role, workingDir, prompt }
    API->>Orch: POST /sessions { role, workingDir, prompt }
    Orch->>Claude: spawn subprocess
    Orch-->>API: { sessionId, status: running }
    API-->>Web: { sessionId }
    Web->>API: WebSocket connect /ws?sessionId=xxx

    loop Agent ทำงาน
        Claude->>Orch: stdout line
        Orch->>Redis: PUBLISH agent:{id}:output
        Redis->>API: message event
        API->>Web: WebSocket push { line }
        Web->>User: แสดง live output
    end

    Claude->>Orch: process exit
    Orch->>Redis: PUBLISH status: idle
    API->>Web: WebSocket push { status: idle }
```

### GitHub Webhook → Auto-trigger Agent

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant API as Fastify API
    participant Redis
    participant Web as Next.js PWA
    participant Orch as Orchestrator

    GH->>API: POST /github/webhook (issue opened)
    API->>API: verify HMAC signature
    API->>Redis: PUBLISH github:events { event, payload }
    Redis->>Web: WebSocket push (GitHub activity feed)
    Note over Web: แสดง notification ใน UI

    alt User กด "Assign to Agent"
        Web->>API: POST /agents { role: backend, prompt: issue body }
        API->>Orch: POST /sessions
        Orch->>Orch: spawn Claude Code CLI
    end
```

### Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant Web as Next.js PWA
    participant API as Fastify API

    User->>Web: เปิด app ครั้งแรก
    Web->>Web: เช็ค localStorage token
    alt ไม่มี token
        Web->>User: redirect /login
        User->>Web: ใส่ email + password
        Web->>API: POST /auth/login
        API->>API: ตรวจสอบกับ AUTH_EMAIL/PASSWORD ใน env
        API-->>Web: { token: JWT }
        Web->>Web: เก็บ token ใน localStorage
        Web->>User: redirect /overview
    else มี token
        Web->>API: GET /auth/me (Bearer token)
        API-->>Web: { email }
        Web->>User: แสดง dashboard
    end
```

---

## Project Structure

```
meshagent/
├── apps/
│   ├── web/                    # Next.js 14 PWA
│   │   ├── app/                # App Router pages
│   │   ├── components/         # React components
│   │   └── lib/                # API client, WebSocket hook, auth
│   └── api/                    # Fastify backend
│       └── src/
│           ├── plugins/        # DB, Redis plugins
│           ├── routes/         # auth, tasks, projects, agents, github
│           └── ws/             # WebSocket handler
├── packages/
│   ├── shared/                 # Types + Drizzle schema (shared)
│   └── orchestrator/           # Agent session manager
│       └── src/
│           ├── session.ts      # AgentSession (subprocess)
│           ├── manager.ts      # SessionManager
│           └── streamer.ts     # Redis pub/sub streamer
├── nginx/                      # Nginx config
├── scripts/                    # Deploy + setup scripts
├── docker-compose.yml          # Dev environment
├── docker-compose.prod.yml     # Production
└── docs/
    └── superpowers/
        ├── specs/              # Design spec
        └── plans/              # Implementation plans (1-5)
```

---

## Quick Start (Development)

### Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm@9`)
- Docker + Docker Compose
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

### Setup

```bash
# 1. Clone
git clone https://github.com/itseed/mesh-agent.git
cd mesh-agent

# 2. Install deps
pnpm install

# 3. Setup env
cp .env.example .env
# แก้ไข .env ใส่ค่าที่ต้องการ

# 4. Start Docker services (PostgreSQL + Redis)
docker compose up -d

# 5. Run migrations
cd packages/shared
DATABASE_URL=postgresql://meshagent:meshagent@localhost:5432/meshagent pnpm db:migrate
cd ../..

# 6. Start services
pnpm dev:api        # API server → http://localhost:3001
# terminal อื่น:
pnpm --filter web dev   # Web app → http://localhost:3000
# terminal อื่น:
pnpm --filter @meshagent/orchestrator dev  # Orchestrator → http://localhost:3002
```

เปิด [http://localhost:3000](http://localhost:3000) แล้ว login ด้วย `AUTH_EMAIL` และ `AUTH_PASSWORD` ที่ตั้งใน `.env`

---

## Deployment (DigitalOcean)

ดูรายละเอียดทั้งหมดได้ที่ [docs/superpowers/plans/2026-04-25-05-deployment.md](docs/superpowers/plans/2026-04-25-05-deployment.md)

### Quick deploy

```bash
# 1. Setup Droplet ใหม่ (รันบน Droplet)
bash <(curl -fsSL https://raw.githubusercontent.com/itseed/mesh-agent/main/scripts/setup-droplet.sh)

# 2. Deploy จาก local
DROPLET_HOST=your.droplet.ip bash scripts/deploy.sh
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓ | PostgreSQL connection URL |
| `REDIS_URL` | ✓ | Redis connection URL |
| `AUTH_EMAIL` | ✓ | Login email (single user) |
| `AUTH_PASSWORD` | ✓ | Login password |
| `JWT_SECRET` | ✓ | JWT signing secret (32+ chars) |
| `ANTHROPIC_API_KEY` | ✓ | สำหรับ Claude Code CLI |
| `GITHUB_TOKEN` | — | GitHub API access token |
| `GITHUB_WEBHOOK_SECRET` | — | GitHub webhook HMAC secret |
| `ORCHESTRATOR_URL` | — | Internal URL ของ orchestrator (default: http://localhost:3002) |

---

## Roadmap

- **v1** — Server-based platform (current)
- **v2** — Local Companion CLI (hybrid mode: agents รันบน local machine ผ่าน WebSocket)
