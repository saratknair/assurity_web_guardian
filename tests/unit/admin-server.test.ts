import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startAdminServer } from "../../src/admin/admin-server.js";
import type { RouteDef } from "../../src/admin/console-routes.js";

let server: Server;
let port = 0;

function send(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string; host?: string } = {},
): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
  return new Promise((res, rej) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: { host: opts.host ?? `127.0.0.1:${port}`, ...(opts.headers ?? {}) },
      },
      (r) => {
        let text = "";
        r.on("data", (c) => (text += c));
        r.on("end", () => res({ status: r.statusCode ?? 0, headers: r.headers, text }));
      },
    );
    req.on("error", rej);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const echo: RouteDef = {
  method: "POST",
  pattern: "/api/echo",
  mutating: true,
  maxBodyBytes: 16,
  handler: async (ctx) => ({ status: 200, json: ctx.body }),
};

beforeAll(async () => {
  server = startAdminServer({ port: 0, routes: [echo] });
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(() => r(null)));
});

describe("admin-server adapter", () => {
  it("binds to 127.0.0.1 only", () => {
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
  });

  it("serves / with security headers and CSP, no CORS", async () => {
    const r = await send("GET", "/");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(String(r.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
    expect(Object.keys(r.headers).some((k) => k.startsWith("access-control-"))).toBe(false);
  });

  it("rejects a foreign Host on GET", async () => {
    expect((await send("GET", "/", { host: "evil.example" })).status).toBe(403);
  });

  it("404s non-whitelisted assets and unknown section names", async () => {
    expect((await send("GET", "/assets/sections/nope.js")).status).toBe(404);
    expect((await send("GET", "/assets/../package.json")).status).toBe(404);
  });

  it("rejects unguarded POST with 403", async () => {
    expect((await send("POST", "/api/echo", { body: "{}" })).status).toBe(403);
  });

  it("accepts a guarded POST and enforces the body ceiling", async () => {
    const headers = {
      "content-type": "application/json",
      origin: `http://127.0.0.1:${port}`,
    };
    const ok = await send("POST", "/api/echo", { headers, body: '{"a":1}' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toEqual({ a: 1 });
    const big = await send("POST", "/api/echo", { headers, body: JSON.stringify({ a: "x".repeat(64) }) });
    expect(big.status).toBe(413);
  });
});
