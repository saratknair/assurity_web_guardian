// Feature: dashboard-usability-overhaul, Property 62: Anything shown from outside the console is scrubbed
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { scrubForDisplay } from "../../src/admin/scrub.js";

const RUNS = { numRuns: 150 };
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const alnum = (min: number, max: number) =>
  fc.array(fc.constantFrom(...ALNUM.split("")), { minLength: min, maxLength: max }).map((a) => a.join(""));
// Lowercase letters only, 3..8 long: cannot collide with token or sha shapes.
const seg = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), { minLength: 3, maxLength: 8 })
  .map((a) => "q" + a.join(""));
const segs = fc.array(seg, { minLength: 1, maxLength: 4 });

const winPath = fc
  .tuple(fc.constantFrom("C", "D", "E"), segs)
  .map(([d, s]) => `${d}:\\${s.join("\\")}`);
const winFwdPath = fc
  .tuple(fc.constantFrom("C", "D"), segs)
  .map(([d, s]) => `${d}:/${s.join("/")}`);
const uncPath = fc.tuple(seg, seg, segs).map(([h, sh, s]) => `\\\\${h}\\${sh}\\${s.join("\\")}`);
const posixPath = fc
  .tuple(fc.constantFrom("/home", "/Users", "/etc", "/var", "/tmp", "/opt", "/root"), segs)
  .map(([r, s]) => `${r}/${s.join("/")}`);
const anyPath = fc.oneof(winPath, winFwdPath, uncPath, posixPath);

const tokenArb = fc.oneof(
  alnum(36, 40).map((t) => `ghp_${t}`),
  alnum(36, 40).map((t) => `gho_${t}`),
  alnum(36, 40).map((t) => `ghs_${t}`),
  alnum(30, 60).map((t) => `github_pat_${t}`),
  fc
    .array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")), { minLength: 16, maxLength: 16 })
    .map((a) => `AKIA${a.join("")}`),
);
const bearerArb = alnum(20, 40).map((t) => ({ header: `Authorization: Bearer ${t}`, secret: t }));
const credUrlArb = fc
  .tuple(fc.constantFrom("https", "http"), seg, alnum(12, 30), seg, seg)
  .map(([scheme, user, pass, host, path]) => ({
    text: `${scheme}://${user}:${pass}@${host}.example.com/${path}`,
    secret: `${user}:${pass}@`,
    pass,
  }));
const sha = fc
  .array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 40, maxLength: 40 })
  .map((a) => a.join(""));
const filler = fc.stringOf(fc.constantFrom(..."abcdefghij .,:;-".split("")), { maxLength: 20 });
const controlChars = fc.array(
  fc.constantFrom("\u0000", "\u0001", "\u0007", "\u0008", "\u000B", "\u000C", "\r", "\u001B", "\u001F", "\u007F"),
  { minLength: 1, maxLength: 6 },
);

