import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { proxy: mode === 'studio' ? undefined : { '/api': 'http://127.0.0.1:8000' } },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.mjs', 'design-kit/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
}))
