import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  defaultPolicy,
  evaluateToolCall,
  scanSkillBundle,
  type Policy,
  type Decision,
  type ScanReport,
  type SkillBundle,
} from '@clawguard/core';

export type MikeBotSkillEntry = {
  name: string;
  path: string;
  content: string;
};

export type SkillDecision = {
  allowed: boolean;
  report: ScanReport;
  action: 'allow' | 'deny' | 'needs_approval';
};

export function scanSkillEntry(entry: MikeBotSkillEntry, policy?: Policy): SkillDecision {
  const bundle: SkillBundle = {
    id: entry.name,
    entrypoint: 'SKILL.md',
    source: 'local',
    files: [{ path: entry.path, content_text: entry.content }],
  };
  const report = scanSkillBundle(bundle);
  const resolved = policy ?? defaultPolicy();
  const denyAt = resolved.thresholds?.scan_deny_at ?? 80;
  const approveAt = resolved.thresholds?.scan_approve_at ?? 40;
  if (report.risk_score >= denyAt) {
    return { allowed: false, report, action: 'deny' };
  }
  if (report.risk_score >= approveAt) {
    return { allowed: false, report, action: 'needs_approval' };
  }
  return { allowed: true, report, action: 'allow' };
}

export function evaluateToolCallForMikeBot(
  toolName: string,
  args: Record<string, unknown>,
  policy?: Policy,
): Decision {
  return evaluateToolCall(
    {
      tool_name: toolName,
      args,
    },
    policy ?? defaultPolicy(),
  );
}

export async function appendAuditLine(path: string, payload: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(payload)}\n`, 'utf8');
}
