import db from '../db/database.ts';
import { executeVisit } from './simulator.ts';
import { getActiveProxies } from './proxyChecker.ts';

export interface CampaignConfig {
  id: string;
  name: string;
  urls: string[] | string;
  visitsPerUrl: number;
  durationMin: number;
  durationMax: number;
  intervalSeconds: number;
  intensity: 'low' | 'medium' | 'high';
  headless: boolean;
  useProxies: boolean;
  useTor: boolean;
  scrollMode: 'scroll_only' | 'scroll_clicks';
  dryRun: boolean;
  scheduledTime?: string;
}

// Active campaign controllers
const activeCampaigns = new Map<string, { paused: boolean; cancelled: boolean }>();
// Event listeners for SSE
const sseClients = new Set<(data: any) => void>();

export function addSseClient(client: (data: any) => void) {
  sseClients.add(client);
  return () => {
    sseClients.delete(client);
  };
}

export function broadcastEvent(event: { type: string; data: any }) {
  const deadClients: ((data: any) => void)[] = [];
  sseClients.forEach((client) => {
    try {
      client(event);
    } catch {
      deadClients.push(client);
    }
  });
  deadClients.forEach((client) => sseClients.delete(client));
}

export async function startCampaign(config: CampaignConfig) {
  const control = { paused: false, cancelled: false };
  activeCampaigns.set(config.id, control);

  const urlsSerialized = typeof config.urls === 'string' ? config.urls : JSON.stringify(config.urls);

  // Save campaign to DB
  db.run(
    `INSERT OR REPLACE INTO campaigns (id, name, urls, visits_per_url, duration_min, duration_max, interval_seconds, intensity, headless, use_proxies, use_tor, scroll_mode, dry_run, status, scheduled_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    [
      config.id,
      config.name,
      urlsSerialized,
      config.visitsPerUrl,
      config.durationMin,
      config.durationMax,
      config.intervalSeconds,
      config.intensity,
      config.headless ? 1 : 0,
      config.useProxies ? 1 : 0,
      config.useTor ? 1 : 0,
      config.scrollMode,
      config.dryRun ? 1 : 0,
      config.scheduledTime || null
    ]
  );

  broadcastEvent({ type: 'campaign_started', data: { id: config.id, name: config.name } });

  // Run campaign asynchronously
  runCampaignQueue(config, control).catch((err) => {
    console.error(`Error in campaign ${config.id}:`, err);
    db.run(`UPDATE campaigns SET status = 'failed' WHERE id = ?`, [config.id]);
    broadcastEvent({ type: 'campaign_failed', data: { id: config.id, error: err.message } });
    activeCampaigns.delete(config.id);
  });
}

export function pauseCampaign(id: string) {
  const control = activeCampaigns.get(id);
  if (control) {
    control.paused = true;
    db.run(`UPDATE campaigns SET status = 'paused' WHERE id = ?`, [id]);
    broadcastEvent({ type: 'campaign_paused', data: { id } });
  }
}

export function resumeCampaign(id: string) {
  const control = activeCampaigns.get(id);
  if (control) {
    control.paused = false;
    db.run(`UPDATE campaigns SET status = 'running' WHERE id = ?`, [id]);
    broadcastEvent({ type: 'campaign_resumed', data: { id } });
  }
}

export function cancelCampaign(id: string) {
  const control = activeCampaigns.get(id);
  if (control) {
    control.cancelled = true;
    db.run(`UPDATE campaigns SET status = 'cancelled' WHERE id = ?`, [id]);
    broadcastEvent({ type: 'campaign_cancelled', data: { id } });
  }
  activeCampaigns.delete(id);
}

async function runCampaignQueue(config: CampaignConfig, control: { paused: boolean; cancelled: boolean }) {
  let completedCount = 0;
  let failedCount = 0;
  let proxies: any[] = [];

  let urls: string[] = [];
  if (Array.isArray(config.urls)) {
    urls = config.urls;
  } else {
    try {
      urls = JSON.parse(config.urls || '[]');
    } catch {
      urls = [config.urls];
    }
  }

  if (urls.length === 0) {
    throw new Error('No valid URLs provided for campaign');
  }

  if (config.useProxies) {
    try {
      proxies = await getActiveProxies();
    } catch (e) {
      console.warn('Unable to retrieve active proxies, continuing without proxies:', e);
    }
  }

  const totalVisits = urls.length * config.visitsPerUrl;

  for (let visitIndex = 0; visitIndex < config.visitsPerUrl; visitIndex++) {
    for (const url of urls) {
      if (control.cancelled) return;

      // Check pause
      while (control.paused && !control.cancelled) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (control.cancelled) return;

      // Select proxy
      let proxyUrl: string | undefined = undefined;
      if (config.useProxies && proxies.length > 0) {
        const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
        proxyUrl = randomProxy.proxy_url;
      }

      const durationSeconds = Math.floor(
        Math.random() * (config.durationMax - config.durationMin + 1) + config.durationMin
      );

      broadcastEvent({
        type: 'visit_started',
        data: { campaignId: config.id, url, visitIndex: visitIndex + 1 }
      });

      try {
        const result = await executeVisit({
          url,
          durationSeconds,
          headless: config.headless,
          proxy: proxyUrl,
          scrollMode: config.scrollMode,
          dryRun: config.dryRun,
          intensity: config.intensity
        });

        completedCount++;

        // Save visit log
        db.run(
          `INSERT INTO visit_logs (campaign_id, url, status, proxy_used, duration_actual, actions_performed, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            config.id,
            url,
            result.status,
            result.proxyUsed,
            result.durationActual,
            JSON.stringify(result.actionsPerformed),
            result.contentHash
          ]
        );

        broadcastEvent({
          type: 'visit_completed',
          data: {
            campaignId: config.id,
            url,
            status: result.status,
            proxyUsed: result.proxyUsed,
            durationActual: result.durationActual,
            actions: result.actionsPerformed,
            completedCount,
            totalVisits
          }
        });
      } catch (err: any) {
        failedCount++;
        db.run(
          `INSERT INTO visit_logs (campaign_id, url, status, proxy_used, error_message) VALUES (?, ?, 'failed', ?, ?)`,
          [config.id, url, proxyUrl || 'Local', err.message]
        );

        broadcastEvent({
          type: 'visit_failed',
          data: {
            campaignId: config.id,
            url,
            error: err.message,
            failedCount,
            totalVisits
          }
        });
      }

      // Interval between visits
      const interval = Math.max(1, config.intervalSeconds) * 1000;
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  // Campaign completed
  const statsJson = JSON.stringify({ completedCount, failedCount, totalVisits });
  db.run(
    `UPDATE campaigns SET status = 'completed', completed_at = CURRENT_TIMESTAMP, stats = ? WHERE id = ?`,
    [statsJson, config.id]
  );

  broadcastEvent({
    type: 'campaign_completed',
    data: { id: config.id, completedCount, failedCount, totalVisits }
  });

  activeCampaigns.delete(config.id);
}
