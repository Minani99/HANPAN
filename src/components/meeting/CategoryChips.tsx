import type { Category, CategoryId } from '../../data/types';
import { cn } from '../../lib/cn';
import { Chip } from '../ui/Chip';

export interface CategoryChipsProps {
  categories: readonly Category[];
  selected?: CategoryId;
  onSelect: (categoryId: CategoryId | undefined) => void;
  /** '모집 중만' 토글 */
  recruitingOnly: boolean;
  onRecruitingChange: (next: boolean) => void;
  className?: string;
}

/** 게임 유형 칩 + '모집 중만' 토글. 좁은 화면에서는 가로 스크롤 */
export function CategoryChips({
  categories,
  selected,
  onSelect,
  recruitingOnly,
  onRecruitingChange,
  className,
}: CategoryChipsProps) {
  return (
    <div
      className={cn(
        'scrollbar-none -m-1.5 flex min-w-0 flex-1 items-center gap-1.75 overflow-x-auto p-1.5 md:gap-2.25',
        className,
      )}
    >
      <div role="group" aria-label="게임 유형" className="flex shrink-0 items-center gap-1.75 md:gap-2.25">
        <Chip selected={selected === undefined} onClick={() => onSelect(undefined)}>
          전체
        </Chip>
        {categories.map((category) => (
          <Chip key={category.id} selected={selected === category.id} onClick={() => onSelect(category.id)}>
            {category.name}
          </Chip>
        ))}
      </div>
      <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-border" />
      <Chip selected={recruitingOnly} onClick={() => onRecruitingChange(!recruitingOnly)}>
        모집 중만
      </Chip>
    </div>
  );
}
