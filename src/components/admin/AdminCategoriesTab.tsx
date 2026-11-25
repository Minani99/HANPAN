import { useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useDataAdapter } from '../../data';
import type { AdminCategory } from '../../data/types';
import { useAsyncData } from '../../data/useAsyncData';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ErrorState } from '../ui/ErrorState';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { adminErrorMessage } from './adminShared';

/**
 * 관리자 · 카테고리: 활성/비활성 전환만(삭제 대신 비활성 — 기존 모임 참조 유지).
 * 이름·설명·순서 변경은 MVP 화면에서 제외(SQL Editor로 처리 후 프론트 상수도 함께 배포 — docs/OPERATIONS.md §6).
 * categories 테이블 직접 쓰기(RLS is_admin), 감사 기록은 트리거(admin.category_update).
 */
export function AdminCategoriesTab() {
  const adapter = useDataAdapter();
  const toast = useToast();
  const { userKey } = useAuth();
  const [target, setTarget] = useState<AdminCategory | null>(null);
  const categories = useAsyncData(`admin-categories:${userKey}`, () => adapter.adminListCategories());

  const confirm = async () => {
    if (!target) return;
    await adapter.adminSetCategoryActive(target.id, !target.isActive);
    toast.show(target.isActive ? `${target.name}을(를) 비활성화했어요.` : `${target.name}을(를) 다시 활성화했어요.`, {
      tone: 'success',
    });
    setTarget(null);
    await categories.refresh().catch(() => categories.retry());
  };

  return (
    <div data-testid="admin-categories">
      <Notice tone="info">
        비활성 카테고리는 새 모임을 만들 때 고를 수 없어요. 이미 열린 모임은 그대로 보여요. 이름·순서 바꾸기는 이 화면에서 지원하지
        않아요.
      </Notice>
      {categories.status === 'loading' ? (
        <div aria-busy="true" className="mt-4 space-y-3">
          <p role="status" className="sr-only">
            카테고리를 불러오는 중이에요.
          </p>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : null}
      {categories.status === 'error' ? (
        <ErrorState title="카테고리를 불러오지 못했어요." description={adminErrorMessage(categories.error)} onRetry={categories.retry} />
      ) : null}
      {categories.status === 'success' && categories.data ? (
        <ul role="list" className="mt-4 border-t border-border" data-testid="admin-category-list">
          {categories.data.map((category) => (
            <li key={category.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-4" data-testid="admin-category">
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-2">
                  <strong className="text-base font-bold text-ink">{category.name}</strong>
                  <Badge tone={category.isActive ? 'success' : 'status'}>{category.isActive ? '활성' : '비활성'}</Badge>
                </p>
                <p className="mt-0.5 text-sm text-muted text-wrap-ko">
                  {category.id} · 순서 {category.sortOrder}
                  {category.description ? ` · ${category.description}` : ''}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setTarget(category)}
                aria-haspopup="dialog"
                aria-label={`${category.name} ${category.isActive ? '비활성화' : '활성화'}`}
              >
                {category.isActive ? '비활성화' : '활성화'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target?.isActive ? `${target.name}을(를) 비활성화할까요?` : `${target?.name ?? ''}을(를) 활성화할까요?`}
        confirmLabel={target?.isActive ? '비활성화' : '활성화'}
        confirmLoadingLabel="처리하는 중"
        cancelLabel="그대로 두기"
        onConfirm={confirm}
        errorMessage={adminErrorMessage}
      >
        <p>
          {target?.isActive
            ? '새 모임에서 이 카테고리를 고를 수 없게 돼요. 기존 모임과 탐색 필터는 그대로예요.'
            : '새 모임에서 다시 고를 수 있게 돼요.'}
        </p>
      </ConfirmDialog>
    </div>
  );
}
