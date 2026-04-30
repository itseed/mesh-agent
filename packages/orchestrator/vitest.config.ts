import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
  cacheDir: '/tmp/vitest-cache-orchestrator',
})
