// cli-args.mjs — shared CLI flag handling for the scripts/ entry points.
//
// One rule, one place: a value-taking flag (`--root <dir>`, `--out <file>`, …)
// must be followed by an actual value — not another `--flag`, not end-of-args.
// Without this guard, `--root` with a missing value silently falls through to
// the default (usually cwd), pointing the run at the wrong tree. `fail(msg)`
// must not return (it exits or throws); the caller advances its own loop index
// past the consumed value, e.g. `opt.root = flagValue(args, i++, '--root', bad)`.

export function flagValue(argv, flagIndex, flag, fail) {
  const v = argv[flagIndex + 1];
  if (v === undefined || v.startsWith('--')) {
    fail(`${flag} requires a value`);
    return undefined; // unreachable when fail exits/throws — keeps callers honest
  }
  return v;
}
