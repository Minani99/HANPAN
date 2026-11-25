import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { config, z } from 'zod';
import './zodConfig';

describe('Zod 전역 설정 (CSP: unsafe-eval 없음 — docs/SECURITY.md §7)', () => {
  it('jitless를 켜서 new Function 시험을 하지 않는다', () => {
    expect(config().jitless).toBe(true);
    // 설정 후 만든 객체 스키마도 정상 동작한다(코드 생성 없이 검사)
    const schema = z.object({ a: z.string(), b: z.number().int() });
    expect(schema.safeParse({ a: 'x', b: 1 }).success).toBe(true);
    expect(schema.safeParse({ a: 1, b: 1.5 }).success).toBe(false);
  });

  it('main.tsx의 첫 import가 zodConfig다(어떤 스키마보다 먼저 설정)', () => {
    const main = readFileSync(join(import.meta.dirname, '..', 'main.tsx'), 'utf8');
    const firstImport = main.split('\n').find((line) => line.startsWith('import '));
    expect(firstImport).toBe("import './lib/zodConfig';");
  });
});
