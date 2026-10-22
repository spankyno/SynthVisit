import React, { useState, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  Square,
  Activity,
  Globe,
  Shield,
  Clock,
  CheckCircle,
  AlertTriangle,
  Download,
  RefreshCw,
  Terminal,
  Cpu,
  Layers,
  HelpCircle,
  Plus,
  Server,
  Cloud,
  Trash2,
  Lock,
  Key,
  Info
} from 'lucide-react';
import { trafficService, Campaign, ProxyItem, LogItem } from './services/trafficService';

// Safe JSON parser helper to prevent white-screen crashes
function safeJsonParse<T>(raw: any, fallback: T): T {
  if (typeof raw !== 'string') return raw || fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'proxies' | 'history' | 'readme'>('dashboard');

  // Backend connection status
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);

  // New Campaign Form State
  const [campaignName, setCampaignName] = useState('');
  const [urlsInput, setUrlsInput] = useState('');
  const [visitsPerUrl, setVisitsPerUrl] = useState(3);
  const [durationMin, setDurationMin] = useState(15);
  const [durationMax, setDurationMax] = useState(30);
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [intensity, setIntensity] = useState<'low' | 'medium' | 'high'>('medium');
  const [headless, setHeadless] = useState(true);
  const [useProxies, setUseProxies] = useState(false);
  const [useTor, setUseTor] = useState(false);
  const [scrollMode, setScrollMode] = useState<'scroll_only' | 'scroll_clicks'>('scroll_clicks');
  const [dryRun, setDryRun] = useState(false);
  const [scheduledTime, setScheduledTime] = useState('');
  const [openRealTab, setOpenRealTab] = useState(true);
  const [customBackendUrl, setCustomBackendUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [showBackendConfig, setShowBackendConfig] = useState(false);
  const [showModeHelpModal, setShowModeHelpModal] = useState(false);

  // Data States
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [activeLogs, setActiveLogs] = useState<LogItem[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignLogs, setCampaignLogs] = useState<LogItem[]>([]);
  const [newProxyUrl, setNewProxyUrl] = useState('');
  const [isCheckingProxies, setIsCheckingProxies] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Intensity auto-adjust presets
  const handleIntensityChange = (val: 'low' | 'medium' | 'high') => {
    setIntensity(val);
    if (val === 'low') {
      setDurationMin(20);
      setDurationMax(45);
      setIntervalSeconds(10);
    } else if (val === 'medium') {
      setDurationMin(15);
      setDurationMax(30);
      setIntervalSeconds(5);
    } else if (val === 'high') {
      setDurationMin(8);
      setDurationMax(15);
      setIntervalSeconds(2);
    }
  };

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadData = async () => {
    try {
      setCustomBackendUrl(trafficService.getBackendBaseUrl());
      setAuthToken(trafficService.getAuthToken());
      const hasApi = await trafficService.checkBackendAvailability();
      setIsBackendConnected(hasApi);

      if (hasApi) {
        const authStatus = await trafficService.checkAuthStatus();
        setIsAuthRequired(authStatus.authRequired);
        setIsAuthenticated(authStatus.authenticated);
      } else {
        setIsAuthRequired(false);
        setIsAuthenticated(true);
      }

      const [cList, pList] = await Promise.all([
        trafficService.getCampaigns(),
        trafficService.getProxies()
      ]);
      setCampaigns(cList);
      setProxies(pList);

      if (cList.length > 0 && !selectedCampaignId) {
        setSelectedCampaignId(cList[0].id);
        const lList = await trafficService.getLogs(cList[0].id);
        setCampaignLogs(lList);
      }
    } catch (e: any) {
      console.warn('Error loading initial data:', e);
    }
  };

  useEffect(() => {
    loadData();

    // Subscribe to events (both SSE or Client Simulation)
    const unsubscribe = trafficService.subscribeEvents((message) => {
      if (message.type === 'visit_completed' || message.type === 'visit_failed') {
        const item: LogItem = {
          id: Date.now() + Math.random(),
          campaign_id: message.data.campaignId,
          url: message.data.url,
          status: message.data.status || (message.type === 'visit_completed' ? 'success' : 'failed'),
          proxy_used: message.data.proxyUsed || 'Directo (Local)',
          duration_actual: message.data.durationActual || 0,
          actions_performed: JSON.stringify(message.data.actions || [message.data.error || 'Visita finalizada']),
          content_hash: message.data.contentHash || '',
          error_message: message.data.error || '',
          timestamp: new Date().toISOString()
        };

        setActiveLogs((prev) => [item, ...prev.slice(0, 99)]);
      }

      if (
        [
          'campaign_started',
          'campaign_completed',
          'campaign_paused',
          'campaign_resumed',
          'campaign_cancelled',
          'campaign_failed'
        ].includes(message.type)
      ) {
        trafficService.getCampaigns().then(setCampaigns);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleSelectCampaign = async (id: string) => {
    setSelectedCampaignId(id);
    const logs = await trafficService.getLogs(id);
    setCampaignLogs(logs);
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    const urlList = urlsInput
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urlList.length === 0) {
      showToast('Por favor, introduce al menos una URL válida.', 'error');
      return;
    }

    // Basic URL validation
    const invalidUrl = urlList.find((u) => !u.startsWith('http://') && !u.startsWith('https://'));
    if (invalidUrl) {
      showToast(`URL inválida: ${invalidUrl}. Debe comenzar con http:// o https://`, 'error');
      return;
    }

    try {
      const res = await trafficService.createCampaign({
        name: campaignName || `Campaña ${new Date().toLocaleTimeString()}`,
        urls: urlList,
        visitsPerUrl,
        durationMin,
        durationMax,
        intervalSeconds,
        intensity,
        headless,
        useProxies,
        useTor,
        scrollMode,
        dryRun,
        scheduledTime: scheduledTime || undefined,
        openRealTab: openRealTab
      });

      if (res.success) {
        showToast(
          `¡Campaña ${res.status === 'scheduled' ? 'programada' : 'iniciada'} con éxito!`,
          'success'
        );
        setUrlsInput('');
        setCampaignName('');
        const updated = await trafficService.getCampaigns();
        setCampaigns(updated);
        setActiveTab('dashboard');
      } else {
        showToast('No se pudo iniciar la campaña.', 'error');
      }
    } catch (err: any) {
      showToast(`Error al crear la campaña: ${err.message}`, 'error');
    }
  };

  const handleControlCampaign = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      const actionLabels = {
        pause: 'pausada',
        resume: 'reanudada',
        cancel: 'cancelada'
      };
      await trafficService.controlCampaign(id, action);
      showToast(`Campaña ${actionLabels[action]} correctamente.`, 'info');
      const updated = await trafficService.getCampaigns();
      setCampaigns(updated);
    } catch (e: any) {
      showToast(`Error al controlar campaña: ${e.message}`, 'error');
    }
  };

  const handleCheckProxies = async () => {
    setIsCheckingProxies(true);
    try {
      const res = await trafficService.checkProxies();
      if (res.success) {
        setProxies(res.results);
        showToast('Verificación de salud de proxies completada.', 'success');
      }
    } catch (e: any) {
      showToast(`Error comprobando proxies: ${e.message}`, 'error');
    } finally {
      setIsCheckingProxies(false);
    }
  };

  const handleAddProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProxyUrl.trim()) return;

    if (!newProxyUrl.startsWith('http://') && !newProxyUrl.startsWith('https://') && !newProxyUrl.startsWith('socks5://')) {
      showToast('El proxy debe comenzar con http://, https:// o socks5://', 'error');
      return;
    }

    try {
      const res = await trafficService.addProxy(newProxyUrl.trim());
      if (res.success) {
        showToast('Proxy añadido con éxito.', 'success');
        setNewProxyUrl('');
        const updated = await trafficService.getProxies();
        setProxies(updated);
      }
    } catch (e: any) {
      showToast(`Error al añadir proxy: ${e.message}`, 'error');
    }
  };

  const handleExport = (campId: string, format: 'json' | 'csv') => {
    trafficService.exportCampaign(campId, format);
  };

  const handleDeleteProxy = async (id: number) => {
    if (!confirm('¿Seguro que deseas eliminar este proxy?')) return;
    try {
      await trafficService.deleteProxy(id);
      setProxies((prev) => prev.filter((p) => p.id !== id));
      showToast('Proxy eliminado correctamente.', 'info');
    } catch (err: any) {
      showToast(`Error al eliminar proxy: ${err.message}`, 'error');
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    if (!confirm('¿Seguro que deseas eliminar esta campaña y sus registros del historial?')) return;
    try {
      await trafficService.deleteCampaign(id);
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
      if (selectedCampaignId === id) {
        setSelectedCampaignId(null);
        setCampaignLogs([]);
      }
      showToast('Campaña eliminada del historial.', 'info');
    } catch (err: any) {
      showToast(`Error al eliminar campaña: ${err.message}`, 'error');
    }
  };

  const activeCampaignsList = useMemo(
    () => campaigns.filter((c) => c.status === 'running' || c.status === 'paused' || c.status === 'scheduled'),
    [campaigns]
  );

  const pastCampaignsList = useMemo(
    () => campaigns.filter((c) => c.status === 'completed' || c.status === 'cancelled' || c.status === 'failed'),
    [campaigns]
  );

  const activeProxiesCount = useMemo(
    () => proxies.filter((p) => p.status === 'active').length,
    [proxies]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-2xl flex items-center space-x-3 border transition-all animate-bounce ${
            toastMessage.type === 'error'
              ? 'bg-rose-600 text-white border-rose-400 shadow-rose-900/50'
              : toastMessage.type === 'info'
              ? 'bg-sky-600 text-white border-sky-400 shadow-sky-900/50'
              : 'bg-indigo-600 text-white border-indigo-400 shadow-indigo-900/50'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertTriangle className="w-5 h-5 shrink-0" />
          ) : (
            <CheckCircle className="w-5 h-5 shrink-0" />
          )}
          <span className="font-medium text-sm">{toastMessage.text}</span>
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 sticky top-0 z-40 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-start">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-tr from-indigo-500 to-violet-600 p-2.5 rounded-xl shadow-lg">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
                  SynthVisit
                </h1>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                  v1.0 Pro
                </span>
              </div>
              <p className="text-xs text-slate-400">Generador de Tráfico Sintético y Simulación de Interacción SEO</p>
            </div>
          </div>

          {/* Mode Indicator Badge & Help Button */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setShowBackendConfig(true)}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer hover:opacity-80 ${
                isBackendConnected
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
              }`}
              title="Haz clic para configurar el Servidor Playwright y credenciales"
            >
              {isBackendConnected ? (
                <>
                  <Server className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Modo Headless (Playwright)</span>
                </>
              ) : (
                <>
                  <Cloud className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Modo Estático Edge/Cloud</span>
                </>
              )}
            </button>

            {/* Sutil botón de ayuda de modos */}
            <button
              type="button"
              onClick={() => setShowModeHelpModal(true)}
              className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Explicación de los Modos: Estático Edge vs Headless"
            >
              <HelpCircle className="w-4 h-4 text-slate-400 hover:text-indigo-300" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1 bg-slate-950 p-1.5 rounded-xl border border-slate-800 w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center space-x-2 shrink-0 ${
              activeTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Panel y Campañas</span>
          </button>
          <button
            onClick={() => setActiveTab('proxies')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center space-x-2 shrink-0 ${
              activeTab === 'proxies' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Proxies e IPs ({activeProxiesCount})</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center space-x-2 shrink-0 ${
              activeTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Historial e Informes</span>
          </button>
          <button
            onClick={() => setActiveTab('readme')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center space-x-2 shrink-0 ${
              activeTab === 'readme' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>Guía y Manual</span>
          </button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-8">
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left 2 Cols: Create Campaign & Active Campaigns */}
            <div className="lg:col-span-2 space-y-8">
              {/* Campaign Creator Form */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
                      <Layers className="w-5 h-5" />
                    </div>
                    <h2 className="text-lg font-semibold text-white">Crear Nueva Campaña Sintética</h2>
                  </div>
                  {dryRun && (
                    <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs px-3 py-1 rounded-full font-medium">
                      Modo Dry-Run Activo (Simulación Rápida)
                    </span>
                  )}
                </div>

                <form onSubmit={handleCreateCampaign} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Nombre de la Campaña (Opcional)</label>
                    <input
                      type="text"
                      placeholder="ej., Verificación Search Console Q3"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="block text-sm font-medium text-slate-300">URLs de Destino (Una por línea)</label>
                      <span className="text-xs text-slate-500">Debe comenzar con http:// o https://</span>
                    </div>
                    <textarea
                      rows={4}
                      placeholder="https://ejemplo.com/pagina-1&#10;https://ejemplo.com/pagina-2"
                      value={urlsInput}
                      onChange={(e) => setUrlsInput(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm font-mono text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Visitas por URL (n)</label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={visitsPerUrl}
                        onChange={(e) => setVisitsPerUrl(Math.max(1, Number(e.target.value)))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Duración Mínima (s)</label>
                      <input
                        type="number"
                        min={3}
                        max={300}
                        value={durationMin}
                        onChange={(e) => setDurationMin(Math.max(3, Number(e.target.value)))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Duración Máxima (s)</label>
                      <input
                        type="number"
                        min={5}
                        max={600}
                        value={durationMax}
                        onChange={(e) => setDurationMax(Math.max(durationMin, Number(e.target.value)))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Intervalo entre visitas (s)</label>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={intervalSeconds}
                        onChange={(e) => setIntervalSeconds(Math.max(1, Number(e.target.value)))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Programar Inicio (Opcional)</label>
                      <input
                        type="datetime-local"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Intensity Selector */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2">Perfil de Intensidad y Comportamiento Humano</label>
                    <div className="grid grid-cols-3 gap-3">
                      {(['low', 'medium', 'high'] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => handleIntensityChange(lvl)}
                          className={`py-2.5 px-4 rounded-xl text-xs font-semibold uppercase tracking-wider border transition-all ${
                            intensity === lvl
                              ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-inner'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          {lvl === 'low' ? 'Suave (Bajo)' : lvl === 'medium' ? 'Estándar (Medio)' : 'Intensivo (Alto)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={headless}
                        onChange={(e) => setHeadless(e.target.checked)}
                        className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-300">Navegador Headless</span>
                    </label>

                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useProxies}
                        onChange={(e) => setUseProxies(e.target.checked)}
                        className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-300">Rotar Proxies ({activeProxiesCount} activos)</span>
                    </label>

                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scrollMode === 'scroll_clicks'}
                        onChange={(e) => setScrollMode(e.target.checked ? 'scroll_clicks' : 'scroll_only')}
                        className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-300">Scroll + Clics Seguros</span>
                    </label>

                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dryRun}
                        onChange={(e) => setDryRun(e.target.checked)}
                        className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-xs text-amber-300">Simulación Dry-Run</span>
                    </label>
                  </div>

                  {/* Real Browser Visits Mode (for Client/Edge mode) */}
                  {!isBackendConnected && !dryRun && (
                    <div className="p-3.5 bg-indigo-950/40 border border-indigo-500/30 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center space-x-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={openRealTab}
                            onChange={(e) => setOpenRealTab(e.target.checked)}
                            className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-indigo-500 focus:ring-indigo-500"
                          />
                          <span className="text-xs font-semibold text-indigo-200">
                            Visitas Reales en Navegador (Abre ventana auxiliar)
                          </span>
                        </label>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                          Necesario para Analytics
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Abre temporalmente cada URL en una ventana auxiliar durante los segundos configurados para que el navegador descargue y ejecute los scripts de la página (imprescindible para que <strong>Aitor's Analytics</strong> o Google Analytics registren las visitas). Asegúrate de <strong>permitir ventanas emergentes (popups)</strong> en este sitio.
                      </p>
                    </div>
                  )}

                  <div className="pt-4 flex justify-end">
                    <button
                      type="submit"
                      className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold px-6 py-3 rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center space-x-2 text-sm cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Iniciar Campaña</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Active Campaigns Queue */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center space-x-2">
                  <Activity className="w-5 h-5 text-indigo-400" />
                  <span>Campañas Activas y Programadas ({activeCampaignsList.length})</span>
                </h2>

                {activeCampaignsList.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">No hay campañas activas o programadas en este momento.</p>
                ) : (
                  <div className="space-y-4">
                    {activeCampaignsList.map((camp) => {
                      const urlsParsed = safeJsonParse<string[]>(camp.urls, []);
                      return (
                        <div key={camp.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center space-x-3">
                              <span className="font-semibold text-white text-sm">{camp.name}</span>
                              <span
                                className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                  camp.status === 'running'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse'
                                    : camp.status === 'paused'
                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                    : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                                }`}
                              >
                                {camp.status === 'running' ? 'ejecutándose' : camp.status === 'paused' ? 'pausada' : 'programada'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                              {urlsParsed.length} URLs • {camp.visits_per_url} visitas/URL • Intensidad: {camp.intensity}
                            </p>
                          </div>

                          <div className="flex items-center space-x-2 self-end sm:self-center">
                            {camp.status === 'running' && (
                              <button
                                onClick={() => handleControlCampaign(camp.id, 'pause')}
                                className="p-2 bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors"
                                title="Pausar Campaña"
                              >
                                <Pause className="w-4 h-4" />
                              </button>
                            )}
                            {camp.status === 'paused' && (
                              <button
                                onClick={() => handleControlCampaign(camp.id, 'resume')}
                                className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors"
                                title="Reanudar Campaña"
                              >
                                <Play className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleControlCampaign(camp.id, 'cancel')}
                              className="p-2 bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition-colors"
                              title="Cancelar Campaña"
                            >
                              <Square className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleSelectCampaign(camp.id)}
                              className="px-3 py-1.5 bg-slate-900 border border-slate-700 text-xs text-slate-300 rounded-lg hover:bg-slate-800"
                            >
                              Ver Registros
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Col: Live Logs Feed */}
            <div className="space-y-6">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md flex flex-col h-[750px]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-white flex items-center space-x-2">
                    <Terminal className="w-4 h-4 text-indigo-400" />
                    <span>Registros en Tiempo Real</span>
                  </h2>
                  <span className="flex items-center space-x-1.5 text-xs text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                    <span>En Vivo</span>
                  </span>
                </div>

                <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-y-auto space-y-3 font-mono text-xs">
                  {activeLogs.length === 0 ? (
                    <p className="text-slate-600 text-center py-20">Esperando el inicio de las visitas sintéticas...</p>
                  ) : (
                    activeLogs.map((log) => {
                      const actions: string[] = safeJsonParse(log.actions_performed, [log.actions_performed]);

                      return (
                        <div key={log.id} className="border-b border-slate-900 pb-3 last:border-0">
                          <div className="flex items-center justify-between mb-1">
                            <span
                              className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                                log.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {log.status === 'success' ? 'ÉXITO' : 'FALLO'}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {new Date(log.timestamp).toLocaleTimeString()} • {log.duration_actual}s
                            </span>
                          </div>
                          <p className="text-slate-300 truncate font-semibold" title={log.url}>
                            {log.url}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">Proxy: {log.proxy_used}</p>
                          {actions.length > 0 && (
                            <div className="mt-1.5 pl-2 border-l-2 border-indigo-500/40 text-[11px] text-slate-400 space-y-0.5">
                              {actions.map((act, i) => (
                                <div key={i}>• {act}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Proxies Tab */}
        {activeTab === 'proxies' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Gestor de Rotación de Proxies e IPs</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Administra listas de proxies, comprueba su latencia y salud en vivo, o añade túneles proxy personalizados.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={handleCheckProxies}
                  disabled={isCheckingProxies}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isCheckingProxies ? 'animate-spin' : ''}`} />
                  <span>{isCheckingProxies ? 'Comprobando Latencia...' : 'Comprobar Estado de Proxies'}</span>
                </button>
              </div>
            </div>

            {/* Add Custom Proxy Form */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
              <h3 className="text-sm font-semibold text-white mb-3">Añadir Proxy Personalizado</h3>
              <form onSubmit={handleAddProxy} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="http://ip:puerto o http://usuario:contraseña@ip:puerto"
                  value={newProxyUrl}
                  onChange={(e) => setNewProxyUrl(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                  required
                />
                <button
                  type="submit"
                  className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Añadir Proxy</span>
                </button>
              </form>
            </div>

            {/* Proxies Table */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-x-auto shadow-xl">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                    <th className="p-4">URL del Proxy</th>
                    <th className="p-4">Protocolo</th>
                    <th className="p-4">Estado</th>
                    <th className="p-4">Latencia</th>
                    <th className="p-4">Última Verificación</th>
                    <th className="p-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50 font-mono text-xs">
                  {proxies.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-900/50 transition-colors">
                      <td className="p-4 text-white font-semibold">{p.proxy_url}</td>
                      <td className="p-4 uppercase text-slate-400">{p.type}</td>
                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            p.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : p.status === 'dead'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {p.status === 'active' ? 'activo' : p.status === 'dead' ? 'inactivo' : 'no probado'}
                        </span>
                      </td>
                      <td className="p-4 text-slate-300">{p.latency_ms ? `${p.latency_ms} ms` : '-'}</td>
                      <td className="p-4 text-slate-500">{p.last_checked ? new Date(p.last_checked).toLocaleTimeString() : 'Nunca'}</td>
                      <td className="p-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteProxy(p.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Eliminar este proxy"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* History & Reports Tab */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
              <h2 className="text-lg font-semibold text-white mb-2">Historial de Campañas e Informes</h2>
              <p className="text-xs text-slate-400 mb-6">
                Revisa campañas anteriores, descarga informes en formato JSON o CSV e inspecciona métricas de rendimiento.
              </p>

              {pastCampaignsList.length === 0 ? (
                <p className="text-sm text-slate-500 py-12 text-center">No hay campañas anteriores registradas todavía.</p>
              ) : (
                <div className="space-y-4">
                  {pastCampaignsList.map((camp) => {
                    const stats: any = safeJsonParse(camp.stats, {});

                    return (
                      <div
                        key={camp.id}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center space-x-3">
                            <h3 className="font-semibold text-white text-base">{camp.name}</h3>
                            <span
                              className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                camp.status === 'completed'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {camp.status === 'completed' ? 'completada' : camp.status === 'cancelled' ? 'cancelada' : 'fallida'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Completada: {camp.completed_at ? new Date(camp.completed_at).toLocaleString() : '-'} • Éxitos:{' '}
                            {stats.completedCount || 0} / Fallos: {stats.failedCount || 0}
                          </p>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => handleExport(camp.id, 'json')}
                            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 transition-colors cursor-pointer"
                            title="Descargar informe en JSON"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>JSON</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExport(camp.id, 'csv')}
                            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-lg shadow-indigo-600/30 cursor-pointer"
                            title="Descargar informe en CSV"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>CSV</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCampaign(camp.id)}
                            className="p-2 bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-xl border border-slate-700 hover:border-rose-500/30 transition-colors cursor-pointer"
                            title="Eliminar campaña y registros del historial"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Readme / Guide Tab */}
        {activeTab === 'readme' && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-xl backdrop-blur-md space-y-6 text-slate-300">
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-xl font-bold text-white">SynthVisit — Guía de Usuario y Producción</h2>
              <p className="text-sm text-slate-400 mt-1">
                Herramienta avanzada diseñada para pruebas de comportamiento de tráfico sintético, interactividad humana y validación en Search Console.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm leading-relaxed">
              <div className="p-5 bg-slate-950 border border-slate-800/80 rounded-xl space-y-3">
                <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                  <Globe className="w-4 h-4 text-indigo-400" />
                  <span>1. Despliegue en Vercel o Cloudflare</span>
                </h3>
                <p className="text-xs text-slate-400">
                  SynthVisit está optimizado con arquitectura dual. Al compilar con <code className="text-indigo-300">npm run build</code>, se genera una SPA de alto rendimiento lista para desplegar en Cloudflare Pages o Vercel sin dependencias de servidor obligatorias.
                </p>
                <p className="text-xs text-slate-400">
                  Si se ejecuta con Node.js (<code className="text-indigo-300">npm run dev</code> o servidor dedicado), se activa automáticamente el motor completo de Playwright para navegación real con navegador Chromium headless.
                </p>
              </div>

              <div className="p-5 bg-slate-950 border border-slate-800/80 rounded-xl space-y-3">
                <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  <span>2. Rotación de Proxies e IPs</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Puedes configurar proxies HTTP, HTTPS o SOCKS5. El sistema evalúa la latencia y descarta proxies inactivos. Si los proxies fallan o no están configurados, conmuta de forma segura a IP directa o simulación dry-run.
                </p>
              </div>

              <div className="p-5 bg-slate-950 border border-slate-800/80 rounded-xl space-y-3">
                <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  <span>3. Emulación de Comportamiento Humano</span>
                </h3>
                <ul className="text-xs text-slate-400 list-disc pl-4 space-y-1">
                  <li>Rotación continua de User-Agents (Chrome, Safari, Firefox, iOS).</li>
                  <li>Desplazamiento suave con velocidad variable y pausas orgánicas.</li>
                  <li>Clics seguros en enlaces internos y botones del mismo dominio.</li>
                  <li>Generación de hashes de contenido para auditoría de integridad.</li>
                </ul>
              </div>

              <div className="p-5 bg-slate-950 border border-slate-800/80 rounded-xl space-y-3">
                <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                  <Download className="w-4 h-4 text-indigo-400" />
                  <span>4. Informes y Exportación</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Todas las campañas se auditan con fecha, duración exacta por visita, proxies utilizados y secuencia de acciones. Los informes pueden descargarse al instante en JSON o CSV estructurado.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Modal Explicativo de Modos (Botón de Ayuda Sutil) */}
        {showModeHelpModal && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <Info className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-semibold text-white text-base">Modos de Operación de SynthVisit</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModeHelpModal(false)}
                  className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 text-xs leading-relaxed text-slate-300">
                {/* Modo Estático Edge / Cloud */}
                <div className="p-4 bg-slate-950/80 border border-indigo-500/30 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2">
                    <Cloud className="w-4 h-4 text-indigo-400 shrink-0" />
                    <h4 className="font-semibold text-indigo-200 text-sm">1. Modo Estático Edge/Cloud (Por Defecto)</h4>
                  </div>
                  <p className="text-slate-400">
                    Diseñado para alojarse en <strong>Cloudflare Pages o Vercel</strong> como SPA estática. No requiere servidores dedicados ni genera costes de hosting.
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-slate-400">
                    <li>Almacena campañas, proxies y registros en el <code>localStorage</code> del navegador.</li>
                    <li>
                      <strong>Visitas para Analytics</strong>: Abre y cierra una ventana auxiliar temporal para ejecutar el JavaScript real de la página (activando <em>Aitor's Analytics</em>, Google Analytics, etc.).
                    </li>
                  </ul>
                </div>

                {/* Modo Headless Playwright */}
                <div className="p-4 bg-slate-950/80 border border-emerald-500/30 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Server className="w-4 h-4 text-emerald-400 shrink-0" />
                      <h4 className="font-semibold text-emerald-200 text-sm">2. Modo Headless (Playwright en Render/VPS)</h4>
                    </div>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      Servidor Dedicado
                    </span>
                  </div>
                  <p className="text-slate-400">
                    Funciona conectando la app a un servidor Node.js (desplegable en <strong>Render, Railway o VPS</strong>) que ejecuta navegadores <strong>Chromium headless reales</strong>.
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-slate-400">
                    <li>Ejecución 100% en segundo plano: no abre ventanas en tu pantalla.</li>
                    <li>Rotación avanzada de proxies a nivel de socket de red y emulación humana completa.</li>
                    <li className="text-amber-300/90 font-medium">
                      🔒 <strong>Acceso protegido</strong>: Este modo requiere o requerirá autenticación mediante token/API Key para garantizar que solo usuarios autorizados utilicen los recursos del servidor.
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowModeHelpModal(false)}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-lg shadow-indigo-600/30"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Backend & Auth Configuration Modal */}
        {showBackendConfig && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <Server className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-semibold text-white">Configurar Servidor Headless y Autenticación</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBackendConfig(false)}
                  className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Conecta tu frontend a un backend Node.js + Playwright (en <strong>Render, Railway o VPS</strong>) para ejecutar campañas headless en segundo plano.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">URL del Servidor Backend (Render / VPS)</label>
                  <input
                    type="text"
                    placeholder="https://tu-servicio.onrender.com o http://localhost:3000"
                    value={customBackendUrl}
                    onChange={(e) => setCustomBackendUrl(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-400">Token / Clave de Acceso Headless</label>
                    <span className="text-[10px] text-amber-400 flex items-center space-x-1">
                      <Lock className="w-3 h-3" />
                      <span>Solo usuarios autorizados</span>
                    </span>
                  </div>
                  <input
                    type="password"
                    placeholder="Introduce el HEADLESS_AUTH_KEY configurado en tu servidor"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Si tu servidor en Render tiene configurada la variable <code>HEADLESS_AUTH_KEY</code>, este token es obligatorio para crear y ejecutar campañas headless.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    trafficService.setBackendBaseUrl('');
                    trafficService.setAuthToken('');
                    setCustomBackendUrl('');
                    setAuthToken('');
                    setShowBackendConfig(false);
                    loadData();
                    showToast('Restablecido a Modo Estático Edge / Cloud.', 'info');
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Restablecer a Modo Edge
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    trafficService.setBackendBaseUrl(customBackendUrl);
                    trafficService.setAuthToken(authToken);
                    setShowBackendConfig(false);
                    await loadData();
                    showToast('Configuración y credenciales de backend actualizadas.', 'success');
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg shadow-indigo-600/30"
                >
                  Guardar y Probar Conexión
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
