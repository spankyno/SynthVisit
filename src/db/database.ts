import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFilePath = path.resolve(__dirname, '../../traffic_sim.db.json');

interface DbSchema {
  campaigns: any[];
  visit_logs: any[];
  proxies: any[];
}

let dbData: DbSchema = {
  campaigns: [],
  visit_logs: [],
  proxies: [
    { id: 1, proxy_url: 'http://103.152.112.162:80', type: 'http', status: 'untested', latency_ms: 0, last_checked: null },
    { id: 2, proxy_url: 'http://47.74.152.29:8888', type: 'http', status: 'untested', latency_ms: 0, last_checked: null },
    { id: 3, proxy_url: 'http://20.205.61.140:80', type: 'http', status: 'untested', latency_ms: 0, last_checked: null },
    { id: 4, proxy_url: 'http://139.59.90.170:3128', type: 'http', status: 'untested', latency_ms: 0, last_checked: null },
    { id: 5, proxy_url: 'http://159.203.86.134:3128', type: 'http', status: 'untested', latency_ms: 0, last_checked: null }
  ]
};

function loadDb() {
  try {
    if (fs.existsSync(dbFilePath)) {
      const raw = fs.readFileSync(dbFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      dbData = {
        campaigns: parsed.campaigns || [],
        visit_logs: parsed.visit_logs || [],
        proxies: parsed.proxies && parsed.proxies.length > 0 ? parsed.proxies : dbData.proxies
      };
    } else {
      saveDb();
    }
  } catch (e) {
    // Keep in-memory DB if disk read fails (read-only systems like Vercel / Cloudflare)
    console.warn('Notice: Running JSON database in-memory mode:', e);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(dbFilePath, JSON.stringify(dbData, null, 2), 'utf-8');
  } catch (e) {
    // Graceful fallback if filesystem is read-only
  }
}

loadDb();

export const db = {
  serialize(callback: () => void) {
    callback();
  },

  run(
    sql: string,
    params: any[] | ((this: { lastID: number; changes: number }, err?: Error | null) => void) = [],
    callback?: (this: { lastID: number; changes: number }, err?: Error | null) => void
  ) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }

    let callbackInvoked = false;
    const invokeCallback = (lastID = 0, changes = 1, err: Error | null = null) => {
      if (!callbackInvoked && callback) {
        callbackInvoked = true;
        callback.call({ lastID, changes }, err);
      }
    };

    try {
      const cleanSql = sql.trim().toUpperCase();

      if (cleanSql.startsWith('CREATE TABLE')) {
        invokeCallback(0, 0);
        return;
      }

      if (cleanSql.startsWith('INSERT')) {
        if (cleanSql.includes('INTO CAMPAIGNS')) {
          const [
            id,
            name,
            urls,
            visits_per_url,
            duration_min,
            duration_max,
            interval_seconds,
            intensity,
            headless,
            use_proxies,
            use_tor,
            scroll_mode,
            dry_run,
            status,
            scheduled_time
          ] = params;

          const existingIdx = dbData.campaigns.findIndex((c) => c.id === id);
          const createdAt = existingIdx >= 0 ? dbData.campaigns[existingIdx].created_at : new Date().toISOString();

          const newCamp = {
            id,
            name,
            urls: typeof urls === 'string' ? urls : JSON.stringify(urls),
            visits_per_url,
            duration_min,
            duration_max,
            interval_seconds,
            intensity,
            headless,
            use_proxies,
            use_tor,
            scroll_mode,
            dry_run,
            status,
            scheduled_time: scheduled_time || null,
            created_at: createdAt,
            completed_at: null,
            stats: null
          };

          if (existingIdx >= 0) {
            dbData.campaigns[existingIdx] = { ...dbData.campaigns[existingIdx], ...newCamp };
          } else {
            dbData.campaigns.unshift(newCamp);
          }
          saveDb();
          invokeCallback(dbData.campaigns.length, 1);
          return;
        } else if (cleanSql.includes('INTO VISIT_LOGS')) {
          const [campaign_id, url, status, proxy_used, duration_actual, actions_performed, content_hash, error_message] = params;
          const newLog = {
            id: dbData.visit_logs.length + 1,
            campaign_id,
            url,
            status,
            proxy_used,
            duration_actual: duration_actual || 0,
            actions_performed: typeof actions_performed === 'string' ? actions_performed : JSON.stringify(actions_performed || []),
            content_hash: content_hash || '',
            error_message: error_message || '',
            timestamp: new Date().toISOString()
          };
          dbData.visit_logs.unshift(newLog);
          saveDb();
          invokeCallback(newLog.id, 1);
          return;
        } else if (cleanSql.includes('INTO PROXIES')) {
          const [proxy_url, type] = params;
          const existing = dbData.proxies.find((p) => p.proxy_url === proxy_url);
          if (!existing) {
            const newProxy = {
              id: dbData.proxies.length + 1,
              proxy_url,
              type: type || 'http',
              status: 'untested',
              latency_ms: 0,
              last_checked: null
            };
            dbData.proxies.push(newProxy);
            saveDb();
            invokeCallback(newProxy.id, 1);
          } else {
            invokeCallback(existing.id, 0);
          }
          return;
        }
      } else if (cleanSql.startsWith('UPDATE')) {
        if (cleanSql.includes('CAMPAIGNS')) {
          const id = params[params.length - 1];
          const camp = dbData.campaigns.find((c) => c.id === id);
          if (camp) {
            if (cleanSql.includes("STATUS = 'COMPLETED'") || cleanSql.includes('STATUS = "COMPLETED"')) {
              camp.status = 'completed';
              camp.completed_at = new Date().toISOString();
              // Fix: Correctly assign stats passed as first parameter
              if (params.length >= 2) {
                camp.stats = typeof params[0] === 'string' ? params[0] : JSON.stringify(params[0]);
              }
            } else if (cleanSql.includes("STATUS = 'FAILED'")) {
              camp.status = 'failed';
            } else if (cleanSql.includes("STATUS = 'RUNNING'")) {
              camp.status = 'running';
            } else if (cleanSql.includes("STATUS = 'PAUSED'")) {
              camp.status = 'paused';
            } else if (cleanSql.includes("STATUS = 'CANCELLED'")) {
              camp.status = 'cancelled';
            }
            saveDb();
          }
          invokeCallback(0, 1);
          return;
        } else if (cleanSql.includes('PROXIES')) {
          const [status, latency_ms, id] = params;
          const proxy = dbData.proxies.find((p) => p.id === id);
          if (proxy) {
            proxy.status = status;
            proxy.latency_ms = latency_ms;
            proxy.last_checked = new Date().toISOString();
            saveDb();
          }
          invokeCallback(0, 1);
          return;
        }
      } else if (cleanSql.startsWith('DELETE')) {
        if (cleanSql.includes('FROM CAMPAIGNS')) {
          const id = params[0];
          dbData.campaigns = dbData.campaigns.filter((c) => c.id !== id);
          dbData.visit_logs = dbData.visit_logs.filter((l) => l.campaign_id !== id);
          saveDb();
          invokeCallback(0, 1);
          return;
        } else if (cleanSql.includes('FROM PROXIES')) {
          const id = Number(params[0]);
          dbData.proxies = dbData.proxies.filter((p) => p.id !== id);
          saveDb();
          invokeCallback(0, 1);
          return;
        }
      }

      invokeCallback(0, 1);
    } catch (err: any) {
      invokeCallback(0, 0, err);
    }
  },

  all(
    sql: string,
    params: any[] | ((err: Error | null, rows: any[]) => void) = [],
    callback?: (err: Error | null, rows: any[]) => void
  ) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const cleanSql = sql.trim().toUpperCase();
      let rows: any[] = [];

      if (cleanSql.includes('FROM CAMPAIGNS')) {
        rows = [...dbData.campaigns].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      } else if (cleanSql.includes('FROM PROXIES')) {
        if (cleanSql.includes("WHERE STATUS = 'ACTIVE'") || cleanSql.includes('WHERE STATUS = "ACTIVE"')) {
          rows = dbData.proxies.filter((p) => p.status === 'active');
        } else {
          rows = [...dbData.proxies];
        }
      } else if (cleanSql.includes('FROM VISIT_LOGS')) {
        if (params.length > 0) {
          const campaignId = params[0];
          rows = dbData.visit_logs.filter((l) => l.campaign_id === campaignId);
        } else {
          rows = [...dbData.visit_logs];
        }
        rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      if (callback) callback(null, rows);
    } catch (err: any) {
      if (callback) callback(err, []);
    }
  },

  get(
    sql: string,
    params: any[] | ((err: Error | null, row: any) => void) = [],
    callback?: (err: Error | null, row: any) => void
  ) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const cleanSql = sql.trim().toUpperCase();
      let row: any = null;

      if (cleanSql.includes('FROM CAMPAIGNS')) {
        const id = params[0];
        row = dbData.campaigns.find((c) => c.id === id) || null;
      }

      if (callback) callback(null, row);
    } catch (err: any) {
      if (callback) callback(err, null);
    }
  }
};

export default db;