describe("Property 62: Anything shown from outside the console is scrubbed", () => {
  it("Property 62: removes injected tokens, Bearer headers, and credential URLs", () => {
    // **Validates: Requirements 26.11, 29.6, 30.9**
    fc.assert(
      fc.property(tokenArb, bearerArb, credUrlArb, filler, (token, bearer, cred, pad) => {
        const text = `${pad} ${token} ${pad}\n${bearer.header}\nclone ${cred.text} ${pad}`;
        const out = scrubForDisplay(text);
        expect(out).not.toContain(token);
        expect(out).not.toContain(bearer.secret);
        expect(out).not.toContain(cred.secret);
        expect(out).not.toContain(cred.pass);
        expect(out).toContain("***@");
      }),
      RUNS,
    );
  });

  it("Property 62: removes Windows, UNC, and POSIX absolute paths", () => {
    // **Validates: Requirements 26.11, 29.6, 30.9**
    fc.assert(
      fc.property(anyPath, anyPath, filler, (p1, p2, pad) => {
        const text = `${pad} error at ${p1} and "${p2}" ${pad}`;
        const out = scrubForDisplay(text);
        expect(out).not.toContain(p1);
        expect(out).not.toContain(p2);
      }),
      RUNS,
    );
  });

  it("Property 62: replaces the project root and home directory", () => {
    // **Validates: Requirements 26.11, 29.6, 30.9**
    fc.assert(
      fc.property(segs, segs, segs, fc.boolean(), (a, b, rel, fwd) => {
        const home = `C:\\Users\\qh${a.join("")}`;
        const root = `D:\\work\\qr${b.join("")}`;
        const sep = fwd ? "/" : "\\";
        const asShown = (r: string) => (fwd ? r.replace(/\\/g, "/") : r);
        const text = `${asShown(root)}${sep}${rel.join(sep)} and ${asShown(home)}${sep}.cache`;
        const out = scrubForDisplay(text, { projectRoot: root, home });
        const lower = out.toLowerCase();
        for (const r of [root, home]) {
          expect(lower).not.toContain(r.toLowerCase());
          expect(lower).not.toContain(r.replace(/\\/g, "/").toLowerCase());
        }
        expect(out).toMatch(/^<project>/);
      }),
      RUNS,
    );
  });

  it("Property 62: drops control characters but keeps newlines and tabs", () => {
    // **Validates: Requirements 26.11, 29.6, 30.9**
    fc.assert(
      fc.property(filler, controlChars, filler, (a, ctrl, b) => {
        const out = scrubForDisplay(`${a}${ctrl.join("")}\n${b}\tx`);
        expect(CONTROL.test(out)).toBe(false);
        expect(out).toContain("\n");
        expect(out).toContain("\t");
      }),
      RUNS,
    );
  });

  it("Property 62: caps line length at 2000 characters", () => {
    // **Validates: Requirements 26.11, 29.6, 30.9**
    fc.assert(
      fc.property(fc.integer({ min: 2001, max: 6000 }), fc.integer({ min: 0, max: 3 }), (len, extra) => {
        const lines = [
          "x".repeat(len),
          ...Array.from({ length: extra }, (_v, i) => `short ${i}`),
        ];
        const out = scrubForDisplay(lines.join("\n"));
        for (const line of out.split("\n")) expect(line.length).toBeLessThanOrEqual(2000);
        expect(out.split("\n")).toHaveLength(lines.length);
      }),
      RUNS,
    );
  });

  it("Property 62: leaves 40-character commit SHAs intact", () => {
    // **Validates: Requirements 26.11, 29.6, 30.9**
    fc.assert(
      fc.property(sha, filler, (s, pad) => {
        const out = scrubForDisplay(`${pad} commit ${s} pushed ${pad}\n[main ${s}] done`);
        expect(out.split(s).length - 1).toBe(2);
      }),
      RUNS,
    );
  });

  it("Property 62: is idempotent on mixed secret-bearing text", () => {
    // **Validates: Requirements 26.11, 29.6, 30.9**
    fc.assert(
      fc.property(
        tokenArb,
        credUrlArb,
        anyPath,
        sha,
        controlChars,
        fc.integer({ min: 1, max: 3000 }),
        (token, cred, p, s, ctrl, n) => {
          const text = [token, cred.text, p, s, ctrl.join(""), "y".repeat(n), "Bearer abcdefghijklmnop"].join(" \n");
          const ctx = { projectRoot: "D:\\work\\proj", home: "C:\\Users\\someone" };
          const once = scrubForDisplay(text, ctx);
          expect(scrubForDisplay(once, ctx)).toBe(once);
        },
      ),
      RUNS,
    );
  });

  it("Property 62: never throws and is idempotent on arbitrary strings", () => {
    // **Validates: Requirements 26.11, 29.6, 30.9**
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.fullUnicodeString(), fc.string({ maxLength: 3000 })), (text) => {
        const once = scrubForDisplay(text);
        expect(typeof once).toBe("string");
        expect(CONTROL.test(once)).toBe(false);
        expect(scrubForDisplay(once)).toBe(once);
      }),
      RUNS,
    );
  });
});
