# Design: Overview Page — Provider Breakdown Card

**Date:** 2026-04-28
**Status:** Approved

## Problem

Overview page แสดง per-role breakdown แล้ว แต่ไม่มีข้อมูลว่า agent แต่ละตัวใช้ CLI provider ไหน (claude/gemini/cursor) ทั้งที่ `cliProvider` field มีใน `agentSessions` DB อยู่แล้ว

## Goal

เพิ่ม Provider Breakdown card ใหม่ใต้ AI Activity Card ในหน้า overview — แสดง sessions, success rate, และ avg duration แยกต่อ provider

## API

### `GET /agents/metrics/by-provider?sinceHours=24`

**Query params:** `sinceHours` (int, 1-720, default 24)

**Logic:** Query `agentSessions` grouped by `cliProvider`. Sessions ที่ `cliProvider IS NULL` นับรวมเป็น `"claude"` (default CLI)

**Response:**
```json
{
  "sinceHours": 24,
  "perProvider": [
    { "provider": "claude",  "count": 12, "successCount": 10, "avgDurationMs": 270000 },
    { "provider": "gemini",  "count": 3,  "successCount": 3,  "avgDurationMs": 180000 },
    { "provider": "cursor",  "count": 1,  "successCount": 0,  "avgDurationMs": 0 }
  ]
}
```

Only providers with `count > 0` are included.

## UI

**File:** `apps/web/components/overview/ProviderBreakdownCard.tsx`

Card ใหม่วางใต้ AI Activity Card ในหน้า `apps/web/app/overview/page.tsx`

Layout:
```
┌─────────────────────────────────────────────┐
│  Provider Breakdown  (last 24 hours)        │
│                                             │
│  Claude    ████████░░  12 sessions          │
│            83% success · avg 4m 30s         │
│                                             │
│  Gemini    ███░░░░░░░   3 sessions          │
│            100% success · avg 3m 0s         │
│                                             │
│  Cursor    █░░░░░░░░░   1 session           │
│            0% success · avg 0s              │
└─────────────────────────────────────────────┘
```

- Progress bar width = (provider.count / total.count) * 100%
- Success rate = (successCount / count) * 100%, rounded to nearest int
- Avg duration formatted as "Xm Ys" (e.g. "4m 30s"), "0s" if zero
- Uses same `sinceHours` value already used by overview page
- Empty state: "No agent sessions in the last 24 hours" when perProvider is empty

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/routes/agents.ts` | Add `GET /agents/metrics/by-provider` endpoint |
| `apps/web/lib/api.ts` | Add `agents.metricsByProvider(sinceHours)` method |
| `apps/web/components/overview/ProviderBreakdownCard.tsx` | New card component |
| `apps/web/app/overview/page.tsx` | Import + render ProviderBreakdownCard below AI Activity |

## Error Handling

| Scenario | Behavior |
|---|---|
| API error / fetch fail | Card shows "Unable to load provider data" |
| `cliProvider IS NULL` in DB | Counted as `"claude"` |
| Provider with 0 sessions | Excluded from response |
| Invalid `sinceHours` | Zod 400 — frontend always uses default 24 |
