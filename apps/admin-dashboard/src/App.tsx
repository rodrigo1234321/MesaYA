import React, { useCallback, useEffect, useState } from 'react';
import { AdminApi, TableItem, RestaurantItem } from './lib/api';
import { TablesManager } from './components/TablesManager';
import { MenuManager } from './components/MenuManager';
import { ShiftManager } from './components/ShiftManager';
import { MetricsView } from './components/MetricsView';
import { StaffManager } from './components/StaffManager';
import { ModuleConfigManager } from './components/ModuleConfigManager';
import { FloorPlanManager } from './components/FloorPlan/FloorPlanManager';
import { RTMSAnalyticsView } from './components/RTMSAnalyticsView';
import { Utensils, LayoutGrid, BookOpen, Users, BarChart3, RefreshCw, Plus, Store, ChevronDown, Sliders, Map, LogOut, Lock } from 'lucide-react';

const ADMIN_PIN_PATTERN = /^\d{4,6}$/;
// Registro público oculto salvo flag Vite explícito C05 (nunca por defecto).
// Contrato exacto: VITE_PILOT_PUBLIC_ONBOARDING_ENABLED === 'true'.
const PUBLIC_ONBOARDING_ENABLED = (import.meta as any).env?.VITE_PILOT_PUBLIC_ONBOARDING_ENABLED === 'true';

