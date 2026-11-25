import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  Braces,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Moon,
  ScrollText,
  Search,
  Server,
  Settings,
  Shield,
  Sun,
  TerminalSquare,
  Users,
} from 'lucide-react';
import { APP_VERSION } from '@boerfen/shared';
import type { Host } from '@/types';
import { api } from '@/lib/api';
import { useMe, useSettings } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/controls';
import { Modal } from '@/components/ui/modal';
import { CommandPalette } from './command-palette';
import { toast } from 'sonner';

const NAV_GROUPS = [
  {
    group: 'overview',
    items: [{ to: '/', label: 'dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    group: 'assets',
    items: [
      { to: '/hosts', label: 'hosts', icon: Server },
      { to: '/credentials', label: 'credentials', icon: Shield },
      { to: '/keypairs', label: 'keypairs', icon: KeyRound },
    ],
  },
  {
    group: 'operations',
    items: [
      { to: '/terminal', label: 'terminal', icon: TerminalSquare },
      { to: '/audit', label: 'audit', icon: ScrollText },
    ],
  },
  {
    group: 'platform',
    items: [
      { to: '/users', label: 'users', icon: Users },
      { to: '/api', label: 'api', icon: Braces },
      { to: '/settings', label: 'settings', icon: Settings },
    ],
  },
] as const;

const PAGE_TITLES: Record<string, string> = {
  '/': 'dashboard',
  '/hosts': 'hosts',
  '/credentials': 'credentials',
  '/keypairs': 'keypairs',
  '/terminal': 'terminal',
  '/audit': 'audit',
  '/users': 'users',
  '/api': 'api',
  '/settings': 'settings',
};

export function AppShell() {
  const { t } = useTranslation();
  const { setTheme, resolvedTheme } = useTheme();
  const { data: me } = useMe();
  const settings = useSettings();
  const expiryDays = settings.data?.notifications.expiryDays ?? 30;
  const role = me?.user.role;
  const navGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (group.group === 'platform') return role === 'admin';
          if (item.to === '/terminal') return role === 'admin' || role === 'operator';
          return true;
        }),
      })).filter((group) => group.items.length > 0),
    [role],
  );
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const hostsQuery = useQuery({
    queryKey: ['hosts', 'shell'],
    queryFn: () => api.get<Host[]>('/api/v1/hosts?limit=200'),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const pageTitle = PAGE_TITLES[location.pathname] ?? 'dashboard';
  const hosts = hostsQuery.data ?? [];
  const expiring = useMemo(
    () =>
      hosts.filter((h) => {
        if (!h.expiresAt) return false;
        const days = Math.ceil((new Date(h.expiresAt).getTime() - Date.now()) / 86400000);
        return days >= 0 && days <= expiryDays;
      }),
    [hosts, expiryDays],
  );
  const offline = hosts.filter((h) => h.status === 'offline');

  const logout = async () => {
    try {
      await api.post('/api/v1/auth/logout');
    } catch {
      /* ignore */
    }
    queryClient.clear();
    navigate('/login', { replace: true });
    toast.success('已退出登录');
  };

  return (
    <>
      <div className="app-bg" />
      <aside className="sidebar glass-sidebar">
        <div className="flex items-center gap-2.5 px-4 py-3.5">
          <div className="grid h-[31px] w-[31px] shrink-0 place-items-center rounded-[9px] bg-gradient-to-br from-[var(--brand-strong)] to-[var(--brand)] text-[15px] font-bold text-[#241504] shadow-[inset_0_1px_0_rgba(255,255,255,.35)]">
            铂
          </div>
          <div className="brand-text">
            <div className="text-[14px] font-semibold tracking-wide">{t('appName')}</div>
            <div className="text-[10.5px] text-[var(--ink-3)]">{t('appSub')}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-auto px-2.5 py-1.5">
          {navGroups.map((group) => (
            <div key={group.group} className="mt-3.5">
              <div className="nav-label px-2.5 pb-1 pt-1.5 text-[11px] tracking-wide text-[var(--ink-3)]">
                {t(`nav.${group.group}`)}
              </div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={'end' in item ? item.end : false}
                  aria-label={t(`nav.${item.label}`)}
                  title={t(`nav.${item.label}`)}
                  className={({ isActive }) => cn('nav-item', isActive && 'nav-item-active')}
                >
                  <item.icon size={17} className="shrink-0" />
                  <span className="nav-label">{t(`nav.${item.label}`)}</span>
                  {item.to === '/hosts' && hosts.length > 0 ? (
                    <span className="nav-count ml-auto rounded-full bg-[var(--panel-2)] px-1.5 text-[10.5px] leading-[17px] text-[var(--ink-3)]">
                      {hosts.length}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-2.5 text-[11px] text-[var(--ink-3)]">
          <button
            type="button"
            className="icon-btn"
            title="切换主题"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          >
            {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <span className="side-foot-text">boerfen-assets v{APP_VERSION} · MIT</span>
        </div>
      </aside>

      <div className="content-wrap">
        <header className="topbar glass-topbar">
          <div className="topbar-crumb flex items-center gap-2 text-[12px] text-[var(--ink-3)]">
            <span>铂尔分</span>
            <span>/</span>
            <span className="font-semibold text-[var(--ink)]">{t(`nav.${pageTitle}`)}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label={t('common.searchPlaceholder')}
              className="flex h-[31px] items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--field)] px-2.5 text-[12px] text-[var(--ink-3)] hover:border-[var(--brand)]"
              onClick={() => setPaletteOpen(true)}
            >
              <Search size={15} />
              <span className="hidden sm:inline">{t('common.searchPlaceholder')}</span>
              <kbd className="hidden rounded border border-[var(--line-strong)] px-1.5 font-mono text-[10.5px] sm:inline">⌘K</kbd>
            </button>
            <button type="button" className="icon-btn relative" title="通知" onClick={() => setNotificationsOpen(true)}>
              <Bell size={15} />
              {expiring.length + offline.length > 0 ? (
                <i className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
              ) : null}
            </button>
            <div className="mr-1 flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[var(--brand-strong)] to-[var(--brand)] text-[12px] font-semibold text-[#241504]" title={me?.user.username}>
                {(me?.user.username ?? 'A').slice(0, 1)}
              </div>
              <button type="button" className="icon-btn" title={t('common.logout')} onClick={() => void logout()}>
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} hosts={hosts} role={role} />
      <Modal open={notificationsOpen} onOpenChange={setNotificationsOpen} title="通知">
        <div className="space-y-3">
          {expiring.map((h) => {
            const days = Math.ceil((new Date(h.expiresAt!).getTime() - Date.now()) / 86400000);
            return (
              <div className="callout callout-warn" key={h.id}>
                <span>
                  <b>{h.name}</b> 将于 {days} 天后到期（{h.expiresAt}），请及时续费。
                </span>
              </div>
            );
          })}
          {offline.map((h) => (
            <div className="callout" key={h.id}>
              <span>
                <b>{h.name}</b> 当前离线，最近探测{ h.probeOk === false ? '失败' : '无数据'}。
              </span>
            </div>
          ))}
          {!expiring.length && !offline.length ? <p className="text-[12px] text-[var(--ink-3)]">没有需要处理的通知。</p> : null}
        </div>
        <div className="modal-foot -mx-[18px] -mb-[14px] mt-4">
          <Button onClick={() => setNotificationsOpen(false)}>关闭</Button>
          <Button variant="primary" onClick={() => { setNotificationsOpen(false); navigate('/audit'); }}>查看审计</Button>
        </div>
      </Modal>
    </>
  );
}
