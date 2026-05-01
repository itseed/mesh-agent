# MeshAgent Platform — Design Spec

**Date:** 2026-04-25
**Status:** Draft

## Overview

MeshAgent เป็น web platform สำหรับ orchestrate AI dev team agents ที่รันบน DigitalOcean Droplet เข้าถึงได้จากทุกที่ผ่าน browser (รวมถึง mobile และ iPad) มี Kanban board, real-time agent monitoring, และ GitHub integration

ย้ายจาก local CLI + tmux setup (agent-teams) ไปเป็น server-based platform ที่ไม่ต้องเปิด local machine ทิ้งไว้

---

## Architecture

**Approach:** Backend + Frontend แยกกัน ทุก service รันใน Docker Compose บน Droplet เดียว

### Services

| Service          | Tech              | หน้าที่                                            |
| ---------------- | ----------------- | -------------------------------------------------- |
| **web**          | Next.js (PWA)     | Frontend — Kanban, agent monitoring, command input |
| **api**          | Node.js + Fastify | REST API, WebSocket, GitHub webhook handler, auth  |
| **orchestrator** | Node.js           | จัดการ Claude Code CLI agent sessions, task queue  |
| **db**           | PostgreSQL        | tasks, projects, Kanban state, GitHub data         |
| **cache**        | Redis             | real-time pub/sub, job queue, session              |
| **proxy**        | Nginx             | HTTPS (Let's Encrypt), reverse proxy               |

### Monorepo Structure

```
meshagent/
├── apps/
│   ├── web/          ← Next.js frontend (PWA)
│   └── api/          ← Fastify backend
├── packages/
│   ├── orchestrator/ ← Agent orchestration service
│   └── shared/       ← Shared types, utils, schemas
├── docker-compose.yml
└── package.json      ← workspace root (pnpm workspaces)
```

### Data Flow

```
Mobile/iPad → HTTPS → Nginx → web (Next.js)
                           → api (Fastify) ← WebSocket → web
                                          ← GitHub webhooks
                                          → orchestrator → Claude Code CLI
                                          → PostgreSQL
                                          → Redis (pub/sub)
```

---

## Features

### 1. Kanban Board

- Stages: **Backlog → In Progress → Review → Done**
- แต่ละ card แสดง: task title, assigned agent, project, GitHub PR link (ถ้ามี)
- Drag-and-drop ย้าย stage ได้
- สร้าง task ใหม่จาก board ได้เลย

### 2. Agent Monitoring (Dedicated Page)

- เห็นทุก agent พร้อมกันในหน้าเดียว
- แต่ละ agent card แสดง: role, status (running/idle), current task, live output (streaming via WebSocket)
- คลิก agent card → ดู full output ในหน้าต่างใหญ่ขึ้น
- สถานะ: `running` (สีเขียว), `idle` (สีเทา), `error` (สีแดง)

### 3. Command Input

**Quick bar** — ติดด้านล่างทุกหน้า

- dropdown เลือก agent
- text field พิมพ์ prompt
- ส่งได้เลยโดยไม่ต้องเปลี่ยนหน้า

**Modal** — กด expand หรือ "New Task" button

- เลือก agent + project
- text area ขนาดใหญ่ พิมพ์ prompt ยาวได้
- แนบ GitHub issue/PR URL เป็น context ได้ — ระบบดึง title + body มาใส่ใน prompt อัตโนมัติ

### 4. GitHub Integration

**Overview Widget**

- จำนวน PRs open / needs review
- จำนวน commits วันนี้
- Recent activity feed

**GitHub Tab (full page)**

- PRs — list พร้อม status, สร้าง PR จาก platform ได้
- Commits — history per project
- Issues — list, สามารถ trigger agent จาก issue ได้

**Webhooks (inbound)**

- PR opened/merged → อัปเดต Kanban card
- Issue created → แจ้ง Lead, option trigger agent
- Push event → อัปเดต commit feed

### 5. Projects

- จัดการ projects (แทน projects.json ปัจจุบัน)
- แต่ละ project มี: name, paths (web/api/mobile/etc.), linked GitHub repos
- เลือก active project → Kanban และ agents filter ตาม project

### 6. Authentication

- Single-user: JWT-based auth
- Login ด้วย email + password (ตั้งค่าตอน setup)
- Session คงอยู่ 30 วัน (refresh token)

---

## UI / UX

- **Layout:** Top Nav + Full Canvas (mobile-first)
- **Theme:** Dark mode (เหมือน terminal/GitHub dark)
- **PWA:** installable บน iOS/Android, ใช้งาน offline ได้บางส่วน
- **Navigation tabs:** Overview · Kanban · Agents · GitHub · Projects

---

## Infrastructure

- **Host:** DigitalOcean Droplet (Ubuntu 22.04)
- **Deployment:** Docker Compose
- **HTTPS:** Let's Encrypt via Nginx
- **Domain:** ตั้งค่าตอน deploy (custom domain หรือ IP)

---

## Agent Orchestration

แทนที่ tmux local ด้วย orchestrator service ที่:

- รัน Claude Code CLI ใน subprocess ต่อ agent session
- Stream stdout/stderr → Redis pub/sub → WebSocket → frontend
- รองรับ agent definitions จาก `.claude/agents/` เหมือนเดิม
- Inject working directory ตาม project config
- ต้องการ `ANTHROPIC_API_KEY` ตั้งค่าบน Droplet ผ่าน environment variable (`.env` file)

---

## Out of Scope (v1)

- Multi-user / team access
- Native mobile app (ใช้ PWA แทน)
- Self-healing / auto-restart agent sessions
- Cost tracking per agent session
