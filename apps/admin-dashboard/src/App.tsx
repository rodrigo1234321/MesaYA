import React, { useEffect, useState } from 'react';
import { AdminApi, TableItem, RestaurantItem } from './lib/api';
import { TablesManager } from './components/TablesManager';
import { MenuManager } from './components/MenuManager';
import { ShiftManager } from './components/ShiftManager';
import { MetricsView } from './components/MetricsView';
import { StaffManager } from './components/StaffManager';
import { ModuleConfigManager } from './components/ModuleConfigManager';
import { FloorPlanManager } from './components/FloorPlan/FloorPlanManager';
import { RTMSAnalyticsView } from './components/RTMSAnalyticsView';
import { SalesManager } from './components/SalesManager';
import { Utensils, LayoutGrid, BookOpen, Users, BarChart3, RefreshCw, Plus, Store, ChevronDown, Sliders, Map, DollarSign } from 'lucide-react';

export const App: React.FC = () => {
  const publicOnboardingEnabled = import.meta.env.VITE_PUBLIC_ONBOARDING_ENABLED === 'true';
  const [restaurants, setRestaurants] = useState<RestaurantItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>(() => {
    const saved = AdminApi.getSavedRestaurant();
    return saved?.slug || '';
  });

  const [activeTab, setActiveTab] = useState<'floorplan' | 'tables' | 'menu' | 'staff' | 'modules' | 'metrics' | 'sales'>('floorplan');
  const activeTabOrder = ['floorplan', 'tables', 'menu', 'modules', 'staff', 'metrics', 'sales'] as const;

  const handleTabListKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = activeTabOrder.indexOf(activeTab);
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % activeTabOrder.length;
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + activeTabOrder.length) % activeTabOrder.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = activeTabOrder.length - 1;
    if (nextIndex !== null) {
      e.preventDefault();
      const next = activeTabOrder[nextIndex];
      setActiveTab(next);
      document.getElementById(`admin-tab-${next}`)?.focus();
    }
  };
  const [tables, setTables] = useState<TableItem[]>([]);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(!AdminApi.getAuthToken());
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [floorPlanRefreshKey, setFloorPlanRefreshKey] = useState(0);

  // New Restaurant Onboarding Modal State
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [regName, setRegName] = useState('');
  const [regSlug, setRegSlug] = useState('');
  const [regPin, setRegPin] = useState('1234');
  const [regTablesCount, setRegTablesCount] = useState(6);
  const [regTemplate, setRegTemplate] = useState('GOURMET_OBSIDIAN');
  const [regError, setRegError] = useState<string | null>(null);
  const [regSubmitting, setRegSubmitting] = useState(false);

  const activeRestaurant = restaurants.find(r => r.slug === selectedSlug || r.id === selectedSlug) || {
    id: selectedSlug,
    slug: selectedSlug,
    name: selectedSlug || 'MesaYA Admin',
    templateId: 'GOURMET_OBSIDIAN',
    themeColor: '#f59e0b',
    createdAt: ''
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await AdminApi.getRestaurants();
      setRestaurants(list);
      const targetSlug = list.some(r => r.slug === selectedSlug || r.id === selectedSlug)
        ? selectedSlug
        : (list[0]?.slug || '');
      if (targetSlug !== selectedSlug) setSelectedSlug(targetSlug);

      if (!targetSlug || !AdminApi.getAuthToken()) {
        setTables([]);
        setCurrentShift(null);
        setAuthRequired(true);
        return;
      }

      const [tablesData, shiftData] = await Promise.all([
        AdminApi.getTables(targetSlug),
        AdminApi.getCurrentShift(targetSlug)
      ]);
      setTables(tablesData);
      setCurrentShift(shiftData);
      setAuthRequired(false);
    } catch (err: any) {
      console.error(err);
      if (!AdminApi.getAuthToken()) {
        setAuthRequired(true);
        setTables([]);
        setCurrentShift(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedSlug]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug || !loginPin.trim()) return;
    setLoginSubmitting(true);
    setLoginError(null);
    try {
      await AdminApi.loginAdmin(selectedSlug, loginPin.trim());
      setLoginPin('');
      setAuthRequired(false);
      // El plano y su polling pueden haber fallado antes del PIN; fuerza un
      // nuevo ciclo autenticado sin depender de cambiar de pestaña.
      setFloorPlanRefreshKey((value) => value + 1);
      await loadData();
    } catch (err: any) {
      setLoginError(err.message || 'No se pudo iniciar sesión');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regSlug.trim()) return;

    setRegSubmitting(true);
    setRegError(null);
    try {
      const res = await AdminApi.registerRestaurant({
        name: regName.trim(),
        slug: regSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        pin: regPin.trim(),
        tablesCount: Number(regTablesCount) || 6,
        templateId: regTemplate
      });

      setShowRegisterModal(false);
      setRegName('');
      setRegSlug('');
      setRestaurants(await AdminApi.getRestaurants());
      setSelectedSlug(res.restaurant.slug);
    } catch (err: any) {
      setRegError(err.message || 'Error al registrar restaurante');
    } finally {
      setRegSubmitting(false);
    }
  };

  return (
    <div className={`min-h-full mx-auto p-4 sm:p-6 space-y-6 ${activeTab === 'floorplan' ? 'max-w-7xl' : 'max-w-5xl'}`}>
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-xl shadow-indigo-600/30 shrink-0">
            <Utensils className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-lg text-white tracking-tight">
                {activeRestaurant.name}
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                {activeRestaurant.slug}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Panel de Control Gastronómico • MesaYA SaaS Multi-Tenant
            </p>
          </div>
        </div>

        {/* Actions & Restaurant Selector */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Restaurant Selector */}
          {restaurants.length > 0 && (
            <div className="relative">
              <select
                value={selectedSlug}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== selectedSlug) {
                    AdminApi.logout();
                    setAuthRequired(true);
                    setTables([]);
                    setCurrentShift(null);
                  }
                  setSelectedSlug(val);
                  const found = restaurants.find(r => r.slug === val);
                  if (found) AdminApi.setSavedRestaurant(found);
                }}
                className="appearance-none bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 pr-8 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {restaurants.map((r) => (
                  <option key={r.id} value={r.slug}>
                    {r.name} ({r.slug})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}

          {publicOnboardingEnabled && (
            <button
              type="button"
              onClick={() => setShowRegisterModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 active:scale-95 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo Local</span>
            </button>
          )}

          <button
            type="button"
            onClick={loadData}
            title="Refrescar Datos"
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold active:scale-95 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </header>

      {/* Shift Controller Card */}
      <ShiftManager
        currentShift={currentShift}
        restaurantId={selectedSlug}
        onRefresh={loadData}
      />

      {/* Tabs Navigation */}
      <div role="tablist" aria-label="Secciones del panel de administración" onKeyDown={handleTabListKeyDown} className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          role="tab"
          id="admin-tab-floorplan"
          aria-selected={activeTab === 'floorplan'}
          aria-controls="admin-panel-floorplan"
          tabIndex={activeTab === 'floorplan' ? 0 : -1}
          onClick={() => setActiveTab('floorplan')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            activeTab === 'floorplan'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Map className="w-4 h-4" aria-hidden="true" />
          <span>Plano en Vivo (Tablet RTMS)</span>
        </button>

        <button
          type="button"
          role="tab"
          id="admin-tab-tables"
          aria-selected={activeTab === 'tables'}
          aria-controls="admin-panel-tables"
          tabIndex={activeTab === 'tables' ? 0 : -1}
          onClick={() => setActiveTab('tables')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            activeTab === 'tables'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <LayoutGrid className="w-4 h-4" aria-hidden="true" />
          <span>Mesas & Códigos QR ({tables.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          id="admin-tab-menu"
          aria-selected={activeTab === 'menu'}
          aria-controls="admin-panel-menu"
          tabIndex={activeTab === 'menu' ? 0 : -1}
          onClick={() => setActiveTab('menu')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            activeTab === 'menu'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <BookOpen className="w-4 h-4 text-amber-400" aria-hidden="true" />
          <span>Carta & Precios</span>
        </button>

        <button
          type="button"
          role="tab"
          id="admin-tab-modules"
          aria-selected={activeTab === 'modules'}
          aria-controls="admin-panel-modules"
          tabIndex={activeTab === 'modules' ? 0 : -1}
          onClick={() => setActiveTab('modules')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            activeTab === 'modules'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Sliders className="w-4 h-4 text-emerald-400" aria-hidden="true" />
          <span>Módulos & Configuración</span>
        </button>

        <button
          type="button"
          role="tab"
          id="admin-tab-staff"
          aria-selected={activeTab === 'staff'}
          aria-controls="admin-panel-staff"
          tabIndex={activeTab === 'staff' ? 0 : -1}
          onClick={() => setActiveTab('staff')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            activeTab === 'staff'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Users className="w-4 h-4" aria-hidden="true" />
          <span>Personal & Mozos</span>
        </button>

        <button
          type="button"
          role="tab"
          id="admin-tab-metrics"
          aria-selected={activeTab === 'metrics'}
          aria-controls="admin-panel-metrics"
          tabIndex={activeTab === 'metrics' ? 0 : -1}
          onClick={() => setActiveTab('metrics')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            activeTab === 'metrics'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <BarChart3 className="w-4 h-4" aria-hidden="true" />
          <span>Métricas & Rendimiento</span>
        </button>

        <button
          type="button"
          role="tab"
          id="admin-tab-sales"
          aria-selected={activeTab === 'sales'}
          aria-controls="admin-panel-sales"
          tabIndex={activeTab === 'sales' ? 0 : -1}
          onClick={() => setActiveTab('sales')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
            activeTab === 'sales'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <DollarSign className="w-4 h-4 text-emerald-300" aria-hidden="true" />
          <span>Ventas y cobros</span>
        </button>
      </div>

      {/* Active Tab Content */}
      <main className="pb-12">
        {activeTab === 'floorplan' && (
          <div role="tabpanel" id="admin-panel-floorplan" aria-labelledby="admin-tab-floorplan">
          <FloorPlanManager restaurantSlug={selectedSlug} refreshKey={floorPlanRefreshKey} />
          </div>
        )}
        {activeTab === 'tables' && (
          <div role="tabpanel" id="admin-panel-tables" aria-labelledby="admin-tab-tables">
          <TablesManager
            tables={tables}
            restaurantId={activeRestaurant.id}
            restaurantSlug={activeRestaurant.slug}
            onRefresh={loadData}
          />
          </div>
        )}
        {activeTab === 'menu' && (
          <div role="tabpanel" id="admin-panel-menu" aria-labelledby="admin-tab-menu">
          <MenuManager
            restaurantId={selectedSlug}
          />
          </div>
        )}
        {activeTab === 'modules' && (
          <div role="tabpanel" id="admin-panel-modules" aria-labelledby="admin-tab-modules">
          <ModuleConfigManager
            restaurantId={activeRestaurant.id}
          />
          </div>
        )}
        {activeTab === 'staff' && (
          <div role="tabpanel" id="admin-panel-staff" aria-labelledby="admin-tab-staff">
          <StaffManager
            restaurantId={activeRestaurant.id}
          />
          </div>
        )}
        {activeTab === 'metrics' && (
          <div role="tabpanel" id="admin-panel-metrics" aria-labelledby="admin-tab-metrics">
          <div className="space-y-8">
            {/* E18: el backend resuelve id o slug; se pasa el slug canónico
                porque el prop se llama restaurantSlug y el plano se resuelve por local. */}
            <RTMSAnalyticsView restaurantSlug={activeRestaurant.slug || activeRestaurant.id} />
            <div className="pt-6 border-t border-slate-800">
              <h3 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-wider">
                Métricas Clásicas de Servicio & Mozo
              </h3>
              <MetricsView restaurantId={activeRestaurant.id} />
            </div>
          </div>
          </div>
        )}
        {activeTab === 'sales' && (
          <div role="tabpanel" id="admin-panel-sales" aria-labelledby="admin-tab-sales">
          <SalesManager restaurantId={activeRestaurant.id} />
          </div>
        )}
      </main>

      {authRequired && restaurants.length > 0 && (
        <div role="dialog" aria-modal="true" aria-labelledby="admin-login-title" className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleLogin} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5 shadow-2xl">
            <div>
              <h2 id="admin-login-title" className="text-lg font-extrabold text-white">Ingresar a Administración</h2>
              <p className="text-xs text-slate-400 mt-1">
                {activeRestaurant.name} · Usá el PIN de encargado.
              </p>
            </div>
            {loginError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs font-semibold">
                {loginError}
              </div>
            )}
            <label htmlFor="admin-login-pin" className="block text-xs font-semibold text-slate-300">
              PIN de encargado
              <input
                id="admin-login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value)}
                placeholder="Ingresá tu PIN"
                autoFocus
                className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-base tracking-widest focus:outline-none focus:border-indigo-500"
              />
            </label>
            <button
              type="submit"
              disabled={loginSubmitting || !loginPin.trim()}
              className="w-full px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-bold"
            >
              {loginSubmitting ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        </div>
      )}

      {/* SaaS Register New Restaurant Modal */}
      {publicOnboardingEnabled && showRegisterModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="admin-register-title" className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleRegisterSubmit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h3 id="admin-register-title" className="text-base font-extrabold text-white">Registrar Nuevo Restaurante</h3>
                <p className="text-xs text-slate-400">Crea un nuevo local con mesas y carta digital propia</p>
              </div>
            </div>

            {regError && (
              <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold">
                {regError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="admin-register-name" className="block text-slate-400 mb-1">Nombre del Restaurante / Bar</label>
                <input
                  id="admin-register-name"
                  type="text"
                  placeholder="Ej: Parrilla El Gaucho, Hamburguesería Holy"
                  value={regName}
                  onChange={(e) => {
                    setRegName(e.target.value);
                    if (!regSlug || regSlug === regName.toLowerCase().replace(/[^a-z0-9]/g, '-')) {
                      setRegSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'));
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="admin-register-slug" className="block text-slate-400 mb-1">Slug URL del Local (Único)</label>
                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-400">
                  <span className="text-[11px] font-mono select-none">mesaya.app/?r=</span>
                  <input
                    id="admin-register-slug"
                    type="text"
                    value={regSlug}
                    onChange={(e) => setRegSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="el-gaucho-mdp"
                    className="w-full bg-transparent text-white font-mono text-xs focus:outline-none pl-1"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="admin-register-pin" className="block text-slate-400 mb-1">PIN Inicial Admin</label>
                  <input
                    id="admin-register-pin"
                    type="password"
                    maxLength={6}
                    value={regPin}
                    onChange={(e) => setRegPin(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="admin-register-tables" className="block text-slate-400 mb-1">Cantidad de Mesas</label>
                  <input
                    id="admin-register-tables"
                    type="number"
                    min={1}
                    max={50}
                    value={regTablesCount}
                    onChange={(e) => setRegTablesCount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="admin-register-template" className="block text-slate-400 mb-1">Plantilla Visual / Estilo</label>
                <select
                  id="admin-register-template"
                  value={regTemplate}
                  onChange={(e) => setRegTemplate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="GOURMET_OBSIDIAN">💎 Gourmet Obsidian (Alta Cocina / Elegante)</option>
                  <option value="NEON_BURGER">⚡ Neon Burger (Street Food / Cervecería)</option>
                  <option value="COASTAL_BEACH">🌊 Coastal Beach (Mariscos / Balneario)</option>
                  <option value="MINIMAL_BISTRO">☕ Minimal Bistro (Cafetería de Especialidad)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={regSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {regSubmitting ? 'Registrando...' : 'Crear Restaurante'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
