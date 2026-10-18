import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

import { SHARE_TARGET_PATH } from "@/lib/import/shared-file";
import { THEME_COLOR } from "@/lib/theme-color";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("common.manifest");
  return {
    name: t("name"),
    short_name: "franC",
    description: t("description"),
    start_url: "/",
    display: "standalone",
    // Always dark, so the splash never flashes white.
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    // Android / installed app: franC appears in the share sheet for CSV files (src/app/sw.ts).
    share_target: {
      action: SHARE_TARGET_PATH,
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: "file", accept: ["text/csv", ".csv"] }] },
    },
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
