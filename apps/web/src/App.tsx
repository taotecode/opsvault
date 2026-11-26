import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, useSetupStatus } from '@/lib/hooks';
import { AppShell } from '@/components/layout/app-shell';
import { DashboardPage } from '@/pages/dashboard';
import { HostsPage } from '@/pages/hosts';
import { CredentialsPage } from '@/pages/credentials';
import { KeypairsPage } from '@/pages/keypairs';
import { AuditPage } from '@/pages/audit';

const LoginPage = lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })));
const SetupPage = lazy(() => import('@/pages/setup').then((m) => ({ default: m.SetupPage })));
const TerminalPage = lazy(() => import('@/pages/terminal').then((m) => ({ default: m.TerminalPage })));
const UsersPage = lazy(() => import('@/pages/users').then((m) => ({ default: m.UsersPage })));
const ApiPage = lazy(() => import('@/pages/api').then((m) => ({ default: m.ApiPage })));
const SettingsPage = lazy(() => import('@/pages/settings').then((m) => ({ default: m.SettingsPage })));

const lazyFallback = (
  <div className="grid min-h-[40vh] place-items-center">
    <div className="skeleton h-16 w-40 rounded-xl" />
  </div>
);

function UnauthorizedListener() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useEffect(() => {
    const handler = () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    };
    window.addEventListener('opsvault:unauthorized', handler);
    return () => window.removeEventListener('opsvault:unauthorized', handler);
  }, [navigate, queryClient]);
  return null;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return lazyFallback;
  if (me.data?.user.role !== 'admin') {
    return <div className="empty-state">需要管理员权限才能访问此页面。</div>;
  }
  return children;
}

function Protected() {
  const me = useMe();
  const setup = useSetupStatus();
  if (me.isLoading || setup.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="skeleton h-24 w-24 rounded-2xl" />
      </div>
    );
  }
  if (setup.data && !setup.data.installed) return <Navigate to="/setup" replace />;
  if (me.error) return <Navigate to="/login" replace />;
  return <AppShell />;
}

export default function App() {
  return (
    <>
      <UnauthorizedListener />
      <Suspense fallback={lazyFallback}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route element={<Protected />}>
            <Route index element={<DashboardPage />} />
            <Route path="/hosts" element={<HostsPage />} />
            <Route path="/credentials" element={<CredentialsPage />} />
            <Route path="/keypairs" element={<KeypairsPage />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/users" element={<AdminOnly><UsersPage /></AdminOnly>} />
            <Route path="/api" element={<AdminOnly><ApiPage /></AdminOnly>} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