const AdminLoginModal: React.FC<{
  slug: string;
  onSlugChange: (s: string) => void;
  restaurants: RestaurantItem[];
  onSuccess: () => void;
}> = ({ slug, onSlugChange, restaurants, onSuccess }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!ADMIN_PIN_PATTERN.test(pin)) {
      setError('El PIN debe tener entre 4 y 6 dígitos numéricos, sin espacios.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await AdminApi.loginAdmin(slug, pin);
      setPin('');
      onSuccess();
    } catch (err: any) {
      // Mensaje visible; expiración 401/403 se propaga como error de sesión.
      setError(err.message || 'PIN o restaurante incorrecto');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-black text-white">Acceso Administrador</h2>
          <p className="text-xs text-slate-400">Iniciá sesión con tu PIN de 4 a 6 dígitos para operar el panel.</p>
        </div>
        {restaurants.length > 0 ? (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-400">Restaurante / Local</label>
            <select
              value={slug}
              onChange={(e) => onSlugChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
            >
              {restaurants.map((r) => (
                <option key={r.id} value={r.slug}>{r.name} ({r.slug})</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-400">Slug del restaurante</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => onSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="mi-local"
              autoComplete="off"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
            />
            <p className="text-[11px] text-slate-500">La lista pública está vacía o no cargó: escribí el slug manualmente.</p>
          </div>
        )}
        {error && <p role="alert" className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold">{error}</p>}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">PIN Administrador (4–6 dígitos)</label>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono text-center tracking-widest focus:outline-none focus:border-indigo-500"
            placeholder="••••"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !ADMIN_PIN_PATTERN.test(pin)}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs disabled:opacity-40 active:scale-95 transition-all"
        >
          {loading ? 'Verificando…' : 'Iniciar sesión'}
        </button>
      </form>
    </div>
  );
};

export const App: React.FC = () => {
  const [restaurants, setRestaurants] = useState<RestaurantItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>(() => {
    const saved = AdminApi.getSavedRestaurant();
    return saved?.slug || 'trattoria-del-puerto';
  });

  const [activeTab, setActiveTab] = useState<'floorplan' | 'tables' | 'menu' | 'staff' | 'modules' | 'metrics'>('floorplan');
  const [tables, setTables] = useState<TableItem[]>([]);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean>(() => !!AdminApi.getAuthToken());

  // New Restaurant Onboarding Modal State (oculto salvo flag explícito)
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [regName, setRegName] = useState('');
  const [regSlug, setRegSlug] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regTablesCount, setRegTablesCount] = useState(6);
  const [regTemplate, setRegTemplate] = useState('GOURMET_OBSIDIAN');
  const [regError, setRegError] = useState<string | null>(null);
  const [regSubmitting, setRegSubmitting] = useState(false);

  const activeRestaurant = restaurants.find(r => r.slug === selectedSlug || r.id === selectedSlug) || {
    id: selectedSlug,
    slug: selectedSlug,
    name: selectedSlug === 'trattoria-del-puerto' ? 'Trattoria del Puerto' : selectedSlug,
    templateId: 'GOURMET_OBSIDIAN',
    themeColor: '#f59e0b',
    createdAt: ''
  };

  const loadRestaurants = useCallback(async () => {
    try {
      const list = await AdminApi.getRestaurants();
      setRestaurants(list);
      if (list.length > 0 && !list.some(r => r.slug === selectedSlug || r.id === selectedSlug)) {
        setSelectedSlug(list[0].slug);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'No se pudo cargar la lista de restaurantes.');
    }
  }, [selectedSlug]);

  const loadData = useCallback(async () => {
    // Bloqueo hasta login real: sin token no se cargan datos privados.
    if (!AdminApi.getAuthToken()) {
      setAuthed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      await loadRestaurants();
      try {
        const tablesData = await AdminApi.getTables(selectedSlug);
        setTables(tablesData);
      } catch (err: any) {
        // Sin ocultar errores como listas vacías: mensaje visible.
        setTables([]);
        throw err;
      }
      try {
        const shiftData = await AdminApi.getCurrentShift(selectedSlug);
        setCurrentShift(shiftData);
      } catch (err: any) {
        setCurrentShift(null);
        throw err;
      }
    } catch (err: any) {
      // Expiración 401/403: requireAuthorized ya limpió el token; reautenticar.
      if (!AdminApi.getAuthToken()) {
        setAuthed(false);
        setLoadError('Sesión expirada o sin autorización. Volvé a iniciar sesión.');
      } else {
        setLoadError(err?.message || 'No se pudieron cargar los datos. Reintentá.');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedSlug, loadRestaurants]);

  // Lista pública de restaurantes siempre; datos privados sólo con sesión.
  useEffect(() => {
    loadRestaurants();
  }, [loadRestaurants]);

  useEffect(() => {
    loadData();
  }, [loadData, authed]);

  const handleTenantChange = (val: string) => {
    // Reautenticación al cambiar de tenant: el token es por restaurante.
    if (val !== selectedSlug) {
      AdminApi.logout();
      setAuthed(false);
      setTables([]);
      setCurrentShift(null);
      setSelectedSlug(val);
    }
  };

  const handleLogout = () => {
    AdminApi.logout();
    setAuthed(false);
    setTables([]);
    setCurrentShift(null);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regSlug.trim()) return;
    if (!ADMIN_PIN_PATTERN.test(regPin)) {
      setRegError('El PIN debe tener entre 4 y 6 dígitos numéricos, sin espacios.');
      return;
    }

    setRegSubmitting(true);
    setRegError(null);
    try {
      const res = await AdminApi.registerRestaurant({
        name: regName.trim(),
        slug: regSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        pin: regPin,
        tablesCount: Number(regTablesCount) || 6,
        templateId: regTemplate
      });

      setShowRegisterModal(false);
      setRegName('');
      setRegSlug('');
      setRegPin('');
      setAuthed(true);
      await loadRestaurants();
      setSelectedSlug(res.restaurant.slug);
    } catch (err: any) {
      setRegError(err.message || 'Error al registrar restaurante');
    } finally {
      setRegSubmitting(false);
    }
  };

  if (!authed) {
    return (
      <div className="min-h-full mx-auto p-4 sm:p-6 max-w-5xl">
        <AdminLoginModal
          slug={selectedSlug}
          onSlugChange={handleTenantChange}
          restaurants={restaurants}
          onSuccess={() => { setAuthed(true); }}
        />
        {loadError && <p role="alert" className="mt-4 rounded-xl border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">{loadError}</p>}
      </div>
    );
  }

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
                  handleTenantChange(val);
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

          {PUBLIC_ONBOARDING_ENABLED && (
            <button
              onClick={() => setShowRegisterModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 active:scale-95 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo Local</span>
            </button>
          )}

          <button
            onClick={loadData}
            title="Refrescar Datos"
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold active:scale-95 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>

          <button
            onClick={handleLogout}
            title="Cerrar sesión de administrador"
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-rose-700 text-rose-300 text-xs font-semibold active:scale-95 transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Salir</span>
          </button>
        </div>
      </header>

      {loadError && (
        <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
          {loadError}
        </p>
      )}

      {/* Shift Controller Card */}
      <ShiftManager
        currentShift={currentShift}
        restaurantId={selectedSlug}
        onRefresh={loadData}
      />

      {/* Tabs Navigation */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('floorplan')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'floorplan'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Map className="w-4 h-4" />
          <span>Plano en Vivo (Tablet RTMS)</span>
        </button>

        <button
          onClick={() => setActiveTab('tables')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'tables'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>Mesas & Códigos QR ({tables.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('menu')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'menu'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <BookOpen className="w-4 h-4 text-amber-400" />
          <span>Carta & Precios</span>
        </button>

        <button
          onClick={() => setActiveTab('modules')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'modules'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Sliders className="w-4 h-4 text-emerald-400" />
          <span>Módulos & Configuración</span>
        </button>

        <button
          onClick={() => setActiveTab('staff')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'staff'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Personal & Mozos</span>
        </button>

        <button
          onClick={() => setActiveTab('metrics')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'metrics'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Métricas & Rendimiento</span>
        </button>
      </div>

      {/* Active Tab Content */}
      <main className="pb-12">
        {activeTab === 'floorplan' && (
          <FloorPlanManager restaurantSlug={selectedSlug} />
        )}
        {activeTab === 'tables' && (
          <TablesManager
            tables={tables}
            restaurantId={activeRestaurant.id}
            restaurantSlug={activeRestaurant.slug}
            onRefresh={loadData}
          />
        )}
        {activeTab === 'menu' && (
          <MenuManager
            restaurantId={selectedSlug}
          />
        )}
        {activeTab === 'modules' && (
          <ModuleConfigManager
            restaurantId={selectedSlug}
          />
        )}
        {activeTab === 'staff' && (
          <StaffManager
            restaurantId={selectedSlug}
          />
        )}
        {activeTab === 'metrics' && (
          <div className="space-y-8">
            <RTMSAnalyticsView restaurantSlug={selectedSlug} />
            <div className="pt-6 border-t border-slate-800">
              <h3 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-wider">
                Métricas Clásicas de Servicio & Mozo
              </h3>
              <MetricsView restaurantId={selectedSlug} />
            </div>
          </div>
        )}
      </main>

      {/* SaaS Register New Restaurant Modal (sólo con flag explícito) */}
      {PUBLIC_ONBOARDING_ENABLED && showRegisterModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleRegisterSubmit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-white">Registrar Nuevo Restaurante</h3>
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
                <label className="block text-slate-400 mb-1">Nombre del Restaurante / Bar</label>
                <input
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
                <label className="block text-slate-400 mb-1">Slug URL del Local (Único)</label>
                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-400">
                  <span className="text-[11px] font-mono select-none">mesaya.app/?r=</span>
                  <input
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
                  <label className="block text-slate-400 mb-1">PIN Inicial Admin (4–6 dígitos)</label>
                  <input
                    type="password"
                    maxLength={6}
                    value={regPin}
                    onChange={(e) => setRegPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Cantidad de Mesas</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={regTablesCount}
                    onChange={(e) => setRegTablesCount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Plantilla Visual / Estilo</label>
                <select
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
