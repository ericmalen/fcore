---
name: ui-verify-web
description: Drives the project's web UI in a real browser via the Playwright MCP server (accessibility-snapshot based — the agent reasons about "the Sign In button", not CSS selectors or pixels) to visually and behaviorally verify a change before calling it done. Navigate, click, type, snapshot, screenshot, read console errors. Use when a change touches web UI and needs to be seen working — not just type-checked or unit-tested — before commit or PR, or when explicitly asked to verify in the browser. Not for authoring Playwright test suites, not for API-only changes with no UI surface, and never against production or staging URLs — local dev only.
---

# ui-verify-web

Verify web UI changes by actually driving them in a browser, not just reading
the diff. Requires the Playwright MCP server.

## First-run setup

Check whether the server is already configured:

```
claude mcp list
```

If `playwright` is not listed, add it at project scope (writes a committable
`.mcp.json`):

```
claude mcp add --scope project playwright -- npx @playwright/mcp@latest
```

**Newly added project MCP servers need user approval and a session restart**
before their tools are usable — if `browser_navigate` and friends aren't
available, that's why; ask the user to restart, don't loop retrying.

If the browser fails to launch, install it once:

```
npx playwright install chromium
```

VS Code / Copilot parity (optional, note only): mirror the same server entry
in `.vscode/mcp.json` if the project uses Copilot alongside Claude Code.

## Workflow

1. Find the dev server command — check `package.json` `scripts` (`dev`,
   `start`, `serve`). Start it in the background and wait for the port to
   respond before navigating; don't guess a fixed sleep.
2. `browser_navigate` to the local dev URL for the changed flow.
3. **Snapshot-first policy**: take an accessibility snapshot
   (`browser_snapshot`) and assert against it — element roles, names, states.
   Use `browser_take_screenshot` for visual evidence attached to the report,
   not as the primary assertion mechanism; screenshots don't tell you whether
   a button is disabled or a field is invalid.
4. Drive the changed flow: click, type, and navigate using the snapshot's
   element refs. Re-snapshot after each state-changing action.
5. Check `browser_console_messages` for errors introduced by the change.
6. Screenshot key checkpoints to the session scratchpad or a gitignored
   `reports/` dir if the project has one — never commit screenshots unless
   the project explicitly asks for them as fixtures.
7. Stop the dev server when done.

## Report

State pass/fail per verification item (not just "looks fine"), attach or
reference the screenshots taken, and quote any console errors verbatim. If a
flow couldn't be reached (auth wall, missing seed data), say so — don't
fabricate a pass.

## Guardrails

- Local dev URLs only (`localhost`, `127.0.0.1`, a project's documented dev
  port) — never a deployed environment, staging or production.
- Use dev/seed credentials only; never real user accounts or secrets.
- Never write secrets into `.mcp.json` — server args are the npx command
  only.
- Treat screenshots as transient verification evidence, not build output.
