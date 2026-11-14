import { describe, it, expect } from "vitest";
import { browserCommand } from "../../src/admin/open-routes.js";
import { killPlan } from "../../src/admin/job-runner.js";

const URL_OK = "http://127.0.0.1:7787/local-dashboard/";

describe("browserCommand", () => {
  it("uses rundll32 on win32, with the URL as a single argument and no cmd", () => {
    expect(browserCommand("win32", URL_OK)).toEqual({ cmd: "rundll32", args: ["url.dll,FileProtocolHandler", URL_OK] });
  });

  it("uses open on darwin and xdg-open elsewhere", () => {
    expect(browserCommand("darwin", URL_OK)).toEqual({ cmd: "open", args: [URL_OK] });
    expect(browserCommand("linux", URL_OK)).toEqual({ cmd: "xdg-open", args: [URL_OK] });
  });

  it("rejects anything that is not a plain loopback http URL", () => {
    const bad = [
      "http://127.0.0.1:7787/a&calc",
      "http://127.0.0.1:7787/a^b",
      "http://127.0.0.1:7787/a b",
      "http://example.com/",
      "file:///C:/x.html",
      "https://127.0.0.1:7787/",
      "http://127.0.0.1/",
      "",
    ];
    for (const u of bad) expect(browserCommand("win32", u)).toBeNull();
  });
});

describe("killPlan", () => {
  it("runs taskkill with an args array on win32, killing the tree", () => {
    expect(killPlan("win32", 42)).toEqual({ kind: "taskkill", cmd: "taskkill", args: ["/pid", "42", "/T", "/F"] });
  });

  it("signals the process group (negative pid) on POSIX", () => {
    expect(killPlan("linux", 42)).toEqual({ kind: "group", pid: -42, signal: "SIGKILL" });
    expect(killPlan("darwin", 7)).toEqual({ kind: "group", pid: -7, signal: "SIGKILL" });
  });
});
