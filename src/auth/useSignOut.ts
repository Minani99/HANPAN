import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../components/ui/Toast';
import { getErrorMessage } from '../domain/errorMessages';
import { useAuth } from './AuthProvider';

/** 로그아웃 → 홈으로 이동 + 안내. 실패하면 오류 문구를 띄우고 화면은 그대로 둔다. */
export function useSignOut() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  return useCallback(async () => {
    try {
      await signOut();
    } catch (error) {
      toast.show(getErrorMessage(error), { tone: 'error' });
      return;
    }
    navigate('/', { replace: true });
    toast.show('로그아웃했어요.');
  }, [signOut, navigate, toast]);
}
