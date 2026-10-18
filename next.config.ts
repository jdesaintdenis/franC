import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Serwist's webpack plugin doesn't support Turbopack yet. It's disabled in
  // dev (see below), so Turbopack dev stays fast; production builds run
  // with `next build --webpack` (see package.json) so the service worker
  // actually gets generated. This empty block just tells Next.js the
  // webpack config below is intentional.
  turbopack: {},
  // The dev badge sits in a corner, over the bottom bar's Home tab or a page header's back
  // arrow or action, and catches taps there. Compile and runtime errors still show.
  devIndicators: false,
  experimental: {
    // CSV uploads go through server actions. The 1 MB default is too small
    // for a multi-year export; uploads are capped at 2 MB in the action, and
    // 4 MB here leaves multipart overhead room while staying under Vercel's
    // 4.5 MB request cap.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "development"),
      },
    ];
  },
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // /offline is static and user-independent; precaching it makes the document
  // fallback in sw.ts work. The revision changes per build so it refreshes.
  additionalPrecacheEntries: [
    { url: "/offline", revision: process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID() },
  ],
  disable: process.env.NODE_ENV === "development",
});

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(withSerwist(nextConfig));
