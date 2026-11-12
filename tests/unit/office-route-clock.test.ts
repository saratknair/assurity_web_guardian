import { describe, it, expect } from "vitest";
// @ts-expect-error plain browser ES module without type declarations
import { parseOfficeRoute, formatOfficeRoute, clampT } from "../../office/lib/route.js";
// @ts-expect-error plain browser ES module without type declarations
import { SPEEDS, createClockState, advance, seek, play, pause, setSpeed } from "../../office/lib/clock.js";

describe("office route", () => {
  it("round-trips run, t and station", () => {
    const h = formatOfficeRoute({ runId: "2025-01-01T00-00-00Z", t: 1500, station: "browser-bay" });
    expect(h).toBe("#/run/2025-01-01T00-00-00Z?t=1500&station=browser-bay");
    expect(parseOfficeRoute(h)).toEqual({ runId: "2025-01-01T00-00-00Z", t: 1500, station: "browser-bay" });
  });

  it("defaults invalid t to 0 and drops unknown stations", () => {
    expect(parseOfficeRoute("#/run/r1?t=-5&station=nope")).toEqual({ runId: "r1", t: 0, station: null });
    expect(parseOfficeRoute("#/run/r1?t=abc").t).toBe(0);
    expect(parseOfficeRoute("#/").runId).toBeNull();
    expect(parseOfficeRoute("#/run/r1?t=99999999999").t).toBe(2147483647);
  });

  it("clamps t to the duration", () => {
    expect(clampT(500, 100)).toBe(100);
    expect(clampT(-1, 100)).toBe(0);
    expect(clampT(NaN, 100)).toBe(0);
  });
});

describe("office clock", () => {
  it("caps a frame at 100 ms and scales by speed", () => {
    let s = play(setSpeed(createClockState(10000), 5));
    s = advance(s, 5000);
    expect(s.t).toBe(500);
  });

  it("pauses at the end and does not loop", () => {
    let s = play(createClockState(150));
    s = advance(s, 100);
    s = advance(s, 100);
    expect(s).toMatchObject({ t: 150, playing: false });
    expect(advance(s, 100).t).toBe(150);
  });

  it("seeks within bounds, pauses, and rejects unknown speeds", () => {
    const s = createClockState(1000);
    expect(seek(s, 5000).t).toBe(1000);
    expect(seek(s, -3).t).toBe(0);
    expect(pause(play(s)).playing).toBe(false);
    expect(setSpeed(s, 3).speed).toBe(1);
    expect(SPEEDS).toEqual([1, 2, 5, 10]);
  });
});
