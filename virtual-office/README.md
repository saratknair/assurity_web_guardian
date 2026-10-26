# Assurity Web Guardian - Virtual Office (Phase 11)

A read-only React visualisation of Guardian runs. It is a VISUALISATION LAYER ONLY - it never manufactures events or agent activity. Every tile state is derived solely from genuine events served by the Phase-10 read-only event-access layer at http://127.0.0.1:7788.

## Modes
- Live - SSE stream of the active run (/live); shows an explicit IDLE badge when no run is active.
- Historical - loads a completed run events (/runs/:id/events).
- Replay - timestamp-ordered replay (/replay/:id?speed=N), clearly labelled "REPLAY - not live".

## Toolchain note (why these versions)
First scaffolded with create-vite v9, which pinned the bleeding-edge rolldown-based Vite 8 + TypeScript 6 + React 19 stack. npm 10.9.0 on Node 22.11 could not resolve that peer graph - @npmcli/arborist crashes with "Cannot read properties of null (reading edgesOut)" while walking the Vite 8 peer set (rolldown / playwright / webdriverio / puppeteer-core / canvas). This reproduced identically inside AND outside the parent project tree, so it is a toolchain-too-new issue, not a workspace or cache problem.

Pinned to a stable, known-good set that npm 10.9.0 resolves cleanly (verified: install + typecheck + production build all pass):
- react / react-dom ^18.3
- vite ^5.4
- @vitejs/plugin-react ^4.3
- typescript ^5.6

The office source is unchanged by this decision - it uses only standard React hooks, EventSource, and fetch.

## Run it
1. From the project root, start the event-access layer (port 7788).
2. In this folder: install deps, then start the Vite dev server (serves http://localhost:5173).
3. Open the URL. With no active run you see the IDLE badge; use Historical/Replay for completed runs.

If install ever hits the edgesOut error again after a toolchain bump, installing outside the parent tree is NOT the fix - pin the versions above.

## Build
Build script runs tsc then vite build, emitting to dist/.