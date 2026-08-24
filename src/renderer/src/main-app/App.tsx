import React, { Suspense, lazy } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import Layout from './components/Layout';
import { useDirtyGuard } from './hooks/useDirtyGuard';

const HomePage = lazy(() => import('./pages/HomePage'));
const NotePage = lazy(() => import('./pages/NotePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const SuspenseFallback = () => (
  <div className="h-full flex items-center justify-center text-ink-500 text-sm">
    加载中…
  </div>
);

// 使用 data router（createHashRouter），以支持 useBlocker 等 v6.4+ API
export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <HomePage />
          </Suspense>
        )
      },
      {
        path: 'note/:id',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <NotePage />
          </Suspense>
        )
      },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<SuspenseFallback />}>
            <SettingsPage />
          </Suspense>
        )
      },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
]);

export default function App() {
  // useDirtyGuard 不依赖 router context，放在 RouterProvider 外层即可
  useDirtyGuard();
  return <RouterProvider router={router} />;
}
