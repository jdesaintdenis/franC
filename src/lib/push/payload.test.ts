import { describe, expect, it } from "vitest";

import { buildReminderPayload } from "./payload";

describe("buildReminderPayload", () => {
  it("is English by default and pluralizes the age", async () => {
    expect(await buildReminderPayload({ locale: null, ageDays: 18 })).toEqual({
      title: "Time to import",
      body: "Your bank data is 18 days old. Import your latest export.",
      url: "/import",
    });
    expect((await buildReminderPayload({ locale: "en", ageDays: 1 })).body).toContain("1 day old");
  });

  it("follows the saved French locale", async () => {
    const payload = await buildReminderPayload({ locale: "fr", ageDays: 1 });
    expect(payload.title).toBe("C'est l'heure d'importer");
    expect(payload.body).toContain("1 jour");
  });
});
