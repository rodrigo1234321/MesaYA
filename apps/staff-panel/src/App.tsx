import React, { useEffect, useState } from 'react';
import { StaffUserDTO } from '@mesaya/shared';
import { StaffApi } from './lib/api';
import { useSSE } from './hooks/useSSE';
import { LoginModal } from './components/LoginModal';
import { WaitlistManager } from './components/WaitlistManager';
import { RewardsManager } from './components/RewardsManager';
import { ServiceWorkspace } from './components/ServiceWorkspace';
import { playChimeAlert, unlockAudio, getAudioState } from './lib/audio';
import { Bell, ExternalLink, Gift, LayoutDashboard, UserRound, Users, Volume2, VolumeX } from 'lucide-react';

type ActiveTab = 'service' | 'waitlist' | 'rewards';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<StaffUserDTO | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('service');
  const [moreOpen, setMoreOpen] = useState(false);
  const [audioActive, setAudioActive] = useState(false);

  useEffect(() => {
    const checkAudio = () => setAudioActive(getAudioState() === 'running');
    checkAudio();
    const interval = setInterval(checkAudio, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const saved = StaffApi.getSavedUser();
    if (!saved) return;
    StaffApi.getActiveCalls(saved.restaurantId)
      .then(() => setCurrentUser(saved))
      .catch(() => {
        StaffApi.logout();
        setCurrentUser(null);
      });
  }, []);

  // E07: Servicio es la única pantalla operativa. El snapshot centralizado ya
  // incluye llamados, cocina, cuentas y mapa; no se usa polling legacy.
  const { connected, calls } = useSSE(
    currentUser?.restaurantId || null,
    undefined,
    false
  );

  const selectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setMoreOpen(false);
  };

  const handleLogout = () => {
    StaffApi.logout();
    setCurrentUser(null);
    setActiveTab('service');
    setMoreOpen(false);
  };

  if (!currentUser) return <LoginModal onSuccess={(user) => setCurrentUser(user)} />;

  const clientUrl = (import.meta.env.VITE_CLIENT_URL as string) ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? ':5173' : (window.location.port ? `:${window.location.port}` : '')}/?r=${encodeURIComponent(currentUser.restaurantId)}&m=Mesa%201`
      : 'http://localhost:5173');

  return (
    <div className="min-h-full flex flex-col w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      <header className="space-y-4">
      <div className="p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 font-bold min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${activeTab === 'service' || connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className={`${activeTab === 'service' || connected ? 'text-emerald-200' : 'text-amber-200'} truncate`}>
            {activeTab === 'service' ? 'Servicio centralizado' : connected ? 'Terminal sincronizado' : 'Sin conexión (reintentando)'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => { unlockAudio(); setAudioActive(true); }} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 border ${audioActive ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse'}`} title={audioActive ? 'Alertas sonoras activas' : 'Toca para activar alertas sonoras'}>
            {audioActive ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}<span className="hidden sm:inline">{audioActive ? 'Audio OK' : 'Activar audio'}</span>
          </button>
          <a href={clientUrl} target="_blank" rel="noreferrer" title="Abrir vista de cliente de prueba" aria-label="Abrir vista de cliente de prueba" className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition-all flex items-center gap-1 border border-slate-700"><span className="hidden sm:inline">Vista cliente</span><ExternalLink className="w-3.5 h-3.5" /></a>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 shrink-0"><LayoutDashboard className="w-5 h-5" /></div>
          <div className="min-w-0"><h1 className="font-extrabold text-base text-white tracking-tight truncate">{currentUser.restaurantName}</h1><div className="flex items-center gap-2 mt-0.5"><span className="text-xs font-semibold text-indigo-300 truncate">{currentUser.name}</span><span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">{currentUser.role}</span></div></div>
        </div>
        <div className="flex items-center space-x-2 shrink-0"><button type="button" onClick={() => { unlockAudio(); playChimeAlert(); }} title="Probar sonido de timbre" aria-label="Probar sonido de timbre" className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold"><Volume2 className="w-4 h-4 text-indigo-400" /><span className="hidden sm:inline">Probar timbre</span></button><button type="button" onClick={handleLogout} title="Cambiar operador en este terminal" className="px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-indigo-300 flex items-center gap-1.5 text-[11px] font-bold"><UserRound className="w-4 h-4" /><span className="hidden sm:inline">Cambiar operador</span></button></div>
      </div>
      </header>

      <main className="space-y-4">
      <nav className="grid grid-cols-2 gap-1.5 bg-slate-900/90 border border-slate-800 p-1 rounded-2xl text-[11px] font-bold" aria-label="Navegación operativa">
        <button type="button" onClick={() => selectTab('service')} className={`py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all ${activeTab === 'service' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`} aria-current={activeTab === 'service' ? 'page' : undefined}><LayoutDashboard className="w-3.5 h-3.5" /><span>Servicio</span></button>
        <div className="relative"><button type="button" onClick={() => setMoreOpen((open) => !open)} className={`w-full h-full py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all ${moreOpen || activeTab === 'waitlist' || activeTab === 'rewards' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`} aria-expanded={moreOpen}>Más <span aria-hidden="true">⌄</span></button>{moreOpen && <div className="absolute right-0 top-[calc(100%+0.4rem)] z-20 w-44 rounded-2xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl"><button type="button" onClick={() => selectTab('waitlist')} className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-200 hover:bg-slate-800 flex items-center gap-2"><Users className="w-4 h-4 text-cyan-300" /> Fila puerta</button><button type="button" onClick={() => selectTab('rewards')} className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-200 hover:bg-slate-800 flex items-center gap-2"><Gift className="w-4 h-4 text-rose-300" /> Rewards</button></div>}</div>
      </nav>

      {activeTab !== 'service' && calls.length > 0 && <button type="button" onClick={() => selectTab('service')} className="w-full rounded-2xl border border-rose-500/50 bg-rose-950/30 px-3.5 py-3 text-left text-xs text-rose-100 flex items-center justify-between gap-3 hover:bg-rose-950/50" aria-live="polite"><span className="flex items-center gap-2 font-bold"><Bell className="w-4 h-4 text-rose-300 shrink-0" />{calls.length === 1 ? 'Hay 1 llamado activo' : `Hay ${calls.length} llamados activos`}</span><span className="font-black text-rose-300 whitespace-nowrap">Abrir Servicio →</span></button>}

      {activeTab === 'service' ? <ServiceWorkspace restaurantId={currentUser.restaurantId} currentUser={currentUser} /> : activeTab === 'waitlist' ? <WaitlistManager restaurantId={currentUser.restaurantId} /> : <RewardsManager restaurantId={currentUser.restaurantId} />}
      </main>
    </div>
  );
};
