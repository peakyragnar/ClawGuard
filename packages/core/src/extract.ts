import type { ScanSignal } from './rule-engine.js';

const CODE_FENCE = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
const URL_REGEX = /https?:\/\/[^\s)'"`]+/g;
const PATH_REGEX = /(?:^|\s)(\.\/|..\/|scripts\/|bin\/|assets\/)[\w./-]+/g;

export function extractMarkdownSignals(text: string, file: string): ScanSignal[] {
  const signals: ScanSignal[] = [{ type: 'markdown', text, file }];
  const codeBlocks: ScanSignal[] = [];
  for (const match of text.matchAll(CODE_FENCE)) {
    const block = match[2] ?? '';
    const index = match.index ?? 0;
    const baseLine = text.slice(0, index).split('\n').length + 1;
    codeBlocks.push({ type: 'codeblock', text: block, file, baseLine });
  }
  signals.push(...codeBlocks);

  for (const match of text.matchAll(URL_REGEX)) {
    const url = match[0];
    const index = match.index ?? 0;
    signals.push({ type: 'url', text: url, file, offset: index, baseLine: text.slice(0, index).split('\n').length });
  }

  for (const match of text.matchAll(PATH_REGEX)) {
    const path = match[0].trim();
    const index = match.index ?? 0;
    signals.push({ type: 'path', text: path, file, offset: index, baseLine: text.slice(0, index).split('\n').length });
  }

  return signals;
}
