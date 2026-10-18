import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withActionErrorState, withActionErrors } from "./safe-action";

afterEach(() => vi.restoreAllMocks());

describe("withActionErrors", () => {
  it("passes through the resolved value", async () => {
    await expect(withActionErrors("Nope", async () => ({ status: "done" as const }))).resolves.toEqual({
      status: "done",
    });
  });

  it("returns the fixed message instead of the thrown error's message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await withActionErrors("Could not import.", async () => {
      throw new Error("Failed query: insert ... params: Boulangerie Dupont,-1234");
    });
    expect(result).toEqual({ status: "error", error: "Could not import." });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Boulangerie");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("1234");
    expect(spy.mock.calls[0][0]).toBe("Could not import.");
  });

  it("rethrows Next redirect errors", async () => {
    await expect(
      withActionErrors("Nope", async () => {
        redirect("/login");
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("withActionErrorState", () => {
  it("returns the supplied state shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await withActionErrorState(
      "Auth failed",
      async () => {
        throw new Error("boom");
      },
      { error: "Something went wrong. Try again." },
    );
    expect(result).toEqual({ error: "Something went wrong. Try again." });
  });
});
