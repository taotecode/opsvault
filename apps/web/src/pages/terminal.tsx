import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Eraser, Plug, RefreshCw, TerminalSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import type { Host } from '@/types';
import { Button } from '@/components/ui/controls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/fields';
import { Badge } from '@/components/common/badges';
import { Callout, EmptyState, GlassPanel, PageHeader } from '@/components/common/primitives';

type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

const STATUS: Record<ConnState, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' | 'bad' }> = {
  idle: { label: '未连接', tone: 'neutral' },
  connecting: { label: '连接中…', tone: 'info' },
  open: { label: '已连接', tone: 'ok' },
  closed: { label: '已断开', tone: 'warn' },
  error: { label: '连接失败', tone: 'bad' },
};

/**
 * 终端说明：所有 SSH 会话由服务端记录审计（打开/关闭终端都会写入 audit_logs）。
 * WebSocket 协议：服务端推送终端输出文本；客户端发送原始输入，或 {type:'resize',cols,rows} 调整 PTY 尺寸。
 */
export function TerminalPage() {
  const hostsQuery = useQuery<Host[]>({
    queryKey: ['hosts', 'terminal'],
    queryFn: () => api.get<Host[]>('/api/v1/hosts?limit=200'),
  });
  const me = useMe();
  const role = me.data?.user.role;
  const canConnect = !role || role === 'admin' || role === 'operator';
  const [searchParams] = useSearchParams();
  const [hostId, setHostId] = useState(() => searchParams.get('hostId') ?? '');
  const [status, setStatus] = useState<ConnState>('idle');
  const [retry, setRetry] = useState(0);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);

  const hosts = hostsQuery.data ?? [];
  const host = hosts.find((h) => h.id === hostId) ?? null;

  useEffect(() => {
    if (hosts.length && !hosts.some((h) => h.id === hostId)) setHostId(hosts.at(0)!.id);
  }, [hosts, hostId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !host || !connected) {
      setStatus('idle');
      return;
    }
    container.innerHTML = '';
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12.5,
      fontFamily: "'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace",
      scrollback: 5000,
      convertEol: true,
      theme: {
        background: '#05080d',
        foreground: '#d7e1f0',
        cursor: '#f0a43c',
        selectionBackground: 'rgba(240,164,60,0.25)',
        black: '#05080d',
        brightBlack: '#71829e',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    let disposed = false;
    const fitNow = () => {
      try {
        fit.fit();
      } catch {
        /* container 尺寸尚未就绪 */
      }
    };
    const raf = requestAnimationFrame(fitNow);
    const observer = new ResizeObserver(() => {
      if (!disposed) fitNow();
    });
    observer.observe(container);
    term.writeln('铂尔分 · Web 终端（SSH 会话全程审计）');
    term.writeln(`目标：ssh ${host.sshUser}@${host.address} -p ${host.port}`);
    term.writeln('正在建立 SSH 会话…');

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/api/v1/hosts/${host.id}/terminal`);
    setStatus('connecting');
    socket.onopen = () => {
      if (disposed) return;
      setStatus('open');
      term.writeln('\r\n● 已连接（会话已审计）');
      fitNow();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
      term.focus();
    };
    socket.onmessage = (event) => {
      if (disposed) return;
      if (typeof event.data === 'string') term.write(event.data);
      else if (event.data instanceof ArrayBuffer) term.write(new Uint8Array(event.data));
    };
    socket.onerror = () => {
      if (disposed) return;
      setStatus('error');
      term.writeln('\r\n[connection error] WebSocket 连接失败，请确认登录状态与角色权限。');
    };
    socket.onclose = () => {
      if (disposed) return;
      setStatus('closed');
      term.writeln('\r\n[disconnected] 会话已断开，点击「重连」重新建立连接。');
    };
    const dataSub = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      if (container) container.innerHTML = '';
    };
  }, [host?.id, retry, connected]);

  return (
    <>
      <PageHeader
        title="Web 终端"
        sub="xterm.js + WebSocket + ssh2 · SSH 会话全程审计 · Agent/MCP 不开放终端"
        actions={
          <div className="flex gap-2">
            {connected ? (
              <Button size="sm" onClick={() => setRetry((v) => v + 1)} disabled={!host}>
                <RefreshCw size={13} />重连
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => setConnected(true)} disabled={!host || !canConnect}>
                <Plug size={13} />连接
              </Button>
            )}
            {connected ? (
              <Button size="sm" onClick={() => setConnected(false)}>
                断开
              </Button>
            ) : null}
            <Button size="sm" onClick={() => termRef.current?.clear()} disabled={!connected}>
              <Eraser size={13} />清屏
            </Button>
          </div>
        }
      />

      {!canConnect ? (
        <GlassPanel>
          <EmptyState
            icon={<TerminalSquare size={18} />}
            title="当前账号无终端权限"
            description="Web 终端仅对管理员与运维角色开放；只读账号可使用资产与凭据元数据功能。"
          />
        </GlassPanel>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-[320px]">
              <Select
                value={hostId}
                onValueChange={(v) => {
                  setHostId(v);
                  setConnected(false);
                }}
                disabled={!hosts.length}
              >
                <SelectTrigger>
                  <SelectValue placeholder={hostsQuery.isLoading ? '加载主机…' : '选择主机'} />
                </SelectTrigger>
                <SelectContent>
                  {hosts.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name} · {h.address} · {h.sshUser}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
            <span className="text-[11.5px] text-[var(--ink-3)]">选择主机后点击「连接」；终端输出与输入均由服务端审计。</span>
          </div>

          {hostsQuery.error ? (
            <Callout tone="warn">加载服务器列表失败：{hostsQuery.error.message}</Callout>
          ) : !hostsQuery.isLoading && !hosts.length ? (
            <GlassPanel>
              <EmptyState
                icon={<TerminalSquare size={18} />}
                title="还没有可用服务器"
                description="请先在「服务器」页面添加主机并配置 SSH 凭据，然后回到这里打开终端。"
              />
            </GlassPanel>
          ) : (
            <div className="term">
              <div className="term-bar">
                <i className="dot dot-bad" />
                <i className="dot dot-warn" />
                <i className="dot dot-ok" />
                <span className="mono ml-1 text-[11.5px] text-[#7c8ba5]">
                  {host ? `ssh ${host.sshUser}@${host.address} -p ${host.port}` : '等待选择主机'}
                </span>
                <span className="ml-auto badge badge-neutral">会话已审计</span>
              </div>
              <div className="term-body">
                {' '}
                <div ref={containerRef} className="term-xterm" />
                {!connected ? (
                  <div className="grid h-full place-items-center text-[12px] text-[#7c8ba5]">
                    点击右上角「连接」建立 SSH 会话
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-3.5">
        <Callout>
          正式连接使用 xterm.js + WebSocket + ssh2；窗口尺寸变化会同步 PTY（resize），断开后可点「重连」。仅 admin / operator 可用，Agent 令牌永不可访问终端。
        </Callout>
      </div>
    </>
  );
}
