import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { APP_VERSION, loginSchema } from '@opsvault/shared';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useMe, useSetupStatus } from '@/lib/hooks';
import { Button, Input } from '@/components/ui/controls';
import { Callout } from '@/components/common/primitives';

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const setup = useSetupStatus();
  const [needsTotp, setNeedsTotp] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (me.data?.user) navigate('/', { replace: true });
  }, [me.data, navigate]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post<{ csrfToken: string }>('/api/v1/auth/login', values);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
      toast.success('登录成功');
    } catch (e) {
      const err = e as ApiError;
      const hint = `${err.message} ${err.hint ?? ''}`;
      if (/TOTP|动态口令/.test(hint)) {
        setNeedsTotp(true);
        toast.error('需要动态口令', { description: '请输入 TOTP 验证码后重试' });
      } else {
        toast.error(err.message, { description: err.hint });
      }
    }
  });

  return (
    <div className="relative min-h-screen">
      <div className="app-bg" />
      <div className="relative z-10 grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-[430px]">
          <div className="mb-5 flex items-center justify-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand-strong)] to-[var(--brand)] text-base font-bold tracking-wide text-[#241504] shadow-lg">
              OV
            </div>
            <div>
              <div className="text-[18px] font-semibold tracking-wide">OpsVault</div>
              <div className="text-[11px] text-[var(--ink-3)]">服务器资产管理平台</div>
            </div>
          </div>
          <div className="glass-panel w-full border-white/40 p-6">
            <h1 className="text-[16px] font-semibold">登录</h1>
            <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">凭据加密存储 · 全量审计 · Agent Ready</p>
            <form className="mt-5 space-y-3" onSubmit={onSubmit}>
              <div>
                <label htmlFor="login-account" className="mb-1 block text-[11.5px] text-[var(--ink-3)]">邮箱或用户名</label>
                <Input
                  id="login-account"
                  autoComplete="username"
                  placeholder="admin@example.com 或 admin"
                  {...form.register('email')}
                />
                {form.formState.errors.email ? <p className="mt-1 text-[11px] text-[var(--bad)]">{form.formState.errors.email.message}</p> : null}
              </div>
              <div>
                <label htmlFor="login-password" className="mb-1 block text-[11.5px] text-[var(--ink-3)]">密码</label>
                <Input id="login-password" type="password" autoComplete="current-password" placeholder="登录密码" {...form.register('password')} />
              </div>
              {needsTotp ? (
                <div>
                  <label htmlFor="login-totp" className="mb-1 block text-[11.5px] text-[var(--ink-3)]">TOTP 动态口令</label>
                  <Input id="login-totp" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" {...form.register('totp')} />
                  <p className="mt-1 text-[11px] text-[var(--ink-3)]">该账号已启用二次验证</p>
                </div>
              ) : null}
              <Button type="submit" variant="primary" className="mt-1 w-full" disabled={form.formState.isSubmitting}>
                登录 <ArrowRight size={14} />
              </Button>
            </form>
            {setup.data && !setup.data.installed ? (
              <div className="mt-4">
                <Callout tone="warn">
                  平台尚未安装。<Link to="/setup" className="underline">进入安装向导</Link>
                </Callout>
              </div>
            ) : null}
            <div className="mt-4 text-center text-[11px] text-[var(--ink-3)]">
              OpsVault · MIT 开源 · v{setup.data?.version ?? APP_VERSION}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
