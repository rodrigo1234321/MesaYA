import React, { useEffect, useState, useRef } from 'react';
import { StaffUserDTO } from '@mesaya/shared';
import { StaffApi } from './lib/api';
import { useServiceSync } from './hooks/useServiceSync';
import { LoginModal } from './components/LoginModal';
import { OperatorPinModal } from './components/OperatorPinModal';
import { WaitlistManager } from './components/WaitlistManager';
import { RewardsManager } from './components/RewardsManager';
import { KitchenOrdersManager } from './components/KitchenOrdersManager';
import { ServiceWorkspace } from './components/ServiceWorkspace';
import { ErrorBoundary } from './components/ErrorBoundary';
import { playChimeAlert, unlockAudio, getAudioState } from './lib/audio';
import { Bell, ExternalLink, Gift, LayoutDashboard, LockKeyhole, UserRound, Users, Volume2, VolumeX, LogIn, UtensilsCrossed } from 'lucide-react';

type ActiveTab = 'service' | 'waitlist' | 'rewards' | 'kitchen';

interface RestaurantInfo {
  id: string;
  name: string;
  slug: string;
}

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<StaffUserDTO | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<{ label: string; action?: () => void } | null>(null);

  // E14: Soporte de ruta directa y persistencia por query param / path (?view=kitchen o /kitchen)
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view') || params.get('tab') || params.get('station');
      if (view === 'kitchen' || window.location.pathname === '/kitchen') return 'kitchen';
      if (view === 'waitlist') return 'waitlist';
      if (view === 'rewards') return 'rewards';
    }
    return 'service';
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [audioActive, setAudioActive] = useState(false);

  // E11: Soporte de Escape para cerrar el menú Más y restaurar foco
  useEffect(() => {
    if (!moreOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moreOpen]);

  useEffect(() => {
    const checkAudio = () => setAudioActive(getAudioState() === 'running');
    checkAudio();
    const interval = setInterval(checkAudio, 2500);
    return () => clearInterval(interval);
  }, []);

  // Carga inicial y reconciliación de sesión
  useEffect(() => {
    const savedUser = StaffApi.getSavedUser();
    const savedRestaurant = StaffApi.getSavedRestaurant();

    if (savedUser) {
      setCurrentUser(savedUser);
      setRestaurant({
        id: savedUser.restaurantId,
        name: savedUser.restaurantName || savedUser.restaurantId,
        slug: savedRestaurant?.slug || savedUser.restaurantId
      });
      StaffApi.getActiveCalls(savedUser.restaurantId)
        .catch(() => {
          StaffApi.lockOperator();
          setCurrentUser(null);
        });
    } else if (savedRestaurant) {
      setRestaurant(savedRestaurant);
    }
  }, []);

  // Inactividad de operador (S09): tras 5 min de inactividad, bloquea la sesión del mozo
  // pero mantiene el puesto activo y el tablero visible sin exponer datos personales.
  useEffect(() => {
    if (!currentUser) return;
    const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        StaffApi.lockOperator();
        setCurrentUser(null);
        setPinModalOpen(false);
        setPendingAction(null);
      }, INACTIVITY_TIMEOUT_MS);
    };

    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [currentUser]);

  const activeRestaurantId = currentUser?.restaurantId || restaurant?.id || null;

  // Conexión centralizada única en tiempo real (E08: shell como único dueño de polling)
  const {
    connected,
    syncState,
    lastSuccessTimestamp,
    secondsSinceLastSuccess,
    snapshot,
    unattendedCallsCount,
    urgentTasksCount,
    refresh: refreshSync
  } = useServiceSync(
    activeRestaurantId,
    Boolean(activeRestaurantId)
  );

  const selectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setMoreOpen(false);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const url = new URL(window.location.href);
      if (tab === 'service') {
        url.searchParams.delete('view');
        url.searchParams.delete('tab');
        url.searchParams.delete('station');
      } else {
        url.searchParams.set('view', tab);
      }
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleLock = () => {
    StaffApi.lockOperator();
    setCurrentUser(null);
    setPendingAction(null);
  };

  const handleOpenPinModal = (action?: { label: string; action?: () => void }) => {
    setPendingAction(action || null);
    setPinModalOpen(true);
  };

  const handlePinSuccess = (user: StaffUserDTO) => {
    setCurrentUser(user);
    if (!restaurant) {
      setRestaurant({
        id: user.restaurantId,
        name: user.restaurantName || user.restaurantId,
        slug: user.restaurantId
      });
    }
    setPinModalOpen(false);
    if (pendingAction?.action) {
      try {
        pendingAction.action();
      } catch (err) {
        console.error('Error al ejecutar acción pendiente:', err);
      }
    }
    setPendingAction(null);
  };

  // Si no hay ningún restaurante configurado en el terminal, mostrar onboarding inicial de tablet
  if (!restaurant && !currentUser) {
    return (
      <LoginModal
        onSuccess={(user) => {
          setCurrentUser(user);
          setRestaurant({
            id: user.restaurantId,
            name: user.restaurantName || user.restaurantId,
            slug: user.restaurantId
          });
        }}
      />
    );
  }

  const effectiveRestaurantId = activeRestaurantId!;
  const effectiveRestaurantName = restaurant?.name || currentUser?.restaurantName || 'Salón MesaYA';

  const clientUrl = (import.meta.env.VITE_CLIENT_URL as string) ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? ':5173' : (window.location.port ? `:${window.location.port}` : '')}/?r=${encodeURIComponent(effectiveRestaurantId)}&m=Mesa%201`
      : 'http://localhost:5173');

  return (
    <div className="min-h-full flex flex-col w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      <header className="space-y-4">
        {/* Barra de estado y conectividad real (H07 corregido: nunca verde si no hay red, S11 con tiempo transcurrido) */}
        <div className="p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-bold min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                syncState === 'connected'
                  ? 'bg-emerald-400 shadow-sm shadow-emerald-500/50'
                  : syncState === 'stale'
                  ? 'bg-amber-400'
                  : syncState === 'auth_error'
                  ? 'bg-rose-500'
                  : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span className={`${syncState === 'connected' ? 'text-emerald-200' : syncState === 'auth_error' ? 'text-rose-300' : 'text-amber-200'} truncate font-semibold`}>
              {syncState === 'connected'
                ? `Terminal sincronizado · hace ${secondsSinceLastSuccess ?? 0}s`
                : syncState === 'stale'
                ? `Sincronización demorada · hace ${secondsSinceLastSuccess}s`
                : syncState === 'auth_error'
                ? 'Autorización de puesto vencida (reingrese PIN)'
                : lastSuccessTimestamp
                ? `Sin conexión · reintentando (hace ${secondsSinceLastSuccess}s)`
                : 'Conectando con el salón...'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { unlockAudio(); playChimeAlert(); setAudioActive(true); }}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 border ${
                audioActive ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse'
              }`}
              title={audioActive ? 'Alertas sonoras probadas y activas' : 'Toca para probar y activar alertas sonoras'}
            >
              {audioActive ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{audioActive ? 'Audio OK' : 'Probar sonido'}</span>
            </button>
            <a
              href={clientUrl}
              target="_blank"
              rel="noreferrer"
              title="Abrir vista de cliente de prueba"
              aria-label="Abrir vista de cliente de prueba"
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition-all flex items-center gap-1 border border-slate-700"
            >
              <span className="hidden sm:inline">Vista cliente</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Cabecera del puesto con operador e identidad de local */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 shrink-0">
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-extrabold text-base text-white tracking-tight truncate">
                {effectiveRestaurantName}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                {currentUser ? (
                  <>
                    <span className="text-xs font-semibold text-indigo-300 truncate">{currentUser.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                      {currentUser.role}
                    </span>
                    {activeTab === 'kitchen' && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                        Estación: Cocina KDS
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs font-semibold text-amber-400/90 flex items-center gap-1">
                    <LockKeyhole className="w-3 h-3" /> Puesto bloqueado (vista protegida)
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={() => { unlockAudio(); playChimeAlert(); }}
              title="Probar sonido de timbre"
              aria-label="Probar sonido de timbre"
              className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none transition-colors"
            >
              <Volume2 className="w-4 h-4 text-indigo-400" />
              <span className="hidden sm:inline">Probar timbre</span>
            </button>
            {currentUser ? (
              <>
                <button
                  type="button"
                  onClick={handleLock}
                  title="Bloquear pantalla de operador (requiere PIN)"
                  className="px-3.5 py-2.5 min-h-[48px] rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-700/60 text-slate-300 hover:text-amber-300 flex items-center gap-2 text-xs sm:text-sm font-bold focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none transition-colors"
                >
                  <LockKeyhole className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Bloquear</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenPinModal()}
                  title="Cambiar de mozo en este puesto compartido"
                  className="px-3.5 py-2.5 min-h-[48px] rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-indigo-300 flex items-center gap-2 text-xs sm:text-sm font-bold focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none transition-colors"
                >
                  <UserRound className="w-4 h-4" />
                  <span className="hidden sm:inline">Cambiar mozo</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleOpenPinModal()}
                className="px-4 py-2.5 min-h-[48px] rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-2 text-xs sm:text-sm font-bold shadow-md shadow-indigo-600/30 focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none transition-all"
              >
                <LogIn className="w-4 h-4" />
                <span>Ingresar PIN</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="space-y-4">
        <nav className="grid grid-cols-2 gap-2 bg-slate-900/90 border border-slate-800 p-1.5 rounded-2xl text-xs sm:text-sm font-bold" aria-label="Navegación operativa">
          <button
            type="button"
            onClick={() => selectTab('service')}
            className={`min-h-[48px] py-3 px-3 sm:px-4 rounded-xl flex items-center justify-center gap-2 transition-all focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none ${
              activeTab === 'service' ? 'bg-indigo-600 text-white shadow-sm font-black' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
            aria-current={activeTab === 'service' ? 'page' : undefined}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Servicio</span>
          </button>
          <div className="relative">
            <button
              ref={moreButtonRef}
              id="more-menu-button"
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              className={`w-full min-h-[48px] py-3 px-3 sm:px-4 rounded-xl flex items-center justify-center gap-2 transition-all focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none ${
                moreOpen || activeTab === 'waitlist' || activeTab === 'rewards' ? 'bg-slate-700 text-white font-black' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-controls="more-menu-dropdown"
            >
              <span>Más</span>
              <span aria-hidden="true" className="text-xs">▾</span>
            </button>
            {moreOpen && (
              <div
                id="more-menu-dropdown"
                role="menu"
                aria-labelledby="more-menu-button"
                className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-52 rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl space-y-1.5"
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => selectTab('kitchen')}
                  className="w-full min-h-[48px] rounded-xl px-3.5 py-3 text-left text-xs sm:text-sm font-bold text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
                >
                  <UtensilsCrossed className="w-4 h-4 text-amber-400" /> Cocina (KDS)
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => selectTab('waitlist')}
                  className="w-full min-h-[48px] rounded-xl px-3.5 py-3 text-left text-xs sm:text-sm font-bold text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
                >
                  <Users className="w-4 h-4 text-cyan-300" /> Fila puerta
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => selectTab('rewards')}
                  className="w-full min-h-[48px] rounded-xl px-3.5 py-3 text-left text-xs sm:text-sm font-bold text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
                >
                  <Gift className="w-4 h-4 text-rose-300" /> Rewards
                </button>
              </div>
            )}
          </div>
        </nav>

        {activeTab !== 'service' && (unattendedCallsCount > 0 || urgentTasksCount > 0) && (
          <button
            type="button"
            onClick={() => selectTab('service')}
            className="w-full min-h-[48px] rounded-2xl border border-rose-500/50 bg-rose-950/30 px-4 py-3 text-left text-xs sm:text-sm text-rose-100 flex items-center justify-between gap-3 hover:bg-rose-950/50 transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
            aria-live="polite"
          >
            <span className="flex items-center gap-2 font-bold">
              <Bell className="w-4 h-4 text-rose-300 shrink-0 animate-bounce" />
              {unattendedCallsCount > 0
                ? (unattendedCallsCount === 1 ? 'Hay 1 llamado activo en salón' : `Hay ${unattendedCallsCount} llamados activos en salón`)
                : (urgentTasksCount === 1 ? 'Hay 1 tarea urgente en salón' : `Hay ${urgentTasksCount} tareas urgentes en salón`)}
            </span>
            <span className="font-black text-rose-300 whitespace-nowrap">Abrir Atención →</span>
          </button>
        )}

        {activeTab === 'service' ? (
          <ErrorBoundary
            isolate
            fallbackTitle="Error en Área de Atención / Salón"
            fallbackMessage="Ocurrió un problema al cargar el área de servicio de mesas. Puedes reintentar sin perder tu sesión."
            onReset={refreshSync}
          >
            <ServiceWorkspace
              restaurantId={effectiveRestaurantId}
              currentUser={currentUser!}
              onRequireOperatorPin={(action) => handleOpenPinModal(action)}
              syncSnapshot={snapshot}
              syncLoading={!snapshot && connected === false && !lastSuccessTimestamp}
              syncError={syncState === 'auth_error' ? 'Sesión de staff expirada' : undefined}
              syncLastSuccessTimestamp={lastSuccessTimestamp}
              onRefresh={refreshSync}
            />
          </ErrorBoundary>
        ) : activeTab === 'kitchen' ? (
          <ErrorBoundary
            isolate
            fallbackTitle="Error en Cocina (KDS)"
            fallbackMessage="Ocurrió un problema en la pantalla de comandas de cocina. Puedes reintentar cargar las órdenes."
          >
            <KitchenOrdersManager restaurantId={effectiveRestaurantId} />
          </ErrorBoundary>
        ) : activeTab === 'waitlist' ? (
          <ErrorBoundary
            isolate
            fallbackTitle="Error en Fila de Puerta"
            fallbackMessage="Ocurrió un problema en la lista de espera de comensales. Puedes reintentar cargar la fila."
          >
            <WaitlistManager restaurantId={effectiveRestaurantId} />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary
            isolate
            fallbackTitle="Error en Fidelización / Rewards"
            fallbackMessage="Ocurrió un problema en el módulo de fidelización. Puedes reintentar cargar las recompensas."
          >
            <RewardsManager restaurantId={effectiveRestaurantId} />
          </ErrorBoundary>
        )}
      </main>

      {/* Modal flotante de PIN para cambio de operador sin desmontar pantalla (E07) */}
      <OperatorPinModal
        isOpen={pinModalOpen}
        restaurantSlug={restaurant?.slug || effectiveRestaurantId}
        restaurantName={effectiveRestaurantName}
        currentOperatorName={currentUser?.name}
        pendingActionLabel={pendingAction?.label}
        canClose={Boolean(currentUser)}
        onSuccess={handlePinSuccess}
        onClose={() => setPinModalOpen(false)}
      />
    </div>
  );
};
