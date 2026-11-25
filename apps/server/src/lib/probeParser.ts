export interface ProbeDisk {
  mount: string;
  filesystem: string;
  sizeKb: number;
  usedKb: number;
  usePct: number;
}

export interface ProbeIp {
  iface: string;
  address: string;
}

export interface ProbeFacts {
  hostname?: string;
  os?: string;
  kernel?: string;
  arch?: string;
  cpuModel?: string;
  cpuCores?: number;
  memTotalMb?: number;
  disks?: ProbeDisk[];
  ips?: ProbeIp[];
  loadAvg?: string;
  uptimeSec?: number;
  virtualization?: string;
  containers?: number | null;
  timezone?: string;
}

export interface ParseResult {
  facts: ProbeFacts;
  partial: string[];
}

export const PROBE_SCRIPT = `
echo '@@HOSTNAME@@'; hostname 2>/dev/null
echo '@@OS@@'; grep -E '^PRETTY_NAME=' /etc/os-release 2>/dev/null | head -1
echo '@@UNAME@@'; uname -srm 2>/dev/null
echo '@@CORES@@'; nproc 2>/dev/null
echo '@@CPU@@'; grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2
echo '@@MEM@@'; grep -E '^MemTotal:' /proc/meminfo 2>/dev/null | head -1
echo '@@DF@@'; df -PB1 2>/dev/null | tail -n +2
echo '@@IP@@'; (ip -j addr 2>/dev/null || ip addr 2>/dev/null || echo '[]')
echo '@@LOAD@@'; cat /proc/loadavg 2>/dev/null
echo '@@UPTIME@@'; cat /proc/uptime 2>/dev/null
echo '@@VIRT@@'; (systemd-detect-virt 2>/dev/null || echo unknown)
echo '@@TZ@@'; date +%Z 2>/dev/null
echo '@@DOCKER@@'; (command -v docker >/dev/null 2>&1 && docker ps -q 2>/dev/null | wc -l) || echo none
`.trim();

function sections(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current = '';
  for (const line of raw.split('\n')) {
    const m = line.match(/^@@([A-Z]+)@@(.*)$/);
    if (m) {
      current = m[1]!;
      out[current] = m[2]!.trim();
      continue;
    }
    if (current) {
      out[current] += '\n' + line;
    }
  }
  return out;
}

function parseOs(line: string): string | undefined {
  const m = line.match(/PRETTY_NAME="?([^"]+)"?/);
  return m?.[1]?.trim();
}

function parseDisks(block: string): ProbeDisk[] {
  const disks: ProbeDisk[] = [];
  for (const line of block.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [filesystem, size, used, , capacity, mount] = parts;
    if (!filesystem || !mount) continue;
    if (['tmpfs', 'devtmpfs', 'sysfs', 'proc', 'cgroup', 'overlay', 'shm'].includes(filesystem))
      continue;
    const sizeKb = Number(size) / 1024;
    const usedKb = Number(used) / 1024;
    const usePct = Number(String(capacity).replace('%', ''));
    if (!Number.isFinite(sizeKb) || !Number.isFinite(usedKb)) continue;
    disks.push({ mount, filesystem, sizeKb, usedKb, usePct: Number.isFinite(usePct) ? usePct : 0 });
    if (disks.length >= 8) break;
  }
  return disks;
}

function parseIps(block: string): ProbeIp[] {
  const ips: ProbeIp[] = [];
  try {
    const json = JSON.parse(block) as Array<{
      ifname?: string;
      addr_info?: Array<{ family?: string; local?: string }>;
    }>;
    for (const iface of json) {
      for (const a of iface.addr_info ?? []) {
        if (a.family === 'inet' && a.local) ips.push({ iface: iface.ifname ?? '', address: a.local });
      }
    }
    if (ips.length) return ips;
  } catch {
    /* fallback below */
  }
  let iface = '';
  for (const line of block.split('\n')) {
    const m = line.match(/(\d+):\s+([^:]+):/);
    if (m) iface = m[2]!;
    const ip = line.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (ip) ips.push({ iface, address: ip[1]! });
  }
  return ips.slice(0, 12);
}

export function parseProbe(raw: string): ParseResult {
  const s = sections(raw);
  const facts: ProbeFacts = {};
  const partial: string[] = [];
  const required: Array<[keyof ProbeFacts, string, string]> = [];

  if (s.HOSTNAME) facts.hostname = s.HOSTNAME.split('\n')[0]!.trim();
  else partial.push('hostname');

  if (s.OS) {
    const os = parseOs(s.OS);
    if (os) facts.os = os;
    else partial.push('os');
  } else partial.push('os');

  if (s.UNAME) {
    const parts = s.UNAME.split(/\s+/);
    if (parts[0]) facts.kernel = parts[0];
    if (parts[1]) facts.arch = parts[1] === 'Linux' ? parts[1] : parts[1];
    // expected: Linux 6.8.0-45-generic x86_64
    if (parts.length >= 3) facts.arch = parts[2];
    if (parts[1]) facts.kernel = parts[1];
  } else partial.push('uname');

  if (s.CORES) {
    const n = Number(s.CORES.trim());
    if (Number.isFinite(n) && n > 0) facts.cpuCores = n;
  } else partial.push('cores');

  if (s.CPU) facts.cpuModel = s.CPU.split('\n')[0]!.trim();
  else partial.push('cpu');

  if (s.MEM) {
    const m = s.MEM.match(/MemTotal:\s*(\d+)\s*kB/i);
    if (m) facts.memTotalMb = Math.round(Number(m[1]) / 1024);
    else partial.push('mem');
  } else partial.push('mem');

  if (s.DF) {
    const disks = parseDisks(s.DF);
    if (disks.length) facts.disks = disks;
    else partial.push('disk');
  } else partial.push('disk');

  if (s.IP) {
    const ips = parseIps(s.IP);
    if (ips.length) facts.ips = ips;
    else partial.push('ip');
  } else partial.push('ip');

  if (s.LOAD) {
    const parts = s.LOAD.trim().split(/\s+/);
    if (parts.length >= 3) facts.loadAvg = parts.slice(0, 3).join(' / ');
    else partial.push('load');
  } else partial.push('load');

  if (s.UPTIME) {
    const up = Number(s.UPTIME.trim().split(/\s+/)[0]);
    if (Number.isFinite(up)) facts.uptimeSec = Math.round(up);
    else partial.push('uptime');
  } else partial.push('uptime');

  if (s.VIRT) facts.virtualization = s.VIRT.split('\n')[0]!.trim();
  else partial.push('virt');

  if (s.TZ) facts.timezone = s.TZ.split('\n')[0]!.trim();
  else partial.push('tz');

  if (s.DOCKER) {
    const v = s.DOCKER.trim();
    facts.containers = v === 'none' || v === '' ? null : Number(v);
  }

  for (const [k, label] of required) {
    if (!facts[k]) partial.push(label);
  }
  return { facts, partial };
}
