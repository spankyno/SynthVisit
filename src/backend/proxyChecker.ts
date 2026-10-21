import axios from 'axios';
import db from '../db/database.ts';

export interface ProxyRecord {
  id: number;
  proxy_url: string;
  type: string;
  status: 'active' | 'dead' | 'untested';
  latency_ms: number;
  last_checked: string | null;
}

export async function checkProxy(proxyUrl: string): Promise<{ status: 'active' | 'dead'; latency: number }> {
  const start = Date.now();
  try {
    const proxyConfig = parseProxyUrl(proxyUrl);
    await axios.get('https://httpbin.org/ip', {
      proxy: proxyConfig,
      timeout: 4000,
      validateStatus: (status) => status === 200
    });
    const latency = Date.now() - start;
    return { status: 'active', latency };
  } catch {
    return { status: 'dead', latency: 0 };
  }
}

function parseProxyUrl(proxyUrl: string) {
  try {
    const parsed = new URL(proxyUrl);
    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: parseInt(parsed.port || '80', 10),
      auth: parsed.username ? { username: parsed.username, password: parsed.password } : undefined
    };
  } catch {
    return { host: proxyUrl, port: 80 };
  }
}

export async function runProxyHealthCheck(): Promise<ProxyRecord[]> {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM proxies`, async (err, rows: ProxyRecord[]) => {
      if (err) {
        return reject(err);
      }

      const results: ProxyRecord[] = [];
      const list = rows || [];

      for (const proxy of list) {
        const result = await checkProxy(proxy.proxy_url);
        db.run(
          `UPDATE proxies SET status = ?, latency_ms = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?`,
          [result.status, result.latency, proxy.id]
        );
        results.push({
          ...proxy,
          status: result.status,
          latency_ms: result.latency,
          last_checked: new Date().toISOString()
        });
      }
      resolve(results);
    });
  });
}

export function getActiveProxies(): Promise<ProxyRecord[]> {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM proxies WHERE status = 'active'`, (err, rows: ProxyRecord[]) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}
