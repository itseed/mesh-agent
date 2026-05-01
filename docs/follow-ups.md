# Follow-up Tasks

ต่อยอดจาก code/workflow review ที่ทำไปใน branch `claude/review-code-workflow-FUDbo`
(commits `a095b4a`, `328a9eb`, `6af275a`, `87bd875`)

จัดเรียงตามลำดับความสำคัญ + effort

---

## P0 — แก้ก่อน เพราะกระทบ DX/CI ทุกวัน

### 1. แก้ 26 api tests ที่ fail บน local
**ไฟล์:** `apps/api/src/__tests__/*.test.ts`

**สาเหตุ:** test setup hard-code `localhost:4803/4804` (ดู `apps/api/src/__tests__/setup.ts:1-2`)
ทำให้รันได้เฉพาะตอนมี Postgres/Redis ขึ้นแล้ว

**ตัวเลือก:**
- (A) เพิ่ม `docker compose -f docker-compose.test.yml` แล้วเขียน script `pnpm test:up` /
  `pnpm test:down` ที่ start/stop service เฉพาะ test
- (B) ใช้ `testcontainers` (npm: `@testcontainers/postgresql`, `@testcontainers/redis`)
  ให้ test spin up containers อัตโนมัติ — slow แต่ไม่ต้องจำคำสั่ง
- (C) Mock `fastify.db` ทั้งหมด (เปลี่ยนเยอะ, fragile)

**แนะนำ:** A สำหรับเริ่ม + เพิ่ม wait-for-it loop ใน `beforeAll`

**Effort:** 2–3 ชม. | **Risk:** ต่ำ (test infra เท่านั้น)

---

### 2. Format pass ทั้ง repo
**ทำไม:** Prettier config เพิ่งเพิ่ม → ไฟล์เก่ายังไม่ตรงมาตรฐาน → CI `format:check` ใช้
`continue-on-error: true` อยู่ ปลดล็อกทีหลังจาก format ครบ

**คำสั่ง:**
```bash
pnpm format                           # auto-fix ทุกไฟล์
git commit -am "style: prettier pass"  # commit แยก ห้าม mix กับ feature
```

จากนั้นใน `.github/workflows/ci.yml` ลบ `continue-on-error: true` ออกจากขั้น Format check

**Effort:** 15 นาที | **Risk:** ต่ำมาก (whitespace/quote-style เท่านั้น) แต่ diff ใหญ่ —
แนะนำเพิ่ม commit hash ลง `.git-blame-ignore-revs` หลัง commit เสร็จ

```bash
echo "<commit-sha>" >> .git-blame-ignore-revs
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

---

### 3. แก้ ESLint warnings 8 จุด
ตอนนี้ `next lint` exit 0 แต่มี warnings:

| ไฟล์ | บรรทัด | Rule | แก้ยังไง |
|---|---|---|---|
| `app/login/page.tsx` | 35, 46 | `no-img-element` | เปลี่ยนเป็น `<Image>` จาก `next/image` |
| `app/settings/page.tsx` | 289 | `no-img-element` | เหมือนกัน |
| `components/layout/{CommandBar,Sidebar,TopNav}.tsx` | 513/75/17 | `no-img-element` | เหมือนกัน |
| `app/projects/page.tsx` | 585 | `react-hooks/exhaustive-deps` | เพิ่ม `cBranch` ลงใน deps array หรือ `// eslint-disable-next-line` พร้อมเหตุผล |
| `components/agents/AgentRolePanel.tsx` | 77 | `react-hooks/exhaustive-deps` | เพิ่ม `dispatchProject` |
| `components/kanban/KanbanBoard.tsx` | 27 | `react-hooks/exhaustive-deps` | เพิ่ม `selectedTask` หรือ refactor |

**ระวัง:** การเพิ่ม dep บางตัวอาจทำให้ effect รัน loop ได้ — ตรวจดูทุกจุดว่าเอาเข้าหรือ
`useCallback`/`useMemo` ก่อน

หลังแก้ครบ: เปลี่ยน rule เป็น `error` ใน `apps/web/.eslintrc.json` เพื่อกัน regression

**Effort:** 1–2 ชม. | **Risk:** ปานกลาง (อาจเจอ effect loop)

---

## P1 — Quality of Life

### 4. Wire E2E เข้า CI
**ไฟล์:** `.github/workflows/ci.yml` (เพิ่ม job `e2e`)

