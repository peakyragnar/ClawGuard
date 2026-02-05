import type { SkillBundle, ScanReport, Severity } from './types.js';
import { applyRules, type ScanSignal } from './rule-engine.js';
import { extractMarkdownSignals } from './extract.js';
import { loadDefaultRulePack } from './rules.js';
import { clamp } from './utils.js';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.sh', '.bash', '.zsh', '.ps1', '.py', '.js', '.mjs', '.ts']);

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

export function scanSkillBundle(bundle: SkillBundle): ScanReport {
  const rulePack = loadDefaultRulePack();
  const signals: ScanSignal[] = [];

  for (const file of bundle.files) {
    if (!file.content_text) continue;
    if (!isTextFile(file.path)) continue;
    if (file.path.toLowerCase().endsWith('.md')) {
      signals.push(...extractMarkdownSignals(file.content_text, file.path));
    }
    signals.push({ type: 'file' as const, text: file.content_text, file: file.path, baseLine: 1 });
  }

  const findings = applyRules(signals, rulePack.rules);
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
