/** scripts/lib/security-headers.mjs의 타입 선언(TypeScript 쪽: vite.config.ts, 단위 테스트) */

export interface HeaderRule {
  path: string;
  headers: Array<[string, string]>;
}

export declare const HEADERS_FILE_NAME: '_headers';
export declare const MAX_HEADERS_LINE_LENGTH: number;
export declare const FONT_CDN_SOURCE: string;

export declare class HeadersConfigError extends Error {
  readonly reason: 'not_https' | 'has_path' | 'format';
  constructor(message: string, reason: 'not_https' | 'has_path' | 'format');
}

export declare function parseSupabaseOrigin(raw: string | undefined | null): string | null;
export declare function cspDirectives(supabaseOrigin: string | null): Array<[string, string[], string]>;
export declare function buildCsp(supabaseOrigin: string | null): string;
export declare function buildHeaderRules(options: { supabaseOrigin: string | null }): HeaderRule[];
export declare function renderHeadersFile(rules: HeaderRule[], comments?: string[]): string;
export declare function parseHeadersFile(text: string): HeaderRule[];
export declare function pathMatches(pattern: string, pathname: string): boolean;
export declare function headersForPath(rules: HeaderRule[], pathname: string): Record<string, string>;
export declare function parseCsp(csp: string): Record<string, string[]>;
