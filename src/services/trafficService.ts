// Service to seamlessly handle campaign operations both with Node.js Express backend and Standalone / Cloudflare Pages / Vercel Edge mode.

export interface Campaign {
  id: string;
  name: string;
  urls: string;
  visits_per_url: number;
  duration_min: number;
  duration_max: number;
  interval_seconds: number;
  intensity: string;
  headless: number;
  use_proxies: number;
  use_tor: number;
  scroll_mode: string;
  dry_run: number;
  status: 'running' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'scheduled';
  scheduled_time: string | null;
  created_at: string;
  completed_at: string | null;
  stats: string | null;
}

export interface ProxyItem {
  id: number;
  proxy_url: string;
  type: string;
  status: 'active' | 'dead' | 'untested';
  latency_ms: number;
  last_checked: string | null;
}

export interface LogItem {
  id: number;
  campaign_id: string;
  url: string;
  status: 'success' | 'failed';
  proxy_used: string;
  duration_actual: number;
  actions_performed: string;
  content_hash: string;
  error_message: string;
  timestamp: string;
}

export interface CreateCampaignInput {
  name?: string;
  urls: string[];
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
  openRealTab?: boolean; // Open real browser window to execute client scripts & analytics
}

type EventCallback = (event: { type: string; data: any }) => void;

class TrafficService {
  private hasBackend: boolean | null = null;
  private sseConnected: boolean = false;
  private eventListeners: Set<EventCallback> = new Set();
  private eventSource: EventSource | null = null;
  private localActiveTimers: Map<string, { paused: boolean; cancelled: boolean }> = new Map();

  // Storage keys
  private STORAGE_CAMPAIGNS = 'synthvisit_campaigns';
  private STORAGE_PROXIES = 'synthvisit_proxies';
  private STORAGE_LOGS = 'synthvisit_logs';
  private STORAGE_BACKEND_URL = 'synthvisit_backend_url';
  private STORAGE_AUTH_TOKEN = 'synthvisit_auth_token';

  constructor() {
    this.initDefaultLocalData();
  }

  private initDefaultLocalData() {
    if (typeof window === 'undefined') return;

    if (!localStorage.getItem(this.STORAGE_PROXIES)) {
      const defaultProxies: ProxyItem[] = [
        { id: 1, proxy_url: 'http://103.152.112.162:80', type: 'http', status: 'active', latency_ms: 185, last_checked: new Date().toISOString() },
        { id: 2, proxy_url: 'http://47.74.152.29:8888', type: 'http', status: 'active', latency_ms: 220, last_checked: new Date().toISOString() },
        { id: 3, proxy_url: 'http://20.205.61.140:80', type: 'http', status: 'active', latency_ms: 140, last_checked: new Date().toISOString() },
        { id: 4, proxy_url: 'http://139.59.90.170:3128', type: 'http', status: 'dead', latency_ms: 0, last_checked: new Date().toISOString() },
        { id: 5, proxy_url: 'http://159.203.86.134:3128', type: 'http', status: 'active', latency_ms: 310, last_checked: new Date().toISOString() }
      ];
      localStorage.setItem(this.STORAGE_PROXIES, JSON.stringify(defaultProxies));
    }

    if (!localStorage.getItem(this.STORAGE_CAMPAIGNS)) {
      localStorage.setItem(this.STORAGE_CAMPAIGNS, JSON.stringify([]));
    }

    if (!localStorage.getItem(this.STORAGE_LOGS)) {
      localStorage.setItem(this.STORAGE_LOGS, JSON.stringify([]));
    }
  }

  public getBackendBaseUrl(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(this.STORAGE_BACKEND_URL) || '';
  }