ต้องการ:
- Services: postgres, redis (มีแล้วใน `test` job — copy มา)
- Run: `pnpm --filter api start &`, `pnpm --filter @meshagent/orchestrator start &`,
  รอ ready
- Run: `pnpm --filter web build && pnpm --filter web start &`, รอ port 3000
- Seed: `pnpm --filter api seed`
- Run: `pnpm --filter web e2e:install && E2E_NO_SERVER=1 pnpm --filter web e2e`
- Upload: `playwright-report/` artifact ถ้า fail

**ก่อนทำ ต้อง:**
- Unskip `e2e/drawer.spec.ts` (`describe.skip` → `describe`) หลังมี seed data
- เพิ่ม `data-task-id` attribute ลงใน `TaskCard.tsx` (ตอนนี้ E2E เลือกผ่าน
  selector นี้ — ต้องเช็คว่ามีจริงไหม)

**Effort:** 3–4 ชม. | **Risk:** ปานกลาง (CI infra debugging)

---

### 5. Seed data สำหรับ E2E
**ไฟล์:** `apps/api/src/seed.ts` (มีอยู่แล้ว — seed projects/roles)

ต้องเพิ่ม:
- Admin user (ถูก seed ผ่าน `ensureSeedUser` ตอน boot อยู่แล้ว — OK)
- Sample tasks ใน stages ต่างๆ (backlog, in_progress, review, done) +
  สำหรับ done ต้องมี agent comment ที่มี review issues เพื่อ test FixIssuesPanel
- Subtasks อย่างน้อย 1 task ที่มี subtask 2-3 ตัว

แนะนำแยกเป็น `apps/api/src/seed-e2e.ts` ที่เรียกผ่าน
`pnpm --filter api seed:e2e` เพื่อไม่ปนกับ dev seed

**Effort:** 1–2 ชม. | **Risk:** ต่ำ

---

### 6. Refactor large files ที่เหลือ
ตามที่ review รายงานไว้:

| ไฟล์ | บรรทัด | แนวทาง |
|---|---|---|
| `apps/web/components/layout/CommandBar.tsx` | 920 | แตก commands ออกเป็น registry pattern, แยก keyboard handler |
| `apps/web/app/projects/page.tsx` | 929 | แตก ProjectForm, ProjectList, LocalPathBrowser |
| `apps/web/app/settings/page.tsx` | 825 | แตก ตาม tab (Profile, GitHub, CLI) |
| `apps/api/src/routes/internal.ts` | 818 | แยก agent-complete handler, status sync helper |
| `apps/api/src/routes/tasks.ts` | 677 | แยก wave dispatch logic เป็น `lib/dispatch-waves.ts` |

ใช้ pattern เดียวกับ TaskDetailPanel (commit `328a9eb`):
1. แยก constants/utils ก่อน (pure)
2. แยก leaf components
3. ปล่อย parent ทำหน้าที่ orchestrate state เท่านั้น

**Effort:** 1–2 วัน รวม | **Risk:** ปานกลาง (ต้องระวัง prop drilling)

---

### 7. Type safety pass
ตอนนี้มี `any` / `@ts-ignore` ~315 จุด ส่วนใหญ่อยู่ใน test files (mock fetch) แต่ใน prod
มี ~10+ จุดควรแก้ก่อน:

```bash
# หา candidates ใน prod code
rg "as any|: any" apps/api/src apps/web/components apps/web/app \
  --glob '!**/*.test.*' -n
```

ที่เห็นชัด:
- `apps/api/src/lib/lead.ts:14` — `(body as any).error`
- `apps/web/components/kanban/TaskDetailPanel.tsx` — `task: any, allTasks: any[]`
  ควรกำหนด `Task` type จาก `@meshagent/shared`

แนะนำแก้ทีละไฟล์, commit แยก

**Effort:** 4–6 ชม. | **Risk:** ปานกลาง (อาจเจอ runtime mismatch ที่ซ่อนอยู่)

---

## P2 — Hardening

### 8. ปรับ scripts/deploy.sh
**ไฟล์:** `scripts/deploy.sh`

เพิ่ม:
- Pre-flight check: `[ -z "$DOMAIN" ] && exit 1`, ตรวจ `DATABASE_URL` มี
- `rsync --checksum` แทน mtime comparison (กัน clock skew)
- Atomic deploy: deploy ไปที่ `releases/<sha>/` แล้ว symlink `current → <sha>`
  เพื่อให้ rollback ง่าย
