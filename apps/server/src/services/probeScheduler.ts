import type { FastifyInstance } from 'fastify';
import { systemActor } from '../lib/actor.js';
import { probeMany } from './probe.js';
import { probeSettings } from './settings.js';

let lastHourlyAt = 0;
let lastDailyKey = '';
let running = false;

async function tick(app: FastifyInstance): Promise<void> {
  if (running) return;
  const cfg = await probeSettings(app.db);
  if (cfg.schedule === 'off') return;
  const now = new Date();
  if (cfg.schedule === 'hourly' && Date.now() - lastHourlyAt < 3600_000) return;
  if (cfg.schedule === 'daily') {
    const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (now.getHours() !== 3 || lastDailyKey === dayKey) return;
    lastDailyKey = dayKey;
  }
  if (cfg.schedule === 'hourly') lastHourlyAt = Date.now();

  const rows = await app.db
    .selectFrom('hosts')
    .select('id')
    .where((eb) => eb.or([eb('credential_id', 'is not', null), eb('keypair_id', 'is not', null)]))
    .execute();
  if (!rows.length) return;
  running = true;
  try {
    const results = await probeMany(app.db, app.config, rows.map((r) => r.id), systemActor('scheduler'));
    app.log.info(
      { schedule: cfg.schedule, total: results.length, failed: results.filter((r) => !r.ok).length },
      'scheduled probe finished',
    );
  } catch (e) {
    app.log.warn({ err: e }, 'scheduled probe failed');
  } finally {
    running = false;
  }
}

export function startProbeScheduler(app: FastifyInstance): void {
  const timer = setInterval(() => {
    void tick(app);
  }, 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
