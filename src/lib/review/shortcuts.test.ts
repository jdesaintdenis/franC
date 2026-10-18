import { describe, expect, it } from "vitest";

import { isTypingTarget, shortcutFor, SHORTCUT_HELP } from "./shortcuts";

const body = { tagName: "BODY" };
const open = { dialogOpen: false };

describe("shortcutFor", () => {
  it.each([
    ["j", "next"],
    ["ArrowDown", "next"],
    ["k", "previous"],
    ["ArrowUp", "previous"],
    ["r", "reviewed"],
    ["R", "reviewed"],
    ["Enter", "reviewed"],
    ["a", "accept"],
    ["A", "accept"],
    ["c", "category"],
    ["s", "split"],
    ["t", "transfer"],
    ["n", "rename"],
    ["x", "toggleSelect"],
    ["u", "undo"],
    ["?", "help"],
  ] as const)("maps %s to %s", (key, action) => {
    expect(shortcutFor({ key }, body, open)).toBe(action);
  });

  it("returns null for other keys", () => {
    expect(shortcutFor({ key: "z" }, body, open)).toBeNull();
    expect(shortcutFor({ key: " " }, body, open)).toBeNull();
  });

  it.each(["INPUT", "SELECT", "TEXTAREA", "input"])("ignores keys while focus is in %s", (tagName) => {
    expect(shortcutFor({ key: "j" }, { tagName }, open)).toBeNull();
    expect(shortcutFor({ key: "Enter" }, { tagName }, open)).toBeNull();
  });

  it("ignores keys in contenteditable elements", () => {
    expect(shortcutFor({ key: "r" }, { tagName: "DIV", isContentEditable: true }, open)).toBeNull();
  });

  it("ignores every key while a dialog is open", () => {
    expect(shortcutFor({ key: "j" }, body, { dialogOpen: true })).toBeNull();
    expect(shortcutFor({ key: "?" }, body, { dialogOpen: true })).toBeNull();
  });

  it("leaves browser shortcuts alone", () => {
    expect(shortcutFor({ key: "r", ctrlKey: true }, body, open)).toBeNull();
    expect(shortcutFor({ key: "r", metaKey: true }, body, open)).toBeNull();
    expect(shortcutFor({ key: "n", altKey: true }, body, open)).toBeNull();
  });

  it("does not treat Enter on a button or link as reviewed, but letters still work there", () => {
    expect(shortcutFor({ key: "Enter" }, { tagName: "BUTTON" }, open)).toBeNull();
    expect(shortcutFor({ key: "Enter" }, { tagName: "A" }, open)).toBeNull();
    expect(shortcutFor({ key: "r" }, { tagName: "BUTTON" }, open)).toBe("reviewed");
  });

  it("repeats navigation but not marking", () => {
    expect(shortcutFor({ key: "j", repeat: true }, body, open)).toBe("next");
    expect(shortcutFor({ key: "r", repeat: true }, body, open)).toBeNull();
  });

  it("works without a focused element", () => {
    expect(shortcutFor({ key: "j" }, null, open)).toBe("next");
  });
});

describe("isTypingTarget", () => {
  it("is false for missing targets and plain elements", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
  });
});

describe("SHORTCUT_HELP", () => {
  it("lists each action once", () => {
    const actions = SHORTCUT_HELP.map((h) => h.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
