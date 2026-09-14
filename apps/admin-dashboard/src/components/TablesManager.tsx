import React, { useState, useEffect } from 'react';
import { TableItem, AdminApi } from '../lib/api';
import { Sector, SECTOR_LABELS, buildCanonicalClientTableUrl } from '@mesaya/shared';
import { Plus, QrCode, Copy, Check, ExternalLink, Download } from 'lucide-react';
import QRCode from 'qrcode';

interface TablesManagerProps {
  tables: TableItem[];
  restaurantId: string;
  restaurantSlug?: string;
  onRefresh: () => void;
}

export const TablesManager: React.FC<TablesManagerProps> = ({ tables, restaurantId, restaurantSlug, onRefresh }) => {
  const [selectedSector, setSelectedSector] = useState<Sector | 'ALL'>('ALL');
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

  const getTablePermanentUrl = (label: string) => {
    const slug = restaurantSlug || restaurantId;
    const clientBaseUrl = (import.meta as any).env?.VITE_CLIENT_WEB_URL ||
      (import.meta as any).env?.VITE_CLIENT_URL;
    let base: string;
    if (clientBaseUrl) {
      base = clientBaseUrl.replace(/\/$/, '');
    } else {
      const host = typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';
      const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
      const isDev = host === 'localhost' || host === '127.0.0.1';
      const port = isDev ? ':5173' : (window.location.port ? `:${window.location.port}` : '');
      base = `${protocol}//${host}${port}`;
    }
    return buildCanonicalClientTableUrl(base, slug, label);
  };

  const [activeQrTable, setActiveQrTable] = useState<{ label: string; url: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!activeQrTable) {
      setQrDataUrl(null);
      return;
    }
    let isMounted = true;
    QRCode.toDataURL(activeQrTable.url, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    }).then(url => {
      if (isMounted) setQrDataUrl(url);
    }).catch(err => {
      console.error('Error generando QR localmente:', err);
    });
    return () => { isMounted = false; };
  }, [activeQrTable]);

  const copyUrl = (label: string, id: string) => {
    const url = getTablePermanentUrl(label);
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-4">
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
                  onClick={() => setActiveQrTable({ label: table.label, url: clientUrl })}
                  title="Ver Código QR"
                  className="flex items-center space-x-1 text-[11px] font-bold px-2.5 py-1 rounded-xl bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 active:scale-95 transition-all"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>QR</span>
                </button>
              </div>

              <div className="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800/80 flex items-center justify-between text-xs font-mono">
                <span className="truncate max-w-[170px] text-slate-400 text-[11px]" title={clientUrl}>
                  {clientUrl.replace(/^https?:\/\//, '')}
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => copyUrl(table.label, table.id)}
                    title="Copiar Link Permanente de Mesa"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-90 transition-transform"
                  >
                    {copiedId === table.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={clientUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Abrir como Comensal"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-400 active:scale-90 transition-transform"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
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

            <div className="p-3 bg-white rounded-2xl mx-auto inline-block shadow-inner min-w-[176px] min-h-[176px] flex items-center justify-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR ${activeQrTable.label}`}
                  className="w-44 h-44 mx-auto rounded-lg"
                />
              ) : (
                <div className="w-44 h-44 flex items-center justify-center text-slate-400 text-xs">
                  Generando QR local...
                </div>
              )}
            </div>

            <p className="text-[11px] font-mono text-slate-400 break-all px-2 bg-slate-950 py-1.5 rounded-xl border border-slate-800">
              {activeQrTable.url}
            </p>

            <div className="flex gap-2">
              {qrDataUrl && (
                <a
                  href={qrDataUrl}
                  download={`qr-${activeQrTable.label.toLowerCase().replace(/\s+/g, '-')}.png`}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar PNG
                </a>
              )}
              <button
                onClick={() => setActiveQrTable(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs active:scale-95 transition-all"
              >
                Cerrar
              </button>
            </div>
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
