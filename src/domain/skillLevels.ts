import type { ApprovalMode, SkillLevel } from '../data/types';

export const SKILL_LEVEL_LABEL: Readonly<Record<SkillLevel, string>> = {
  beginner_welcome: '초보 환영',
  anyone: '누구나',
  experienced: '경험자 우대',
};

export const APPROVAL_MODE_LABEL: Readonly<Record<ApprovalMode, string>> = {
  auto: '바로 확정',
  manual: '승인 후 확정',
};

export function getSkillLevelLabel(level: SkillLevel): string {
  return SKILL_LEVEL_LABEL[level];
}
