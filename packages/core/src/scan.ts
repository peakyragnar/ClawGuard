import type { SkillBundle, ScanReport, Severity } from './types.js';
import { applyRules, type ScanSignal } from './rule-engine.js';
import { extractMarkdownSignals } from './extract.js';
import { loadDefaultRulePack } from './rules.js';
import { clamp } from './utils.js';

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.py',
  '.js',
  '.mjs',
  '.ts',
  '.json',
  '.toml',
  '.yaml',
  '.yml',
]);

function isTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  for (const ext of TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function severityFloor(severity: Severity): number {
  switch (severity) {
    case 'critical':
      return 80;
    case 'high':
      return 60;
    case 'medium':
      return 30;
    default:
      return 10;
  }
}

function dedupeFindings<T extends { rule_id: string; file?: string; line?: number; column?: number; evidence: string }>(findings: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const finding of findings) {
    const key = `${finding.rule_id}|${finding.file ?? ''}|${finding.line ?? 0}|${finding.column ?? 0}|${finding.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

export function scanSkillBundle(bundle: SkillBundle): ScanReport {
  const rulePack = loadDefaultRulePack();
  const signals: ScanSignal[] = [];

  if (bundle.ingest_warnings && bundle.ingest_warnings.length > 0) {
    for (const warning of bundle.ingest_warnings) {
      signals.push({ type: 'meta', text: `ingest_warning: ${warning}`, file: 'MANIFEST', baseLine: 1 });
    }
  }

  if (bundle.manifest && bundle.manifest.length > 0) {
    for (const entry of bundle.manifest) {
      const path = entry.path;
      if (entry.skipped_reason === 'invalid_path') {
        const raw = entry.raw_path ?? entry.path;
        signals.push({ type: 'meta', text: `path_traversal_entry raw=${raw}`, file: path, baseLine: 1 });
        continue;
      }
      if (entry.is_symlink) signals.push({ type: 'meta', text: `symlink_entry path=${path}`, file: path, baseLine: 1 });
      if (entry.is_archive) signals.push({ type: 'meta', text: `nested_archive path=${path}`, file: path, baseLine: 1 });
      if (entry.is_executable) signals.push({ type: 'meta', text: `executable_file path=${path}`, file: path, baseLine: 1 });
      if (entry.is_binary) signals.push({ type: 'meta', text: `binary_file path=${path}`, file: path, baseLine: 1 });
    }
  }

  for (const file of bundle.files) {
    if (!file.content_text) continue;
    if (!isTextFile(file.path)) continue;
    if (file.path.toLowerCase().endsWith('.md')) {
      signals.push(...extractMarkdownSignals(file.content_text, file.path));
    }
    signals.push({ type: 'file' as const, text: file.content_text, file: file.path, baseLine: 1 });
  }

  const findings = dedupeFindings(applyRules(signals, rulePack.rules));
  const scoreSum = findings.reduce((sum, finding) => {
    const score = rulePack.rules.find((rule) => rule.id === finding.rule_id)?.score ?? 0;
    return sum + score;
  }, 0);
  const floor = findings.reduce((max, finding) => Math.max(max, severityFloor(finding.severity)), 0);
  const riskScore = clamp(Math.max(scoreSum, floor), 0, 100);

  return {
    api_version: 1,
    risk_score: riskScore,
    findings,
  };
}
