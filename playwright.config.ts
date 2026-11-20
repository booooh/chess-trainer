import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build (`vite preview`), which is what the
// phone actually loads, including the service worker and manifest.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    // Optional: use an already-installed Chromium instead of Playwright's download.
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH },
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
