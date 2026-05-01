import { test, expect } from '@playwright/test'

// These smoke tests don't require the API or database — they assert that
// the static shell of the app renders. Add tests that hit the API to
// e2e/kanban.spec.ts (or similar) where the full stack is required.

test('login page renders email + password inputs', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByPlaceholder('Email')).toBeVisible()
  await expect(page.getByPlaceholder('Password')).toBeVisible()
})

test('unauthenticated kanban request redirects to login', async ({ page }) => {
  await page.goto('/kanban')
  await expect(page).toHaveURL(/\/login/)
})
