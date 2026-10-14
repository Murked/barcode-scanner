import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const FIXTURE = 'test/fixtures/ean13.y4m';
// Chromium needs the fake-camera file at launch time; generate it on first run.
if (!existsSync(FIXTURE)) execFileSync(process.execPath, ['scripts/make-fixture.mjs'], { stdio: 'inherit' });

const PORT = 4173;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${FIXTURE}`,
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: `http://localhost:${PORT}/examples/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
