// Dynamic desk assignment for the virtual office.
//
// NOTE FOR TASK 5.6 (dynamic desk manager): this file currently defines ONLY
// the `DeskManager` interface so the office state machine (task 5.2) can depend
// on the type and type-check now. Task 5.6 implements the concrete manager
// (`firstAvailable`, `acquire`, `release`, `assignmentOf`) with the behavior:
//   - a desk is available iff not assigned to or occupied by any character
//   - assign dynamically on entry; no agent bound to a fixed desk
//   - seat the oldest waiting character on release
// Keep this interface the shared contract; add the implementation here (a
// factory such as `createDeskManager(desks)` returning a `DeskManager`).

export interface DeskPlacement {
  id: string;
  position: [number, number, number];
  rotationY: number;
}

export interface DeskManager {
  readonly desks: DeskPlacement[];
  /** First desk that is neither assigned nor occupied, or null if all taken. */
  firstAvailable(): string | null;
  /** Assign the first available desk to a character; null -> caller goes to "waiting". */
  acquire(charId: string): string | null;
  /** Mark a desk available again (idempotent; ignores null/unknown ids). */
  release(deskId: string | null): void;
  /** The desk currently assigned to a character, or null. */
  assignmentOf(charId: string): string | null;
}
// ---------------------------------------------------------------------------
// Concrete dynamic desk manager (task 5.6)
// ---------------------------------------------------------------------------
//
// Availability is derived purely from the current assignment: a desk is
// "available" iff it is not assigned to any character. There is no fixed
// agent↔desk binding — on each entry the first available desk (in `desks`
// order) is handed out, and on release it immediately becomes available for a
// later `acquire` (the state machine seats a waiting character by calling
// `acquire` again on the next enter event).
//
// Two maps are kept in lock-step so both directions are O(1) and exclusivity
// is guaranteed structurally — a desk id is a value in `byChar` for at most one
// character, and a key in `byDesk` for at most one character:
//   byChar: charId -> deskId   (what a character currently holds)
//   byDesk: deskId -> charId   (who currently holds a desk)

/**
 * Build a dynamic {@link DeskManager} over the supplied desk layout.
 *
 * Behavior (Requirements 2.2–2.5):
 *  - `firstAvailable()` returns the first desk id (in layout order) not assigned
 *    to any character, else null.
 *  - `acquire(charId)` is idempotent: if the character already holds a desk its
 *    id is returned unchanged; otherwise the first available desk is assigned
 *    and returned, or null when the office is full (caller → "waiting").
 *  - `release(deskId)` frees a desk (idempotent; null/unknown ids are ignored),
 *    making it available to a subsequent `acquire`.
 *  - `assignmentOf(charId)` returns the desk currently held by a character, or
 *    null. Two characters never share a desk.
 */
export function createDeskManager(desks: DeskPlacement[]): DeskManager {
  // Snapshot the layout so external mutation of the caller's array cannot
  // desync the manager, and expose it as read-only.
  const layout: DeskPlacement[] = desks.slice();
  const known = new Set<string>(layout.map((d) => d.id));

  const byChar = new Map<string, string>(); // charId -> deskId
  const byDesk = new Map<string, string>(); // deskId -> charId

  function firstAvailable(): string | null {
    for (const desk of layout) {
      if (!byDesk.has(desk.id)) return desk.id;
    }
    return null;
  }

  function acquire(charId: string): string | null {
    // Idempotent: a character that already holds a desk keeps it.
    const existing = byChar.get(charId);
    if (existing !== undefined) return existing;

    const deskId = firstAvailable();
    if (deskId === null) return null; // office full → caller goes to "waiting"

    byChar.set(charId, deskId);
    byDesk.set(deskId, charId);
    return deskId;
  }

  function release(deskId: string | null): void {
    // Idempotent; ignore null and ids that are not a currently-held desk.
    if (deskId === null || !known.has(deskId)) return;
    const charId = byDesk.get(deskId);
    if (charId === undefined) return; // already free
    byDesk.delete(deskId);
    byChar.delete(charId);
  }

  function assignmentOf(charId: string): string | null {
    return byChar.get(charId) ?? null;
  }

  return {
    get desks(): DeskPlacement[] {
      return layout;
    },
    firstAvailable,
    acquire,
    release,
    assignmentOf,
  };
}

// ---------------------------------------------------------------------------
// Default desk layout (for office instantiation by tasks 5.15 / 5.19)
// ---------------------------------------------------------------------------

/**
 * A reasonable default desk layout positioned in the command-center room.
 *
 * Desks are laid out as a centered grid on the floor (y = 0), four per row,
 * facing the back wall where the command-center screens live, so a human model
 * placed at a desk faces the screens. Positions are plain placement data; the
 * office scene owns the actual geometry/scale. Ids are stable (`desk-01`, …).
 *
 * @param count number of desks to generate (default 12); clamped to >= 0.
 */
export function defaultDesks(count = 12): DeskPlacement[] {
  const n = Math.max(0, Math.floor(count));
  const perRow = 4;
  const spacingX = 2.4; // metres between desk centres across a row
  const spacingZ = 2.2; // metres between rows (front-to-back)
  const result: DeskPlacement[] = [];

  for (let i = 0; i < n; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const rowsNeeded = Math.ceil(n / perRow);

    // Centre each row horizontally around x = 0.
    const colsInThisRow = Math.min(perRow, n - row * perRow);
    const x = (col - (colsInThisRow - 1) / 2) * spacingX;
    // Rows march toward the back wall (negative z), centred around the room.
    const z = (row - (rowsNeeded - 1) / 2) * spacingZ;

    result.push({
      id: `desk-${String(i + 1).padStart(2, "0")}`,
      position: [x, 0, z],
      rotationY: 0, // all desks face the back wall (command-center screens)
    });
  }

  return result;
}
