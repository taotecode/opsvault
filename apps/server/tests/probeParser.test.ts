import { describe, expect, it } from 'vitest';
import { parseProbe } from '../src/lib/probeParser.js';

const GOOD = `@@HOSTNAME@@
ali-hk-web-01
@@OS@@
PRETTY_NAME="Ubuntu 24.04 LTS"
@@UNAME@@
Linux 6.8.0-45-generic x86_64
@@CORES@@
4
@@CPU@@
Intel Xeon Platinum 8269CY @ 2.50GHz
@@MEM@@
MemTotal:       8123456 kB
@@DF@@
/dev/vda1 107374182400 50331648000 57042534400 47% /
tmpfs 4096000 0 4096000 0% /dev/shm
/dev/vdb1 214748364800 171798691840 42949672960 80% /data
@@IP@@
[{"ifname":"eth0","addr_info":[{"family":"inet","local":"47.242.101.18"},{"family":"inet6","local":"::1"}]}]
@@LOAD@@
0.82 0.76 0.71 2/192 12345
@@UPTIME@@
12268800.00 456789.00
@@VIRT@@
kvm
@@TZ@@
CST
@@DOCKER@@
3`;

describe('probe parser', () => {
  it('parses a complete probe output', () => {
    const { facts, partial } = parseProbe(GOOD);
    expect(partial).toEqual([]);
    expect(facts.hostname).toBe('ali-hk-web-01');
    expect(facts.os).toBe('Ubuntu 24.04 LTS');
    expect(facts.kernel).toBe('6.8.0-45-generic');
    expect(facts.arch).toBe('x86_64');
    expect(facts.cpuCores).toBe(4);
    expect(facts.cpuModel).toContain('Xeon Platinum');
    expect(facts.memTotalMb).toBe(7933);
    expect(facts.disks?.length).toBe(2);
    expect(facts.disks?.[1]).toMatchObject({ mount: '/data', usePct: 80 });
    expect(facts.ips?.[0]).toEqual({ iface: 'eth0', address: '47.242.101.18' });
    expect(facts.loadAvg).toBe('0.82 / 0.76 / 0.71');
    expect(facts.uptimeSec).toBe(12268800);
    expect(facts.virtualization).toBe('kvm');
    expect(facts.timezone).toBe('CST');
    expect(facts.containers).toBe(3);
  });

  it('marks partial output when sections are missing', () => {
    const { facts, partial } = parseProbe('@@HOSTNAME@@\nbox\n@@OS@@\nPRETTY_NAME="Debian 12"');
    expect(facts.hostname).toBe('box');
    expect(facts.os).toBe('Debian 12');
    expect(partial).toContain('uname');
    expect(partial).toContain('disk');
    expect(partial).toContain('ip');
  });

  it('falls back to text ip parsing when JSON is unavailable', () => {
    const raw = `@@IP@@
2: eth0: <BROADCAST> mtu 1500
    inet 124.70.66.35/24 brd 124.70.66.255 scope global eth0`;
    const { facts } = parseProbe(raw);
    expect(facts.ips).toEqual([{ iface: 'eth0', address: '124.70.66.35' }]);
  });
});
