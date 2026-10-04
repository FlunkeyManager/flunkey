import { describe, expect, it } from "vitest";
import { resolveAppProfile } from "../appProfiles";

describe("foreground application profiles", () => {
  it("uses a supported web-app title rather than the browser's generic profile", () => {
    expect(
      resolveAppProfile("msedge.exe", "Microsoft Copilot - Chat"),
    ).toMatchObject({ id: "copilot" });
    expect(resolveAppProfile("chrome.exe", "ChatGPT")).toMatchObject({
      id: "chatgpt",
    });
  });

  it("keeps the browser profile for unrelated tabs", () => {
    expect(resolveAppProfile("msedge.exe", "Flunkey documentation")).toMatchObject({
      id: "edge",
    });
  });

  it("does not let a browser-like title override a native application", () => {
    expect(resolveAppProfile("Code.exe", "Copilot Chat")).toMatchObject({
      id: "vscode",
    });
  });
});
