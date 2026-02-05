import { basename } from 'node:path';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function toArray(value?: string[]): string[] {
  if (!value) return [];
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

export function indexToLineCol(text: string, index: number): { line: number; column: number } {
  if (index <= 0) return { line: 1, column: 1 };
  const slice = text.slice(0, index);
  const lines = slice.split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

export function detectShellOperators(input: string): boolean {
  return /[|;&><`]/.test(input) || /\$\([^)]*\)/.test(input);
}

export function toCommandName(cmd: string): string {
  if (!cmd) return '';
  return basename(cmd.trim());
}

export function unique<T>(values: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function normalizeDomain(input?: string): string {
  if (!input) return '';
  return input.trim().toLowerCase();
}

export function domainMatches(domain: string, entry: string): boolean {
  if (!domain || !entry) return false;
  if (domain === entry) return true;
  return domain.endsWith(`.${entry}`);
}
