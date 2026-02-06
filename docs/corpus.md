# Corpus Scanning (ClawHub)

Goal: build a repeatable regression corpus + "diff queue" between:

- ClawSkill scan output (`risk_score`, `findings`, `action`)
- ClawHub's VirusTotal / Code Insight signal (`clean|suspicious|malicious` + `aiAnalysis`)

This is for evaluation and rule iteration. It must never execute anything.

## Safety Properties

- Downloads zip bytes only (no execution)
- Parses zip with hard caps (bytes, files, per-entry size)
- Treats content as untrusted strings only
- Writes JSONL output for offline analysis
- Resumable via a local state file

## Usage

Build once:

```bash
pnpm -r build
```

Scan a small sample:

```bash
node scripts/scan-corpus.mjs --max-skills 200 --out /tmp/clawhub-corpus-200.jsonl
```

Re-run (resumes by default):

```bash
node scripts/scan-corpus.mjs --max-skills 200 --out /tmp/clawhub-corpus-200.jsonl
```

Skip ClawHub VirusTotal/Code-Insight fetch (faster, less load):

```bash
node scripts/scan-corpus.mjs --max-skills 200 --out /tmp/clawhub-corpus-200.jsonl --no-include-vt
```

Output format: one JSON object per line with `clawhub_vt.status` and `clawhub_vt.metadata.aiAnalysis` (truncated).

