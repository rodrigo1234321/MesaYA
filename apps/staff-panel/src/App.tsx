import React, { useState, useEffect } from 'react';
import { StaffUserDTO, Sector, CallStatus } from '@mesaya/shared';
import { StaffApi } from './lib/api';
import { useSSE } from './hooks/useSSE';
import { CallCard } from './components/CallCard';
import { SectorFilter } from './components/SectorFilter';
import { LoginModal } from './components/LoginModal';
import { WaitlistManager } from './components/WaitlistManager';
import { KitchenOrdersManager } from './components/KitchenOrdersManager';
import { playChimeAlert, unlockAudio, getAudioState } from './lib/audio';
import { Bell, Volume2, VolumeX, LogOut, CheckCheck, UtensilsCrossed, ExternalLink, Users, ChefHat } from 'lucide-react';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<StaffUserDTO | null>(null);
  const [selectedSector, setSelectedSector] = useState<Sector | 'ALL'>('ALL');
  const [activeTab, setActiveTab] = useState<'calls' | 'kitchen' | 'waitlist'>('calls');
  const [resolvedTodayCount, setResolvedTodayCount] = useState<number>(0);
  const [audioActive, setAudioActive] = useState<boolean>(false);

  useEffect(() => {
    const checkAudio = () => {
      setAudioActive(getAudioState() === 'running');
    };
    checkAudio();
    const interval = setInterval(checkAudio, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const saved = StaffApi.getSavedUser();
    if (saved) {
      // Validate saved user session against backend
      StaffApi.getActiveCalls(saved.restaurantId)
        .then(() => {
          setCurrentUser(saved);
          if (saved.assignedSector) {
            setSelectedSector(saved.assignedSector);
          }
        })
        .catch(() => {
          // Stale cached user from earlier DB session
          StaffApi.logout();
          setCurrentUser(null);
        });
    }
  }, []);

  const { connected, calls, setCalls } = useSSE(
    currentUser?.restaurantId || null
  );

  const handleAcknowledge = async (id: string) => {
    try {
      const updated = await StaffApi.updateCallStatus(id, CallStatus.IN_PROGRESS);
      setCalls(prev => prev.map(c => c.id === id ? updated : c));
    } catch (err) {
      console.error('Error al marcar en camino:', err);
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await StaffApi.updateCallStatus(id, CallStatus.RESOLVED);
      setCalls(prev => prev.filter(c => c.id !== id));
      setResolvedTodayCount(prev => prev + 1);
    } catch (err) {
      console.error('Error al resolver:', err);
    }
  };

  const handleReleaseTable = async (tableId: string, callId: string) => {
    if (!window.confirm('¿Confirmas que la mesa se retiró? Esto cerrará la sesión e invalidará el link para evitar llamados fantasma.')) {
      return;
    }
    try {
      await StaffApi.closeTableSession(tableId);
      setCalls(prev => prev.filter(c => c.id !== callId));
      setResolvedTodayCount(prev => prev + 1);
    } catch (err) {
      console.error('Error al liberar mesa:', err);
    }
  };

  const handleLogout = () => {
    StaffApi.logout();
    setCurrentUser(null);
  };

  if (!currentUser) {
    return <LoginModal onSuccess={(user) => setCurrentUser(user)} />;
  }

  // Filter calls by sector
  const filteredCalls = selectedSector === 'ALL'
    ? calls
    : calls.filter(c => c.sector === selectedSector);

  // Sort calls: overdue/pending first, then oldest
  const sortedCalls = [...filteredCalls].sort((a, b) => {
    if (a.status === CallStatus.PENDING && b.status !== CallStatus.PENDING) return -1;
    if (a.status !== CallStatus.PENDING && b.status === CallStatus.PENDING) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  // Calculate counts per sector
  const countsBySector: Record<string, number> = {};
  for (const c of calls) {
    countsBySector[c.sector] = (countsBySector[c.sector] || 0) + 1;
  }

  return (
    <div className="min-h-full flex flex-col max-w-xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Navigation Switcher Pill & Audio Status */}
      <div className="p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-bold">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`}></span>
          <span className={connected ? 'text-indigo-300' : 'text-red-400'}>
            {connected ? '🔔 Panel Mozo PWA' : '⚠️ Sin conexión (desactualizado)'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              unlockAudio();
              setAudioActive(true);
            }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 border ${
              audioActive
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse'
            }`}
            title={audioActive ? 'Alertas sonoras activas' : 'Audio pausado. Toca para activar.'}
          >
            {audioActive ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 text-amber-400" />}
            <span>{audioActive ? 'Audio OK' : 'Activar Audio'}</span>
          </button>
          <a
            href={
              (import.meta.env.VITE_CLIENT_URL as string) ||
              (typeof window !== 'undefined'
                ? `${window.location.protocol}//${window.location.hostname}${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? ':5173' : (window.location.port ? `:${window.location.port}` : '')}/?r=${encodeURIComponent(currentUser.restaurantId)}&m=Mesa%201`
                : 'http://localhost:5173')
            }
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition-all flex items-center gap-1 border border-slate-700"
          >
            <span>Mesa 1</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Top App Bar */}
      <header className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-base text-white tracking-tight flex items-center gap-2">
              {currentUser.restaurantName}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-semibold text-indigo-300">
                {currentUser.name}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                {currentUser.role}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Audio Chime Test */}
          <button
            onClick={() => {
              unlockAudio();
              playChimeAlert();
            }}
            title="Probar sonido de timbre"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold active:scale-95 transition-all"
          >
            <Volume2 className="w-4 h-4 text-indigo-400" />
            <span className="hidden sm:inline">Probar Timbre</span>
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-red-400 active:scale-95 transition-all"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Mode Switcher: Mesas vs Cocina/Comandas vs Fila Virtual */}
      <div className="grid grid-cols-3 gap-2 bg-slate-900/90 border border-slate-800 p-1 rounded-2xl text-xs font-bold">
        <button
          onClick={() => setActiveTab('calls')}
          className={`py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'calls'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Llamados ({calls.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('kitchen')}
          className={`py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'kitchen'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ChefHat className="w-3.5 h-3.5" />
          <span>Cocina / KDS</span>
        </button>

        <button
          onClick={() => setActiveTab('waitlist')}
          className={`py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'waitlist'
              ? 'bg-cyan-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Fila Puerta</span>
        </button>
      </div>

      {activeTab === 'kitchen' ? (
        <KitchenOrdersManager restaurantId={currentUser.restaurantId} />
      ) : activeTab === 'waitlist' ? (
        <WaitlistManager restaurantId={currentUser.restaurantId} />
      ) : (
        <>
          {/* Live Polling Status Bar */}
          <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
            <div className="flex items-center space-x-2">
              <span className="relative flex h-2.5 w-2.5">
                {connected ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 animate-pulse"></span>
                )}
              </span>
              <span className="font-semibold text-slate-300">
                {connected ? 'En vivo (Sincronizado)' : 'Sincronizando con el salón...'}
              </span>
            </div>

            <div className="flex items-center space-x-3 text-slate-400 font-medium">
              <span className="flex items-center gap-1">
                <Bell className="w-3.5 h-3.5 text-amber-400" />
                <strong className="text-white">{calls.length}</strong> activos
              </span>
              <span className="flex items-center gap-1">
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                <strong className="text-white">{resolvedTodayCount}</strong> atendidos
              </span>
            </div>
          </div>

          {/* Sector Filter Bar */}
          <SectorFilter
            selectedSector={selectedSector}
            onSelectSector={setSelectedSector}
            countsBySector={countsBySector}
          />

          {/* Calls List */}
          <main className="flex-1 space-y-3 pb-8">
            {sortedCalls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                  <CheckCheck className="w-7 h-7 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-200">¡Salón al día!</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs">
                    No hay llamados pendientes {selectedSector !== 'ALL' && `en ${selectedSector}`}. El panel te alertará con sonido apenas una mesa solicite algo.
                  </p>
                </div>
              </div>
            ) : (
              sortedCalls.map(call => (
                <CallCard
                  key={call.id}
                  call={call}
                  onAcknowledge={handleAcknowledge}
                  onResolve={handleResolve}
                  onReleaseTable={handleReleaseTable}
                />
              ))
            )}
          </main>
        </>
      )}
    </div>
  );
};
