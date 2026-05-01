import { test, expect } from '@playwright/test';

// Drawer regression tests — covers the scroll/portal behavior fixed in
// commits c747f4f, 9eeb391, 488b082, etc. Requires the API, orchestrator,
// Postgres, Redis, and at least one seeded task to be reachable.
//
// Skipped by default (no seeded data in CI yet). Run locally with
//   E2E_BASE_URL=http://localhost:3000 pnpm e2e drawer.spec.ts
// after `docker compose up` and seeding via `pnpm --filter api seed`.
test.describe.skip('TaskDetailPanel drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(process.env.E2E_USER ?? 'admin@example.com');
    await page.getByPlaceholder('Password').fill(process.env.E2E_PASSWORD ?? 'changeme123');
    await page.getByRole('button', { name: /sign in|login/i }).click();
    await page.waitForURL(/\/(kanban|overview)/);
    await page.goto('/kanban');
  });

  test('opens drawer when a task card is clicked', async ({ page }) => {
    const firstCard = page.locator('[data-task-id]').first();
    await firstCard.click();
    await expect(page.locator('[data-drawer-scroll]')).toBeVisible();
  });

  test('drawer scroll does not bleed to page', async ({ page }) => {
    await page.locator('[data-task-id]').first().click();
    const drawer = page.locator('[data-drawer-scroll]');
    await drawer.waitFor();

    const initialPageScroll = await page.evaluate(() => window.scrollY);
    await drawer.hover();
    await page.mouse.wheel(0, 400);

    // Page should not have scrolled; only the drawer content moved.
    expect(await page.evaluate(() => window.scrollY)).toBe(initialPageScroll);
    const drawerScrollTop = await drawer.evaluate((el) => (el as HTMLElement).scrollTop);
    expect(drawerScrollTop).toBeGreaterThan(0);
  });

  test('Escape closes the drawer', async ({ page }) => {
    await page.locator('[data-task-id]').first().click();
    await expect(page.locator('[data-drawer-scroll]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-drawer-scroll]')).toHaveCount(0);
  });
});
