import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './src/db/database.ts';
import { runProxyHealthCheck } from './src/backend/proxyChecker.ts';
import { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, addSseClient } from './src/backend/scheduler.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

// Optional Authentication configuration for Headless mode
const HEADLESS_AUTH_KEY = process.env.HEADLESS_AUTH_KEY;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

async function startServer() {
  const app = express();
  app.use(express.json());

  // Enable CORS for cross-origin frontend (e.g. Cloudflare Pages connecting to Render backend)
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Authentication Middleware for protected Headless campaigns
  const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const isEnforced = REQUIRE_AUTH || Boolean(HEADLESS_AUTH_KEY);
    if (!isEnforced) {
      return next(); // Free access if auth is not configured
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token || (HEADLESS_AUTH_KEY && token !== HEADLESS_AUTH_KEY)) {
      return res.status(401).json({
        error: 'Unauthorized: Token de acceso no válido o ausente para el modo Headless.'
      });
    }
    next();
  };

  // Health check endpoint for containers / Render monitoring
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      mode: 'headless-playwright',
      authRequired: REQUIRE_AUTH || Boolean(HEADLESS_AUTH_KEY),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Auth Status check endpoint
  app.get('/api/auth/status', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const isEnforced = REQUIRE_AUTH || Boolean(HEADLESS_AUTH_KEY);
    const isValid = !isEnforced || (HEADLESS_AUTH_KEY ? token === HEADLESS_AUTH_KEY : true);
    res.json({ authRequired: isEnforced, authenticated: isValid });
  });

  // SSE endpoint for live logs and campaign status
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const removeClient = addSseClient((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on('close', () => {
      removeClient();
    });
  });

  // Proxy Routes
  app.get('/api/proxies', (req, res) => {
    db.all(`SELECT * FROM proxies`, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  });

  app.post('/api/proxies/check', async (req, res) => {
    try {
      const results = await runProxyHealthCheck();
      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/proxies', (req, res) => {
    const { proxy_url, type = 'http' } = req.body;
    if (!proxy_url) return res.status(400).json({ error: 'proxy_url is required' });

    db.run(
      `INSERT OR IGNORE INTO proxies (proxy_url, type, status) VALUES (?, ?, 'untested')`,
      [proxy_url, type],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this?.lastID || Date.now() });
      }
    );
  });

  app.delete('/api/proxies/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM proxies WHERE id = ?`, [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: Number(id) });
    });
  });

  // Campaign Routes
  app.get('/api/campaigns', (req, res) => {
    db.all(`SELECT * FROM campaigns ORDER BY created_at DESC`, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  });

  app.post('/api/campaigns', authenticate, async (req, res) => {
    const {
      name,
      urls,
      visitsPerUrl = 3,
      durationMin = 15,
      durationMax = 30,
      intervalSeconds = 5,
      intensity = 'medium',
      headless = true,
      useProxies = false,
      useTor = false,
      scrollMode = 'scroll_clicks',
      dryRun = false,
      scheduledTime
    } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Valid list of URLs is required' });
    }

    const campaignId = 'camp_' + Date.now() + Math.random().toString(36).substring(2, 7);
    const campaignName = name || `Campaña ${new Date().toLocaleTimeString()}`;

    const config = {
      id: campaignId,
      name: campaignName,
      urls,
      visitsPerUrl: Number(visitsPerUrl),
      durationMin: Number(durationMin),
      durationMax: Number(durationMax),
      intervalSeconds: Number(intervalSeconds),
      intensity,
      headless: Boolean(headless),
      useProxies: Boolean(useProxies),
      useTor: Boolean(useTor),
      scrollMode,
      dryRun: Boolean(dryRun),
      scheduledTime
    };

    if (scheduledTime && new Date(scheduledTime).getTime() > Date.now()) {
      db.run(
        `INSERT INTO campaigns (id, name, urls, visits_per_url, duration_min, duration_max, interval_seconds, intensity, headless, use_proxies, use_tor, scroll_mode, dry_run, status, scheduled_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
        [
          campaignId,
          campaignName,
          JSON.stringify(urls),
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
          scheduledTime
        ],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          const delay = new Date(scheduledTime).getTime() - Date.now();
          if (delay < 2147483647) {
            setTimeout(() => {
              startCampaign(config);
            }, delay);
          }
          res.json({ success: true, campaignId, status: 'scheduled' });
        }
      );
    } else {
      startCampaign(config);
      res.json({ success: true, campaignId, status: 'running' });
    }
  });

  app.post('/api/campaigns/:id/control', (req, res) => {
    const { id } = req.params;
    const { action } = req.body;

    if (action === 'pause') {
      pauseCampaign(id);
    } else if (action === 'resume') {
      resumeCampaign(id);
    } else if (action === 'cancel') {
      cancelCampaign(id);
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    res.json({ success: true, action });
  });

  app.delete('/api/campaigns/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM campaigns WHERE id = ?`, [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id });
    });
  });

  app.get('/api/campaigns/:id/logs', (req, res) => {
    const { id } = req.params;
    db.all(`SELECT * FROM visit_logs WHERE campaign_id = ? ORDER BY timestamp DESC`, [id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  });

  app.get('/api/campaigns/:id/export', (req, res) => {
    const { id } = req.params;
    const format = req.query.format || 'json';

    db.get(`SELECT * FROM campaigns WHERE id = ?`, [id], (err, campaign: any) => {
      if (err || !campaign) return res.status(404).json({ error: 'Campaign not found' });

      db.all(`SELECT * FROM visit_logs WHERE campaign_id = ?`, [id], (errLogs, logs) => {
        if (errLogs) return res.status(500).json({ error: errLogs.message });

        const logList = logs || [];
        const report = { campaign, logs: logList };

        if (format === 'csv') {
          let csv = 'ID,URL,Status,Proxy,Duration (s),Timestamp\n';
          logList.forEach((l: any) => {
            const safeUrl = (l.url || '').replace(/"/g, '""');
            const safeProxy = (l.proxy_used || '').replace(/"/g, '""');
            csv += `"${l.id}","${safeUrl}","${l.status}","${safeProxy}",${l.duration_actual || 0},"${l.timestamp}"\n`;
          });
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename=campaign_${id}_report.csv`);
          return res.send(csv);
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=campaign_${id}_report.json`);
        res.json(report);
      });
    });
  });

  // Setup Vite middleware for development or serve static build for production
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Synthetic Traffic Server running on http://localhost:${port}`);
  });
}

startServer();
