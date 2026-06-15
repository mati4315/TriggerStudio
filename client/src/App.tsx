import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Tv, 
  Image as ImageIcon, 
  Volume2, 
  Search, 
  Settings, 
  Play, 
  Square, 
  AlertTriangle, 
  ChevronUp, 
  ChevronDown, 
  RefreshCw, 
  Activity
} from 'lucide-react';

interface MediaAsset {
  id: string;
  name: string;
  type: 'video' | 'image' | 'audio';
  file: string;
  thumbnail?: string;
  category: string;
}

interface ActiveAsset {
  source: string;
  asset: string;
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function App() {
  // Connection states (loaded from localStorage or default)
  const [serverIp, setServerIp] = useState(() => localStorage.getItem('ts_server_ip') || 'localhost');
  const [serverPort, setServerPort] = useState(() => localStorage.getItem('ts_server_port') || '2188');
  
  // Connection statuses
  const [isConnected, setIsConnected] = useState(false);
  const [obsConnected, setObsConnected] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Connection settings form values
  const [tempIp, setTempIp] = useState(serverIp);
  const [tempPort, setTempPort] = useState(serverPort);

  // Media catalogs
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [activeAssets, setActiveAssets] = useState<ActiveAsset[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'video' | 'image' | 'audio'>('all');

  // Manual Trigger Form
  const [manualFile, setManualFile] = useState('');
  const [manualType, setManualType] = useState<'video' | 'image' | 'audio'>('video');
  const [manualDuration, setManualDuration] = useState('0');

  // UI state
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: new Date().toLocaleTimeString(), message: 'Aplicación iniciada. Configure el servidor si es necesario.', type: 'info' }
  ]);
  const [logsCollapsed, setLogsCollapsed] = useState(true);
  const [stopStatus, setStopStatus] = useState<'idle' | 'stopping' | 'stopped'>('idle');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Log helper
  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [
      ...prev,
      { time: new Date().toLocaleTimeString(), message, type }
    ]);
  };

  // Build backend base URL
  const baseUrl = useMemo(() => {
    return `http://${serverIp}:${serverPort}`;
  }, [serverIp, serverPort]);

  // Fetch catalog from HTTP API
  const fetchAssets = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`${baseUrl}/api/assets`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setAssets(data);
      addLog(`Catálogo cargado: ${data.length} archivos encontrados.`, 'success');
    } catch (err: any) {
      addLog(`Error al cargar catálogo de medios: ${err.message}`, 'error');
      // If catalog load fails and we are not connected, display config modal
      if (!isConnected) {
        setShowConfigModal(true);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Connect WebSocket
  const connectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const wsUrl = `ws://${serverIp}:${serverPort}`;
    addLog(`Conectando al servidor en ${wsUrl}...`, 'info');

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        addLog('Conexión establecida con el servidor backend.', 'success');
        // Fetch fresh list
        fetchAssets();
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'status') {
            setObsConnected(msg.obsConnected);
            setActiveAssets(msg.activeAssets || []);
          } else if (msg.type === 'success') {
            addLog(msg.message, 'success');
          } else if (msg.type === 'warning') {
            addLog(msg.message, 'warning');
          } else if (msg.type === 'error') {
            addLog(msg.message, 'error');
          } else if (msg.type === 'media_state') {
            addLog(`OBS [${msg.sourceName}]: ${msg.state === 'playing' ? 'Reproduciendo' : 'Ocultado'} "${msg.assetName}"`, 'info');
            
            if (msg.state === 'playing') {
              setActiveAssets(prev => {
                const filtered = prev.filter(a => a.source !== msg.sourceName);
                return [...filtered, { source: msg.sourceName, asset: msg.assetName }];
              });
            } else if (msg.state === 'hidden') {
              setActiveAssets(prev => prev.filter(a => a.source !== msg.sourceName));
            }
          } else if (msg.type === 'all_stopped') {
            addLog('Todos los overlays detenidos y ocultados.', 'success');
            setActiveAssets([]);
            setStopStatus('stopped');
            setTimeout(() => setStopStatus('idle'), 1500);
          }
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        setObsConnected(false);
        addLog('Conexión con el servidor perdida. Reconectando en 3s...', 'error');
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };

      socket.onerror = (err) => {
        console.error('WS error:', err);
      };

    } catch (err: any) {
      addLog(`Error al inicializar WebSocket: ${err.message}`, 'error');
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    }
  };

  // Handle configuration saving
  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('ts_server_ip', tempIp);
    localStorage.setItem('ts_server_port', tempPort);
    setServerIp(tempIp);
    setServerPort(tempPort);
    setShowConfigModal(false);
    addLog(`Configuración guardada: ${tempIp}:${tempPort}. Conectando...`, 'info');
  };

  // Trigger asset
  const triggerAsset = (asset: MediaAsset) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('No se puede disparar: Sin conexión con el servidor backend', 'error');
      return;
    }

    const payload = {
      action: 'play',
      asset: asset.file,
      type: asset.type,
      duration: parseInt(manualDuration) || 0
    };

    wsRef.current.send(JSON.stringify(payload));
    addLog(`Disparando recurso: ${asset.name} (${asset.type})`, 'info');
  };

  // Trigger manual input
  const triggerManual = () => {
    if (!manualFile.trim()) {
      addLog('Escriba un nombre de archivo válido.', 'error');
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('No se puede disparar: Sin conexión con el servidor backend', 'error');
      return;
    }

    const payload = {
      action: 'play',
      video: manualFile.trim(),
      type: manualType,
      duration: parseInt(manualDuration) || 0
    };

    wsRef.current.send(JSON.stringify(payload));
    addLog(`Comando manual enviado: play "${manualFile.trim()}" (${manualType})`, 'info');
  };

  // Stop all overlays
  const stopAll = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setStopStatus('stopping');
    wsRef.current.send(JSON.stringify({ action: 'stop' }));
    addLog('Comando enviado: Detener todo', 'info');

    // Fallback timeout in case of packet drop
    setTimeout(() => {
      setStopStatus(prev => prev === 'stopping' ? 'idle' : prev);
    }, 1200);
  };

  // Initial connection
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [serverIp, serverPort]);

  // Filter and search computation
  const filteredAssets = useMemo(() => {
    return assets.filter(asset => {
      const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            asset.file.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesType = selectedType === 'all' || asset.type === selectedType;

      return matchesSearch && matchesType;
    });
  }, [assets, searchQuery, selectedType]);

  // Autoscroll logs
  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!logsCollapsed && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, logsCollapsed]);

  return (
    <div className="app-container">
      {/* Sidebar Control Panel */}
      <aside className="sidebar">
        <div className="brand-section">
          <div className="brand-logo">
            <Activity className="brand-fallback-icon" style={{ width: 24, height: 24 }} />
            TriggerStudio
          </div>
          <span className="brand-badge">REMOTO</span>
        </div>

        <div className="sidebar-scrollable">
          {/* Status Indicators Widget */}
          <div className="widget">
            <h3 className="widget-title">📡 Estado de Conexión</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div className="status-pill">
                <div className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', lineHeight: 1 }}>Servidor</span>
                  <span style={{ fontSize: '0.85rem' }}>{isConnected ? 'Conectado' : 'Desconectado'}</span>
                </div>
              </div>
              
              <div className="status-pill">
                <div className={`status-dot ${obsConnected ? 'online' : 'offline'}`} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', lineHeight: 1 }}>OBS Studio</span>
                  <span style={{ fontSize: '0.85rem' }}>{obsConnected ? 'Conectado' : 'Desconectado'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions Widget */}
          <div className="widget">
            <h3 className="widget-title">⚡ Acciones Rápidas</h3>
            <button 
              className={`btn-premium btn-premium-danger ${stopStatus === 'stopping' ? 'stopping' : ''} ${stopStatus === 'stopped' ? 'stopped' : ''}`}
              onClick={stopAll}
              disabled={!isConnected}
              style={{ width: '100%' }}
            >
              <Square style={{ width: 16, height: 16, fill: '#fff' }} />
              {stopStatus === 'stopping' ? 'Deteniendo...' : stopStatus === 'stopped' ? '¡Todo Detenido!' : 'Ocultar Todo'}
            </button>
            <button 
              className="btn-premium btn-premium-primary"
              onClick={() => setShowConfigModal(true)}
              style={{ width: '100%', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-light)' }}
            >
              <Settings style={{ width: 16, height: 16 }} />
              Configurar Conexión
            </button>
          </div>

          {/* Manual Trigger Widget */}
          <div className="widget">
            <h3 className="widget-title">🧪 Disparador Manual</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div className="form-input-group">
                <label className="form-label">Nombre de archivo</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: meme.mp4, risa.gif" 
                  value={manualFile}
                  onChange={e => setManualFile(e.target.value)}
                />
              </div>

              <div className="form-input-group">
                <label className="form-label">Tipo de contenido</label>
                <div className="form-radio-group">
                  <div 
                    className={`form-radio-card ${manualType === 'video' ? 'active' : ''}`}
                    onClick={() => setManualType('video')}
                  >
                    Video
                  </div>
                  <div 
                    className={`form-radio-card ${manualType === 'image' ? 'active' : ''}`}
                    onClick={() => setManualType('image')}
                  >
                    Img/Gif
                  </div>
                  <div 
                    className={`form-radio-card ${manualType === 'audio' ? 'active' : ''}`}
                    onClick={() => setManualType('audio')}
                  >
                    Audio
                  </div>
                </div>
              </div>

              <div className="form-input-group">
                <label className="form-label">Duración (segundos, 0=inf)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  min="0"
                  value={manualDuration}
                  onChange={e => setManualDuration(e.target.value)}
                />
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', lineHeight: 1.3 }}>
                  * Las imágenes duran siempre 2 segundos.
                </span>
              </div>

              <button 
                className="btn-premium btn-premium-primary"
                onClick={triggerManual}
                disabled={!isConnected}
                style={{ width: '100%', marginTop: '0.25rem' }}
              >
                <Play style={{ width: 15, height: 15, fill: '#fff' }} />
                Disparar Manual
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Dashboard Panel */}
      <main className="main-content">
        <header className="main-header">
          <div className="search-filter-bar">
            {/* Search Input */}
            <div className="search-input-wrapper">
              <Search className="search-icon" />
              <input 
                type="text" 
                className="search-input" 
                placeholder="Buscar recurso..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Filter Tabs */}
            <div className="tabs-container">
              <button 
                className={`tab-btn ${selectedType === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedType('all')}
              >
                Todos
              </button>
              <button 
                className={`tab-btn ${selectedType === 'video' ? 'active' : ''}`}
                onClick={() => setSelectedType('video')}
              >
                <Tv style={{ width: 14, height: 14 }} />
                Videos
              </button>
              <button 
                className={`tab-btn ${selectedType === 'image' ? 'active' : ''}`}
                onClick={() => setSelectedType('image')}
              >
                <ImageIcon style={{ width: 14, height: 14 }} />
                GIFs/Imágenes
              </button>
              <button 
                className={`tab-btn ${selectedType === 'audio' ? 'active' : ''}`}
                onClick={() => setSelectedType('audio')}
              >
                <Volume2 style={{ width: 14, height: 14 }} />
                Audios
              </button>
            </div>
          </div>

          <div className="header-actions">
            <button 
              className="btn-premium btn-premium-primary"
              onClick={fetchAssets}
              disabled={isRefreshing || !isConnected}
              style={{ padding: '0.55rem 1rem', fontSize: '0.8rem', borderRadius: '10px' }}
            >
              <RefreshCw className={isRefreshing ? 'animate-spin' : ''} style={{ width: 14, height: 14 }} />
              {isRefreshing ? 'Actualizando...' : 'Actualizar Catálogo'}
            </button>
          </div>
        </header>

        {/* Media Grid Body */}
        <div className="main-body" style={{ paddingBottom: logsCollapsed ? '4rem' : '17rem' }}>
          {filteredAssets.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon-wrapper">
                <AlertTriangle style={{ width: 32, height: 32 }} />
              </div>
              <h4 className="empty-state-title">No se encontraron archivos</h4>
              <p className="empty-state-desc">
                {assets.length === 0 
                  ? 'Asegúrese de conectar el backend y colocar archivos de video, imágenes o audios en el directorio configurado.' 
                  : 'Pruebe buscando con un nombre diferente o cambiando la categoría de filtro seleccionada.'}
              </p>
              {assets.length === 0 && (
                <div className="empty-state-hint">
                  Carpeta configurada: D:/OBS_MEDIA o server/media
                </div>
              )}
            </div>
          ) : (
            <div className="assets-grid">
              {filteredAssets.map(asset => {
                const isActive = activeAssets.some(active => active.asset === asset.file);
                return (
                  <AssetCard 
                    key={asset.id} 
                    asset={asset} 
                    isActive={isActive} 
                    baseUrl={baseUrl}
                    onClick={() => triggerAsset(asset)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Collapsible Console Log Panel */}
        <div className={`logs-panel ${logsCollapsed ? 'collapsed' : ''}`}>
          <div className="logs-header" onClick={() => setLogsCollapsed(!logsCollapsed)}>
            <div className="logs-header-title">
              <Activity style={{ width: 15, height: 15 }} />
              Registro de eventos
            </div>
            <div>
              {logsCollapsed ? (
                <ChevronUp style={{ width: 16, height: 16, color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronDown style={{ width: 16, height: 16, color: 'var(--color-text-muted)' }} />
              )}
            </div>
          </div>
          <div className="logs-body">
            {logs.map((log, idx) => (
              <div key={idx} className={`log-row ${log.type}`}>
                <span className="log-time">[{log.time}]</span>
                {log.message}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </main>

      {/* Connection Configurations Modal overlay */}
      <div className={`modal-overlay ${showConfigModal ? 'active' : ''}`}>
        <form onSubmit={handleSaveConfig} className="modal-card">
          <h2 className="modal-title">
            <Settings style={{ width: 22, height: 22, color: 'var(--color-primary)' }} />
            Configurar TriggerStudio
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-input-group">
              <label className="form-label">Dirección IP del Servidor</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Ej: localhost o 192.168.1.150"
                value={tempIp}
                onChange={e => setTempIp(e.target.value)}
                required
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', lineHeight: 1.3 }}>
                Dirección local (LAN) de la PC principal donde se ejecuta OBS Studio.
              </span>
            </div>

            <div className="form-input-group">
              <label className="form-label">Puerto del Servidor</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Ej: 2188"
                value={tempPort}
                onChange={e => setTempPort(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="modal-footer">
            <button 
              type="button" 
              className="btn-premium"
              style={{ background: 'transparent', color: 'var(--color-text-muted)' }}
              onClick={() => {
                // Only allow canceling if we already have some loaded connection state
                if (isConnected || assets.length > 0) {
                  setShowConfigModal(false);
                } else {
                  addLog('Debe configurar una IP y Puerto válidos para iniciar.', 'warning');
                }
              }}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-premium btn-premium-primary">
              Guardar y Conectar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Subcomponent for Media Asset Card to handle its own fallback and image errors
function AssetCard({ 
  asset, 
  isActive, 
  baseUrl, 
  onClick 
}: { 
  asset: MediaAsset; 
  isActive: boolean; 
  baseUrl: string; 
  onClick: () => void; 
}) {
  const [imgError, setImgError] = useState(false);

  // Type-specific fallback details
  const fallbackInfo = useMemo(() => {
    switch (asset.type) {
      case 'video':
        return { icon: <Tv className="asset-fallback-icon" />, badgeClass: 'badge-video' };
      case 'audio':
        return { icon: <Volume2 className="asset-fallback-icon" />, badgeClass: 'badge-audio' };
      case 'image':
      default:
        return { icon: <ImageIcon className="asset-fallback-icon" />, badgeClass: 'badge-image' };
    }
  }, [asset.type]);

  const thumbUrl = asset.thumbnail ? `${baseUrl}${asset.thumbnail}` : undefined;

  return (
    <div className={`asset-card ${isActive ? 'playing' : ''}`} onClick={onClick}>
      <span className={`asset-type-badge ${fallbackInfo.badgeClass}`}>
        {asset.type}
      </span>

      <div className="asset-thumbnail-container">
        {thumbUrl && !imgError ? (
          <img 
            className="asset-thumbnail-img" 
            src={thumbUrl} 
            alt={asset.name} 
            onError={() => setImgError(true)} 
          />
        ) : (
          fallbackInfo.icon
        )}
      </div>

      <div className="asset-info">
        <div className="asset-card-title">{asset.name}</div>
      </div>
    </div>
  );
}