- หรือเปลี่ยนเป็น git-based deploy (`git pull && docker compose up -d --build`)

**Effort:** 2–3 ชม. | **Risk:** สูง (deploy script — ต้อง test บน staging ก่อน)

---

### 9. Integration tests สำหรับ WebSocket pub/sub
ตอนนี้ orchestrator → Redis → API → WS → Browser ไม่มี end-to-end test
ที่ครอบคลุม path นี้ — เป็น critical path ของ live agent output

แนวทาง:
- ใช้ Vitest + ioredis-mock หรือ embedded Redis
- Spin up minimal API server ใน test, subscribe WS, publish ผ่าน Redis,
  assert message received

**Effort:** 4–6 ชม. | **Risk:** ปานกลาง

---

### 10. เพิ่ม unit tests ที่ extracted utility อื่นๆ
ตอนนี้มีแค่ `parseReviewIssues` + `filterNoise` (commit `6af275a`)

ที่ extract แล้วและน่า test:
- `apps/web/components/kanban/task-detail/Markdown.tsx` — render markdown
  (snapshot test ผ่าน @testing-library)
- `apps/web/components/kanban/task-detail/FixIssuesPanel.tsx` — interaction test
  (toggle, select all, confirm callback)
- `apps/api/src/lib/*` — มี helper หลายตัวยังไม่มี test

**Effort:** ครึ่งวัน | **Risk:** ต่ำ

---

## P3 — Nice to have

### 11. Docker prod orchestrator ไม่รัน root
**ไฟล์:** `packages/orchestrator/Dockerfile`

ตรวจดูว่า claude/gemini/cursor CLI จำเป็นต้อง root จริงไหม — ถ้าไม่
ใช้ `USER node` (built-in user ของ official Node image) จะปลอดภัยกว่า

**Effort:** 1 ชม. (รวม test) | **Risk:** ปานกลาง (อาจเจอ permission ใน volumes)

---

### 12. แก้ regex `parseReviewIssues` ให้แม่นกว่าเดิม
ระหว่างเขียน test เจอ behavior ที่อาจไม่ตั้งใจ:
regex `[^\`*\n]{3,80}` มี `\s*` นำหน้า → backtrack ให้ char class ดูดสเปซเข้ามา
ทำให้ minimum trimmed title length กลายเป็น 2 chars ไม่ใช่ 3

ถ้าเจตนาคือ min 3 ควรเปลี่ยนเป็น `\s+` (บังคับมีสเปซอย่างน้อย 1) หรือ
`\s*\`?\s*([^\`*\n]{3,80})\`?` แล้วเพิ่ม trim หลัง regex

ดู test case `'ignores numbered items whose trimmed title is too short'`
ใน `apps/web/test/task-detail-utils.test.ts` ที่ document พฤติกรรมปัจจุบันไว้

**Effort:** 30 นาที | **Risk:** ต่ำ (มี test กันแล้ว)

---

### 13. Magic strings → enums
Role slugs (`frontend`, `backend`, `mobile`, …) hardcode ใน
`apps/web/components/kanban/task-detail/styles.ts:13` และอีกหลายที่

ย้ายไป `packages/shared/src/types.ts` เป็น const + type:
```ts
export const AGENT_ROLES = ['frontend', 'backend', 'mobile', 'devops',
  'designer', 'qa', 'reviewer'] as const
export type AgentRole = typeof AGENT_ROLES[number]
```

**Effort:** 1 ชม. | **Risk:** ต่ำ (compile-time check)

---

## ของในมือ ตอนนี้ (สิ่งที่ทำไปแล้ว)

- ✅ CI workflow (typecheck, lint, build, test กับ Postgres/Redis services)
- ✅ Prettier + .editorconfig + husky pre-push (typecheck)
- ✅ ESLint (next preset, lenient config)
- ✅ TaskDetailPanel refactor: 1136 → 418 lines + 11 sub-components
- ✅ 18 unit tests สำหรับ extracted utils
- ✅ Playwright scaffold: 2 smoke tests + 3 drawer tests (skipped รอ seed)

อยู่บน branch `claude/review-code-workflow-FUDbo` — ยังไม่เปิด PR
