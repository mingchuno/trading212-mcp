import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function lint(title) {
  return spawnSync(process.execPath, ["scripts/lint-pr-title.mjs"], {
    env: { ...process.env, PR_TITLE: title },
    encoding: "utf8",
  });
}

describe("release commit intent", () => {
  it.each([
    "fix(client): handle retries",
    "feat(mcp)!: change tool arguments",
    "chore: release main",
  ])("accepts %s", (title) => {
    expect(lint(title).status).toBe(0);
  });
  it.each(["update stuff", "fix: ", "feat: first\nfix: second"])(
    "rejects %s",
    (title) => {
      expect(lint(title).status).toBe(1);
    },
  );
});
