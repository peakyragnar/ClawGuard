# Trust Model (simple)

This project is built around one idea:

You will be wrong about a 3rd-party skill at least once. The system must still protect you when that happens.

## Two modes

### `untrusted` (default)
Use this for any skill you did not write yourself.

Properties:
- Strict scan thresholds.
- Runtime is guarded: elevated tools are `sandbox_only` by default.
- `system_exec` is denied by default.

Meaning: "If you download random stuff, you should not be able to brick your laptop by accident."

### `trusted`
This mode is not "no security". It is "less friction".

Trusted requires an explicit local pin (hash). If the source content changes, it is no longer trusted.

Properties:
- Normal scan thresholds.
- Runtime still guarded (deny rules and approvals still apply).
- `system_exec` is allowed, but still goes through the runtime approval gate.

## Trust is a pin (not a vibe)

Promoting a skill to `trusted` means: store a record keyed by `content_sha256` (and `manifest_sha256` when available).

If a skill updates or changes, the hash changes. That automatically drops it back to `untrusted`.

## Commands

Create a trust record:
```bash
./clawguard trust add <path|url|zip>
```

Check whether a source matches a pinned trust record:
```bash
./clawguard trust check <path|url|zip>
```

List trust records:
```bash
./clawguard trust list
```

Remove by content hash:
```bash
./clawguard trust remove <content_sha256>
```

Scan using a mode:
```bash
./clawguard scan-source <path|url|zip> --mode untrusted
./clawguard scan-source <path|url|zip> --mode trusted
```

Note: `--mode trusted` without a trust pin falls back to `untrusted` automatically, and the scan output reports `mode_effective`.

