/**
 * 폼 오류 시 해당 필드로 포커스를 옮긴다.
 * 입력 요소에는 data-field="이름"을, 그룹(라디오·칩)에는 컨테이너에 data-field와 안쪽 대상에 data-focus-target을 둔다.
 */
export function focusFormField(form: HTMLElement | null, field: string): boolean {
  if (!form) return false;
  const container = form.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (!container) return false;
  const target = container.matches('input, select, textarea, button')
    ? container
    : (container.querySelector<HTMLElement>('[data-focus-target]') ??
      container.querySelector<HTMLElement>('input, select, textarea, button'));
  if (!target) return false;
  target.focus();
  return true;
}
