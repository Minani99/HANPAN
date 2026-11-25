export type ClassValue = string | number | false | null | undefined | readonly ClassValue[];

/**
 * className 조합 (외부 의존성 없음).
 * 주의: Tailwind 클래스 충돌을 해소하지 않는다. 같은 속성을 덮어써야 하면 컴포넌트에 variant/size prop을 둔다.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  const visit = (value: ClassValue): void => {
    if (value === null || value === undefined || value === false || value === '') return;
    if (Array.isArray(value)) {
      for (const item of value as readonly ClassValue[]) visit(item);
      return;
    }
    out.push(String(value));
  };
  for (const value of values) visit(value);
  return out.join(' ');
}