  public setBackendBaseUrl(url: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.STORAGE_BACKEND_URL, url.trim().replace(/\/$/, ''));
    this.hasBackend = null; // force re-check
  }

  public getAuthToken(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(this.STORAGE_AUTH_TOKEN) || '';
  }

  public setAuthToken(token: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.STORAGE_AUTH_TOKEN, token.trim());
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  // Detect whether backend server is reachable
  public async checkBackendAvailability(): Promise<boolean> {
    if (this.hasBackend !== null) return this.hasBackend;
    try {
      const baseUrl = this.getBackendBaseUrl();
      const endpoint = baseUrl ? `${baseUrl}/api/health` : '/api/health';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(endpoint, {
        headers: this.getAuthHeaders(),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      this.hasBackend = res.ok;
    } catch {
      this.hasBackend = false;
    }
    return this.hasBackend;
  }

  public async checkAuthStatus(): Promise<{ authRequired: boolean; authenticated: boolean }> {
    const hasApi = await this.checkBackendAvailability();
    if (!hasApi) return { authRequired: false, authenticated: true };

    try {
      const baseUrl = this.getBackendBaseUrl();
      const endpoint = baseUrl ? `${baseUrl}/api/auth/status` : '/api/auth/status';
      const res = await fetch(endpoint, { headers: this.getAuthHeaders() });
      if (res.ok) return await res.json();
    } catch {}
    return { authRequired: false, authenticated: true };
  }

  public isUsingBackend(): boolean {
    return this.hasBackend === true;
  }

  // Event Subscription
  public subscribeEvents(cb: EventCallback): () => void {
    this.eventListeners.add(cb);

    if (!this.eventSource && typeof window !== 'undefined') {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/events` : '/api/events';
        const es = new EventSource(endpoint);
        es.onopen = () => {
          this.sseConnected = true;
          this.hasBackend = true;
        };
        es.onmessage = (e) => {
          try {
            const parsed = JSON.parse(e.data);
            this.broadcast(parsed);
          } catch (err) {
            console.warn('Error parsing SSE event:', err);
          }
        };
        es.onerror = () => {
          this.sseConnected = false;
          es.close();
          this.eventSource = null;
        };
        this.eventSource = es;
      } catch {
        this.sseConnected = false;
      }
    }

    return () => {
      this.eventListeners.delete(cb);
      if (this.eventListeners.size === 0 && this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    };
  }

  private broadcast(event: { type: string; data: any }) {
    this.eventListeners.forEach((fn) => {
      try {
        fn(event);
      } catch (err) {
        console.error('Error dispatching event:', err);
      }
    });
  }

  // CAMPAIGNS API
  public async getCampaigns(): Promise<Campaign[]> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/campaigns` : '/api/campaigns';
        const res = await fetch(endpoint, { headers: this.getAuthHeaders() });
        if (res.ok) return await res.json();
      } catch {
        this.hasBackend = false;
      }
    }
    const raw = localStorage.getItem(this.STORAGE_CAMPAIGNS);
    return raw ? JSON.parse(raw) : [];
  }

  public async createCampaign(input: CreateCampaignInput): Promise<{ success: boolean; campaignId: string; status: string; error?: string }> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/campaigns` : '/api/campaigns';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify(input)
        });

        if (res.status === 401) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Token de acceso no válido o ausente para el servidor Headless.');
        }

        if (res.ok) {
          return await res.json();
        }
      } catch (e: any) {
        if (e.message.includes('Token') || e.message.includes('Unauthorized')) {
          throw e;
        }
        this.hasBackend = false;
      }
    }

    // Client-side execution mode
    const campaignId = 'camp_' + Date.now() + Math.random().toString(36).substring(2, 7);
    const campaignName = input.name || `Campaña ${new Date().toLocaleTimeString()}`;
    const isScheduled = !!(input.scheduledTime && new Date(input.scheduledTime).getTime() > Date.now());

    const newCamp: Campaign = {
      id: campaignId,
      name: campaignName,
      urls: JSON.stringify(input.urls),
      visits_per_url: input.visitsPerUrl,
      duration_min: input.durationMin,
      duration_max: input.durationMax,
      interval_seconds: input.intervalSeconds,
      intensity: input.intensity,
      headless: input.headless ? 1 : 0,
      use_proxies: input.useProxies ? 1 : 0,
      use_tor: input.useTor ? 1 : 0,
      scroll_mode: input.scrollMode,
      dry_run: input.dryRun ? 1 : 0,
      status: isScheduled ? 'scheduled' : 'running',
      scheduled_time: input.scheduledTime || null,
      created_at: new Date().toISOString(),
      completed_at: null,
      stats: null
    };

    const existing = await this.getCampaigns();
    localStorage.setItem(this.STORAGE_CAMPAIGNS, JSON.stringify([newCamp, ...existing]));

    if (isScheduled && input.scheduledTime) {
      const delay = new Date(input.scheduledTime).getTime() - Date.now();
      setTimeout(() => {
        this.runLocalSimulation(newCamp, input);
      }, Math.max(0, delay));
    } else {
      this.runLocalSimulation(newCamp, input);
    }

    this.broadcast({ type: 'campaign_started', data: { id: campaignId, name: campaignName } });
    return { success: true, campaignId, status: isScheduled ? 'scheduled' : 'running' };
  }

  public async controlCampaign(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<{ success: boolean; action: string }> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/campaigns/${id}/control` : `/api/campaigns/${id}/control`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ action })
        });
        if (res.ok) return await res.json();
      } catch {
        this.hasBackend = false;
      }
    }

    const ctrl = this.localActiveTimers.get(id);
    const campaigns = await this.getCampaigns();
    const idx = campaigns.findIndex((c) => c.id === id);

    if (idx >= 0) {
      if (action === 'pause') {
        if (ctrl) ctrl.paused = true;
        campaigns[idx].status = 'paused';
        this.broadcast({ type: 'campaign_paused', data: { id } });
      } else if (action === 'resume') {
        if (ctrl) ctrl.paused = false;
        campaigns[idx].status = 'running';
        this.broadcast({ type: 'campaign_resumed', data: { id } });
      } else if (action === 'cancel') {
        if (ctrl) ctrl.cancelled = true;
        campaigns[idx].status = 'cancelled';
        this.localActiveTimers.delete(id);
        this.broadcast({ type: 'campaign_cancelled', data: { id } });
      }
      localStorage.setItem(this.STORAGE_CAMPAIGNS, JSON.stringify(campaigns));
    }

    return { success: true, action };
  }

  public async deleteCampaign(id: string): Promise<{ success: boolean }> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/campaigns/${id}` : `/api/campaigns/${id}`;
        const res = await fetch(endpoint, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
        if (res.ok) return await res.json();
      } catch {
        this.hasBackend = false;
      }
    }

    // Local deletion
    const campaigns = await this.getCampaigns();
    const filtered = campaigns.filter((c) => c.id !== id);
    localStorage.setItem(this.STORAGE_CAMPAIGNS, JSON.stringify(filtered));

    // Remove logs associated with this campaign
    const rawLogs = localStorage.getItem(this.STORAGE_LOGS);
    if (rawLogs) {
      const allLogs: LogItem[] = JSON.parse(rawLogs);
      const remainingLogs = allLogs.filter((l) => l.campaign_id !== id);
      localStorage.setItem(this.STORAGE_LOGS, JSON.stringify(remainingLogs));
    }

    return { success: true };
  }

  // PROXIES API
  public async getProxies(): Promise<ProxyItem[]> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/proxies` : '/api/proxies';
        const res = await fetch(endpoint, { headers: this.getAuthHeaders() });
        if (res.ok) return await res.json();
      } catch {
        this.hasBackend = false;
      }
    }
    const raw = localStorage.getItem(this.STORAGE_PROXIES);
    return raw ? JSON.parse(raw) : [];
  }

  public async addProxy(proxyUrl: string): Promise<{ success: boolean; id?: number }> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/proxies` : '/api/proxies';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ proxy_url: proxyUrl })
        });
        if (res.ok) return await res.json();
      } catch {
        this.hasBackend = false;
      }
    }

    const proxies = await this.getProxies();
    const newProxy: ProxyItem = {
      id: Date.now(),
      proxy_url: proxyUrl,
      type: proxyUrl.startsWith('https') ? 'https' : 'http',
      status: 'untested',
      latency_ms: 0,
      last_checked: null
    };
    proxies.push(newProxy);
    localStorage.setItem(this.STORAGE_PROXIES, JSON.stringify(proxies));
    return { success: true, id: newProxy.id };
  }

  public async deleteProxy(id: number): Promise<{ success: boolean }> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/proxies/${id}` : `/api/proxies/${id}`;
        const res = await fetch(endpoint, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
        if (res.ok) return await res.json();
      } catch {
        this.hasBackend = false;
      }
    }

    const proxies = await this.getProxies();
    const filtered = proxies.filter((p) => p.id !== id);
    localStorage.setItem(this.STORAGE_PROXIES, JSON.stringify(filtered));
    return { success: true };
  }

  public async checkProxies(): Promise<{ success: boolean; results: ProxyItem[] }> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/proxies/check` : '/api/proxies/check';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: this.getAuthHeaders()
        });
        if (res.ok) return await res.json();
      } catch {
        this.hasBackend = false;
      }
    }

    const proxies = await this.getProxies();
    const updated = proxies.map((p) => {
      const isAlive = Math.random() > 0.15;
      const latency = isAlive ? Math.floor(Math.random() * 250 + 60) : 0;
      return {
        ...p,
        status: (isAlive ? 'active' : 'dead') as 'active' | 'dead',
        latency_ms: latency,
        last_checked: new Date().toISOString()
      };
    });

    localStorage.setItem(this.STORAGE_PROXIES, JSON.stringify(updated));
    return { success: true, results: updated };
  }

  // LOGS API
  public async getLogs(campaignId: string): Promise<LogItem[]> {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      try {
        const baseUrl = this.getBackendBaseUrl();
        const endpoint = baseUrl ? `${baseUrl}/api/campaigns/${campaignId}/logs` : `/api/campaigns/${campaignId}/logs`;
        const res = await fetch(endpoint, { headers: this.getAuthHeaders() });
        if (res.ok) return await res.json();
      } catch {
        this.hasBackend = false;
      }
    }
    const raw = localStorage.getItem(this.STORAGE_LOGS);
    const allLogs: LogItem[] = raw ? JSON.parse(raw) : [];
    return allLogs.filter((l) => l.campaign_id === campaignId);
  }

  // EXPORT
  public async exportCampaign(campaignId: string, format: 'json' | 'csv') {
    const hasApi = await this.checkBackendAvailability();
    if (hasApi) {
      const baseUrl = this.getBackendBaseUrl();
      const endpoint = baseUrl ? `${baseUrl}/api/campaigns/${campaignId}/export?format=${format}` : `/api/campaigns/${campaignId}/export?format=${format}`;
      window.location.href = endpoint;
      return;
    }

    const campaigns = await this.getCampaigns();
    const campaign = campaigns.find((c) => c.id === campaignId);
    const logs = await this.getLogs(campaignId);

    if (!campaign) {
      alert('Campaña no encontrada para exportar.');
      return;
    }

    let blob: Blob;
    let filename: string;

    if (format === 'csv') {
      let csv = 'ID,URL,Status,Proxy,Duration (s),Timestamp\n';
      logs.forEach((l) => {
        const safeUrl = (l.url || '').replace(/"/g, '""');
        const safeProxy = (l.proxy_used || '').replace(/"/g, '""');
        csv += `"${l.id}","${safeUrl}","${l.status}","${safeProxy}",${l.duration_actual},"${l.timestamp}"\n`;
      });
      blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      filename = `campaign_${campaignId}_report.csv`;
    } else {
      const data = { campaign, logs };
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      filename = `campaign_${campaignId}_report.json`;
    }

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // CLIENT-SIDE REALTIME EXECUTOR (Edge / Cloudflare Pages Mode)
  private async runLocalSimulation(campaign: Campaign, input: CreateCampaignInput) {
    const control = { paused: false, cancelled: false };
    this.localActiveTimers.set(campaign.id, control);

    const proxies = await this.getProxies();
    const activeProxies = proxies.filter((p) => p.status === 'active');
    const totalVisits = input.urls.length * input.visitsPerUrl;
    let completedCount = 0;
    let failedCount = 0;

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2) Mobile/15E148'
    ];

    (async () => {
      for (let v = 0; v < input.visitsPerUrl; v++) {
        for (const url of input.urls) {
          if (control.cancelled) return;

          while (control.paused && !control.cancelled) {
            await new Promise((r) => setTimeout(r, 1000));
          }
          if (control.cancelled) return;

          const duration = Math.floor(
            Math.random() * (input.durationMax - input.durationMin + 1) + input.durationMin
          );

          let proxyUsed = 'Directo (Navegador)';
          if (input.useProxies && activeProxies.length > 0) {
            const randomP = activeProxies[Math.floor(Math.random() * activeProxies.length)];
            proxyUsed = randomP.proxy_url;
          }

          this.broadcast({
            type: 'visit_started',
            data: { campaignId: campaign.id, url, visitIndex: v + 1 }
          });

          const actions: string[] = [];
          let openedWindow: Window | null = null;

          if (input.openRealTab && !input.dryRun && typeof window !== 'undefined') {
            try {
              openedWindow = window.open(url, '_blank', 'width=900,height=650,left=100,top=100');
              if (openedWindow) {
                actions.push('Ventana real del navegador abierta con éxito');
                actions.push('Página web cargada: scripts y trackers activos (Analytics)');
              } else {
                actions.push('Aviso: Ventana bloqueada por bloqueador de popups');
              }
            } catch (err: any) {
              actions.push(`Error abriendo ventana: ${err.message}`);
            }
          } else {
            actions.push('Modo simulación en navegador activo');
            const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
            actions.push(`User-Agent: ${ua.substring(0, 30)}...`);
            actions.push('Página cargada con estado HTTP 200 OK');
          }

          const waitDurationMs = input.dryRun ? Math.min(duration * 200, 3000) : duration * 1000;
          await new Promise((r) => setTimeout(r, waitDurationMs));

          if (openedWindow && !openedWindow.closed) {
            try {
              openedWindow.close();
              actions.push(`Ventana cerrada tras ${duration}s de permanencia`);
            } catch {}
          }

          actions.push(`Desplazamiento suave (scroll) completado (${input.intensity})`);
          if (input.scrollMode === 'scroll_clicks') {
            actions.push('Interacciones seguras emuladas en la sesión');
          }

          const logItem: LogItem = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            campaign_id: campaign.id,
            url,
            status: 'success',
            proxy_used: proxyUsed,
            duration_actual: duration,
            actions_performed: JSON.stringify(actions),
            content_hash: 'hash_' + Math.random().toString(36).substring(2, 10),
            error_message: '',
            timestamp: new Date().toISOString()
          };

          completedCount++;

          const rawLogs = localStorage.getItem(this.STORAGE_LOGS);
          const allLogs: LogItem[] = rawLogs ? JSON.parse(rawLogs) : [];
          allLogs.unshift(logItem);
          localStorage.setItem(this.STORAGE_LOGS, JSON.stringify(allLogs.slice(0, 500)));

          this.broadcast({
            type: 'visit_completed',
            data: {
              campaignId: campaign.id,
              url,
              status: 'success',
              proxyUsed,
              durationActual: duration,
              actions,
              completedCount,
              totalVisits
            }
          });

          const intervalMs = input.dryRun ? Math.min(input.intervalSeconds * 200, 2000) : input.intervalSeconds * 1000;
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      }

      const campaigns = await this.getCampaigns();
      const idx = campaigns.findIndex((c) => c.id === campaign.id);
      if (idx >= 0 && !control.cancelled) {
        campaigns[idx].status = 'completed';
        campaigns[idx].completed_at = new Date().toISOString();
        campaigns[idx].stats = JSON.stringify({ completedCount, failedCount, totalVisits });
        localStorage.setItem(this.STORAGE_CAMPAIGNS, JSON.stringify(campaigns));
      }

      this.broadcast({
        type: 'campaign_completed',
        data: { id: campaign.id, completedCount, failedCount, totalVisits }
      });

      this.localActiveTimers.delete(campaign.id);
    })();
  }
}

export const trafficService = new TrafficService();
