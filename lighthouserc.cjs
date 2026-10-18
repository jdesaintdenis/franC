// Lighthouse CI config. Only public pages are audited (authenticated pages are
// covered by axe checks in e2e/a11y.spec.ts). Reports stay on the filesystem;
// never upload to temporary-public-storage.
module.exports = {
  ci: {
    collect: {
      startServerCommand: "pnpm start",
      startServerReadyPattern: "Ready in",
      startServerReadyTimeout: 60000,
      url: ["http://localhost:3000/login", "http://localhost:3000/offline"],
      numberOfRuns: 1,
      settings: {
        chromeFlags: "--headless=new --no-sandbox",
      },
      ...(process.env.CHROME_PATH ? { chromePath: process.env.CHROME_PATH } : {}),
    },
    assert: {
      assertions: {
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:performance": ["warn", { minScore: 0.8 }],
        "categories:seo": "off",
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
