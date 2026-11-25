import { screen } from '@testing-library/react';
import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { POLICIES, POLICY_DRAFT_NOTICE } from '../content/policies';
import { renderRoutes } from '../test/renderWithProviders';
import { PolicyPage } from './PolicyPage';

const routes: RouteObject[] = [
  { path: '/', element: <p>홈</p> },
  { path: '/policies/:slug', Component: PolicyPage },
];

describe('PolicyPage', () => {
  it.each(POLICIES.map((policy) => [policy.slug, policy.title] as const))('%s: 제목 + 초안 배너 + 본문', async (slug, title) => {
    renderRoutes(routes, { initialEntries: [`/policies/${slug}`] });
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByTestId('policy-draft-banner')).toHaveTextContent(POLICY_DRAFT_NOTICE);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(3);
    expect(screen.getByRole('navigation', { name: '정책 문서' })).toBeInTheDocument();
  });

  it('정해지지 않은 값은 "확정 전"으로 보이고 가짜 값·내부 표기(BLOCKED·미확인·.md 링크)는 없다', () => {
    for (const policy of POLICIES) {
      expect(policy.source, policy.slug).not.toMatch(/BLOCKED|미확인|\.md\)|\[이메일 주소\]|\[운영자명\]|@/);
    }
    expect(POLICIES.find((policy) => policy.slug === 'terms')?.source).toContain('**확정 전**');
    expect(POLICIES.find((policy) => policy.slug === 'privacy')?.source).toContain('**확정 전**');
  });

  it('없는 slug는 404', async () => {
    renderRoutes(routes, { initialEntries: ['/policies/unknown'] });
    expect(await screen.findByRole('heading', { level: 1, name: '페이지를 찾을 수 없어요' })).toBeInTheDocument();
  });
});
