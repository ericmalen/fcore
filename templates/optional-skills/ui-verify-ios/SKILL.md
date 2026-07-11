---
name: ui-verify-ios
description: Drives the iOS Simulator via the ios-simulator-mcp server to verify React Native / Expo app changes — tap, type, swipe, screenshot, and read the accessibility tree of the already-running app. The app runs via Metro (`expo run:ios` / `expo start`); this skill drives the running simulator app, it never builds with xcodebuild. Use when a change touches RN/Expo mobile UI and needs verifying on the simulator before calling it done (macOS only). Not for web UI (use ui-verify-web), not for unit/component tests, and never against physical devices or production builds.
---

# ui-verify-ios

Verify React Native / Expo UI changes by driving the already-running app on
the iOS Simulator. Requires macOS, Xcode with a simulator runtime, and the
ios-simulator-mcp server.

## Prerequisites

- macOS with Xcode installed and at least one simulator runtime
  (`xcrun simctl list devices` to check).
- Node 18+.
- `idb-companion` for tap/type/swipe interaction:
  `brew tap facebook/fb && brew install idb-companion`. Without it,
  screenshot and accessibility-tree tools still work — verification degrades
  to look-only (screenshot + describe), not full interaction.

## First-run setup

Check whether the server is already configured:

```
claude mcp list
```

If `ios-simulator` is not listed, add it at project scope:

```
claude mcp add --scope project ios-simulator -- npx ios-simulator-mcp
```

Optionally pin a specific simulator with an `IDB_UDID` env var if the project
has more than one booted. **Newly added project MCP servers need user
approval and a session restart** before their tools are usable — if the
sim-driving tools aren't available, that's why; ask the user to restart.

## Workflow

1. Boot a simulator if none is running (`xcrun simctl boot <device>` or open
   Simulator.app).
2. Run the app:
   - First run, or after a native-module change: `npx expo run:ios`
     (background, wait for the build and Metro bundle to finish — this can
     take minutes, don't cut it short).
   - Otherwise: `npx expo start` and open the existing dev-client build.
3. `ui_describe_all` to read the current accessibility tree and locate the
   elements for the changed flow.
4. Drive the flow with `ui_tap` / `ui_type` / `ui_swipe` against those
   elements. Re-describe after each state-changing action.
5. `screenshot` at key checkpoints; use `ui_describe_point` for precise
   assertions about a specific element's state.
6. After a code edit, reload via Metro (fast refresh, or `r` in the Metro
   terminal) rather than restarting the app, unless the change is native.
7. Stop Metro when done.

## Report

State pass/fail per verification item, attach or reference screenshots, and
note whether interaction tools were available (idb-companion present) or
verification was look-only. Don't fabricate a pass for a flow you couldn't
reach.

## Guardrails

- Simulator only — never a physical device or a production/App Store build.
- Dev builds only, using dev/seed data.
- Never erase a simulator or change its system settings beyond the app under
  test.
- Treat screenshots as transient verification evidence, not build output.
