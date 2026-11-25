import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'test') continue;
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      yield path;
    }
  }
}

describe('콘솔 출력 점검 (docs/SECURITY.md §11)', () => {
  it('앱 코드는 console.*를 직접 쓰지 않는다 — 개발 모드 전용 devWarn/devError만(운영 빌드에서는 출력 없음)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (rel === 'lib/devConsole.ts') continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (/\bconsole\.(log|info|warn|error|debug|trace)\b/.test(line)) offenders.push(`${rel}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('devConsole 자체는 import.meta.env.DEV 조건 안에서만 출력한다', () => {
    const source = readFileSync(join(SRC, 'lib', 'devConsole.ts'), 'utf8');
    const calls = source.split('\n').filter((line) => /\bconsole\./.test(line) && !line.trim().startsWith('*'));
    expect(calls.length).toBe(2);
    expect(calls.every((line) => line.includes('if (import.meta.env.DEV)'))).toBe(true);
  });
});
