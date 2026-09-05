import React, { useState } from 'react';
import { TableItem, AdminApi } from '../lib/api';
import { Sector, SECTOR_LABELS } from '@mesaya/shared';
import { Plus, QrCode, Copy, Check, ExternalLink } from 'lucide-react';

interface TablesManagerProps {
  tables: TableItem[];
  restaurantId: string;
  restaurantSlug?: string;
  onRefresh: () => void;
}

export const TablesManager: React.FC<TablesManagerProps> = ({ tables, restaurantId, restaurantSlug, onRefresh }) => {  const [selectedSector, setSelectedSector] = useState<Sector | 'ALL'>('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newSector, setNewSector] = useState<Sector>(Sector.SALON_PRINCIPAL);
  const [isOutdoor, setIsOutdoor] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredTables = selectedSector === 'ALL'
    ? tables
    : tables.filter(t => t.sector === selectedSector);

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel) return;
    try {
      await AdminApi.createTable(restaurantId, newLabel, newSector, isOutdoor);
      setShowAddModal(false);
      setNewLabel('');
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const isProduction = (import.meta as any).env?.PROD === true;
  const rawClientBaseUrl = ((import.meta as any).env?.VITE_CLIENT_WEB_URL as string | undefined)?.trim();
  const isHttpsPublicUrl = (v: string | undefined): v is string => {
    if (!v) return false;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(u.hostname);
    } catch { return false; }
  };
  // En producción se exige URL pública HTTPS explícita; sin ella NO se
  // genera/copia/abre ningún QR (error accionable, sin QR incorrecto).
  const qrMisconfigured = isProduction && !isHttpsPublicUrl(rawClientBaseUrl);
  const qrConfigError = qrMisconfigured
    ? 'QR deshabilitado: configurá VITE_CLIENT_WEB_URL=https://<dominio-comensal> en el build de Admin y reconstruí. Sin URL pública HTTPS no se genera ningún QR.'
    : null;

  const getTablePermanentUrl = (label: string): string | null => {
    const slug = restaurantSlug || restaurantId;
    if (rawClientBaseUrl) {
      if (!isHttpsPublicUrl(rawClientBaseUrl) && isProduction) return null;
      const base = rawClientBaseUrl.replace(/\/$/, '');
      return `${base}/?r=${encodeURIComponent(slug)}&m=${encodeURIComponent(label)}`;
    }
    if (isProduction) return null;
    const host = typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
    const isDev = host === 'localhost' || host === '127.0.0.1';
    const port = isDev ? ':5173' : (typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '');
    return `${protocol}//${host}${port}/?r=${encodeURIComponent(slug)}&m=${encodeURIComponent(label)}`;
  };

  const [activeQrTable, setActiveQrTable] = useState<{ label: string; url: string } | null>(null);

  const copyUrl = (label: string, id: string) => {
    const url = getTablePermanentUrl(label);
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openQrModal = (label: string) => {
    const url = getTablePermanentUrl(label);
    if (!url) return;
    setActiveQrTable({ label, url });
  };

  return (
    <div className="space-y-4">
      {qrConfigError && (
        <p role="alert" className="rounded-xl border border-amber-700 bg-amber-950/60 px-3 py-2 text-xs font-semibold text-amber-200">
          {qrConfigError}
        </p>
      )}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 max-w-full">
          {(['ALL', Sector.SALON_PRINCIPAL, Sector.TERRAZA, Sector.VEREDA, Sector.BARRA] as const).map(sec => (
            <button
              key={sec}
              onClick={() => setSelectedSector(sec)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                selectedSector === sec
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {sec === 'ALL' ? 'Todas las Mesas' : SECTOR_LABELS[sec]}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Mesa</span>
        </button>
      </div>

      {/* Grid of Tables */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredTables.map(table => {
          const clientUrl = getTablePermanentUrl(table.label);
          const qrDisabled = !clientUrl;
          return (
            <div
              key={table.id}
              className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-3 hover:border-slate-700 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-white">
                    {table.label.replace(/[^0-9]/g, '') || 'M'}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-white">{table.label}</h4>
                    <span className="text-[11px] text-slate-400">
                      {SECTOR_LABELS[table.sector as Sector] || table.sector} {table.isOutdoor && '• Exterior'}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => openQrModal(table.label)}
                  disabled={qrDisabled}
                  title={qrDisabled ? (qrConfigError || 'QR no disponible') : 'Ver Código QR'}
                  className="flex items-center space-x-1 text-[11px] font-bold px-2.5 py-1 rounded-xl bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 active:scale-95 transition-all disabled:opacity-40"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>QR</span>
                </button>
              </div>

              <div className="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800/80 flex items-center justify-between text-xs font-mono">
                <span className="truncate max-w-[170px] text-slate-400 text-[11px]" title={clientUrl || qrConfigError || 'QR no disponible'}>
                  {clientUrl ? clientUrl.replace(/^https?:\/\//, '') : 'QR no disponible'}
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => copyUrl(table.label, table.id)}
                    disabled={qrDisabled}
                    title={qrDisabled ? (qrConfigError || 'QR no disponible') : 'Copiar Link Permanente de Mesa'}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-90 transition-transform"
                  >
                    {copiedId === table.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  {clientUrl ? (
                    <a
                      href={clientUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Abrir como Comensal"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-400 active:scale-90 transition-transform"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <span title={qrConfigError || 'QR no disponible'} className="p-1.5 rounded-lg bg-slate-800/50 text-slate-600">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* QR Code Modal */}
      {activeQrTable && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xs bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4 shadow-2xl">
            <div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                {restaurantId}
              </span>
              <h3 className="text-lg font-extrabold text-white mt-1">{activeQrTable.label}</h3>
              <p className="text-xs text-slate-400">Escaneá para ingresar a la carta interactiva</p>
            </div>

            <div className="p-3 bg-white rounded-2xl mx-auto inline-block shadow-inner">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(activeQrTable.url)}`}
                alt={`QR ${activeQrTable.label}`}
                className="w-44 h-44 mx-auto rounded-lg"
              />
            </div>

            <p className="text-[11px] font-mono text-slate-400 break-all px-2 bg-slate-950 py-1.5 rounded-xl border border-slate-800">
              {activeQrTable.url}
            </p>

            <button
              onClick={() => setActiveQrTable(null)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs active:scale-95 transition-all"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Add Table Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateTable} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white">Agregar Nueva Mesa</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Nombre / Identificador</label>
                <input
                  type="text"
                  placeholder="Ej: Mesa 11, Terraza 4, Barra 2"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Sector de Atención</label>
                <select
                  value={newSector}
                  onChange={e => setNewSector(e.target.value as Sector)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value={Sector.SALON_PRINCIPAL}>Salón Principal</option>
                  <option value={Sector.TERRAZA}>Terraza</option>
                  <option value={Sector.VEREDA}>Vereda</option>
                  <option value={Sector.PLANTA_ALTA}>Planta Alta</option>
                  <option value={Sector.BARRA}>Barra</option>
                </select>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="outdoorCheck"
                  checked={isOutdoor}
                  onChange={e => setIsOutdoor(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="outdoorCheck" className="text-slate-300">Ubicada al aire libre / exterior</label>
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="w-1/2 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="w-1/2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs"
              >
                Guardar Mesa
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
