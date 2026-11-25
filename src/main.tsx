// 반드시 첫 import: Zod 스키마가 만들어지기 전에 jitless를 켠다(CSP unsafe-eval 없이 동작 — src/lib/zodConfig.ts).
import './lib/zodConfig';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, createAppRouter } from './App';
import { createDataAdapter, type DataAdapter } from './data';
import { createUnconfiguredAdapter } from './data/unconfigured';
import { devError } from './lib/devConsole';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root 요소를 찾을 수 없습니다.');

const root = createRoot(container);
const router = createAppRouter();

function render(adapter: DataAdapter) {
  root.render(
    <StrictMode>
      <App adapter={adapter} router={router} />
    </StrictMode>,
  );
}

createDataAdapter().then(render, (error: unknown) => {
  // 어댑터 준비에 실패해도 가짜 데이터 없이 빈 상태로 화면은 띄운다.
  devError('[HANPAN] 데이터 어댑터를 준비하지 못했습니다.', error);
  render(createUnconfiguredAdapter());
});
