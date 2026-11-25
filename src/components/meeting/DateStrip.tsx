import { cn } from '../../lib/cn';
import { formatDateKeyLong, formatDateKeyShort, type KstDay } from '../../lib/date';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';
import { VisuallyHidden } from '../ui/VisuallyHidden';

export interface DateStripProps {
  /** 오늘(KST)부터 7일 */
  days: readonly KstDay[];
  /** 선택된 날짜 키(YYYY-MM-DD). 없으면 '전체' */
  selected?: string;
  onSelect: (dateKey: string | undefined) => void;
}

interface DayButtonProps {
  small: string;
  strong: string;
  selected: boolean;
  /** 스크린리더에만 덧붙는 설명(예: ', 11월 28일 토요일, 오늘'). 보이는 글자 뒤에 붙는다 */
  hiddenDetail?: string;
  onClick: () => void;
}

/**
 * 접근 가능한 이름 = 보이는 글자(요일·날짜) + 숨긴 설명. aria-label로 이름을 통째로 바꾸지 않는다
 * — 음성 입력 사용자가 보이는 글자로 버튼을 부를 수 있어야 한다(WCAG 2.5.3 Label in Name, axe label-content-name-mismatch).
 * 두 글자 사이의 공백 텍스트는 이름에서 단어를 나누기 위한 것이다(flex 안의 공백 텍스트는 화면에 그려지지 않는다).
 * 버튼은 `relative`: 숨긴 설명(sr-only, position:absolute)의 기준이 버튼이 되어야 가로 스크롤 영역 밖으로 빠져
 * 문서 전체에 가로 넘침을 만들지 않는다(오프셋이 없어 화면 위치는 그대로).
 */
function DayButton({ small, strong, selected, hiddenDetail, onClick }: DayButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'relative flex min-h-18 shrink-0 basis-[59px] flex-col items-center justify-center gap-1.5 rounded-md border px-1 py-2 text-center transition-colors duration-150',
        'md:min-h-22.5 md:basis-auto md:rounded-none md:border-0 md:border-l md:border-border',
        selected ? 'border-ink bg-ink text-white md:bg-ink' : 'border-border bg-surface text-ink hover:bg-soft',
      )}
    >
      <small className="text-xs leading-tight font-semibold">{small}</small>{' '}
      <strong className="text-xs leading-tight font-bold md:text-md">{strong}</strong>
      {hiddenDetail ? <VisuallyHidden>{hiddenDetail}</VisuallyHidden> : null}
    </button>
  );
}

/**
 * 날짜 선택: '전체' + 오늘부터 7일(KST) = 8칸.
 * 데스크톱은 8칸 grid, 모바일은 가로 스크롤.
 * URL로 범위 밖 날짜가 들어오면 필터는 그대로 적용하고 해제 칩을 보여준다.
 */
export function DateStrip({ days, selected, onSelect }: DateStripProps) {
  const outOfRange = selected !== undefined && !days.some((day) => day.key === selected);

  return (
    <div>
      <div className="md:flex md:min-h-25 md:items-stretch md:border-b md:border-border">
        <div aria-hidden="true" className="hidden shrink-0 basis-filter-label items-center text-md font-bold text-ink md:flex">
          날짜로 찾기
        </div>
        <div aria-hidden="true" className="mt-2.25 mb-1.75 text-md font-extrabold text-ink md:hidden">
          날짜 선택
        </div>
        <div
          role="group"
          aria-label="날짜 선택"
          className={cn(
            'scrollbar-none -mx-1.5 flex gap-1.25 overflow-x-auto px-1.5 pt-1.5 pb-3.25',
            'md:mx-0 md:grid md:min-w-0 md:flex-1 md:grid-cols-8 md:gap-0 md:overflow-visible md:p-0',
          )}
        >
          <DayButton
            small="날짜"
            strong="전체"
            selected={selected === undefined}
            onClick={() => onSelect(undefined)}
          />
          {days.map((day) => (
            <DayButton
              key={day.key}
              small={day.weekday}
              strong={day.label}
              selected={day.key === selected}
              hiddenDetail={day.isToday ? `, ${day.longLabel}, 오늘` : `, ${day.longLabel}`}
              onClick={() => onSelect(day.key)}
            />
          ))}
        </div>
      </div>
      {outOfRange && selected ? (
        <div className="pb-3 md:border-b md:border-border md:py-3 md:pl-filter-label">
          <Chip
            toggle={false}
            selected
            onClick={() => onSelect(undefined)}
            trailingIcon={<Icon name="close" size="1.1em" />}
          >
            {/* 이름 = 보이는 글자 + 숨긴 설명(WCAG 2.5.3) */}
            날짜: {formatDateKeyShort(selected)}{' '}
            <VisuallyHidden>({formatDateKeyLong(selected)}) 필터 해제</VisuallyHidden>
          </Chip>
        </div>
      ) : null}
    </div>
  );
}
