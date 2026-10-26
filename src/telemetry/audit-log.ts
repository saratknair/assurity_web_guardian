import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * Append-only JSONL log (Req 20.7-20.9, 24.5). Application-level only:
 *  - the only public write operation is append();
 *  - there is NO edit/overwrite operation;
 *  - a would-be overwrite (by index) is rejected with an integrity error and
 *    the existing content is preserved unchanged.
 *
 * Milestone-one immutability is application-level. The underlying file remains
 * technically modifiable by anyone with filesystem access; this is NOT
 * cryptographic or regulatory-grade immutability (Req 20.10).
 */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

export class AppendOnlyLog {
  constructor(public readonly path: string) {}

  append(record: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
    appendFileSync(this.path, line + "\n", "utf8");
  }

  /** Reject any attempt to modify an existing entry (Req 24.5). */
  overwriteAt(_index: number, _record: Record<string, unknown>): never {
    throw new IntegrityError(
      "Append-only log: editing or overwriting existing entries is not permitted. " +
        "Record a correction as a new appended event instead.",
    );
  }

  readAll(): Record<string, unknown>[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  count(): number {
    return this.readAll().length;
  }
}
