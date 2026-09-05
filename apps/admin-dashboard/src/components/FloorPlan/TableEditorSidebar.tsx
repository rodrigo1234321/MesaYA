import React, { useState } from 'react';
import { useFloorPlanStore } from '../../stores/useFloorPlanStore';
import { TableShape } from '@mesaya/shared';
import {
  X,
  Trash2,
  Users,
  Square,
  Circle,
  Columns,
  Building2,
  Copy,
  Link2,
  Unlink2,
  Sun,
  Wine,
  TreePine,
  ArrowUpRight
} from 'lucide-react';

export const TableEditorSidebar: React.FC<{ restaurantSlug?: string }> = ({ restaurantSlug }) => {
  const {
    selectedTableId,
    selectTableCell,
    tables,
    zones,
    updateTableGeometryLocal,
    duplicateTableLocal,
    mergeTablesLocal,
    unmergeTableLocal,
    mergeTablesDirect,
    unmergeTableDirect,
    deleteTableDirect,
    removeTableLocal
  } = useFloorPlanStore();

  const [tableToMergeId, setTableToMergeId] = useState<string>('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedTable = tables.find((t) => t.id === selectedTableId);
  if (!selectedTable) return null;

  const shapes: { id: TableShape; label: string; icon: any }[] = [
    { id: 'RECT', label: 'Rectangular', icon: Columns },
    { id: 'SQUARE', label: 'Cuadrada', icon: Square },
    { id: 'ROUND', label: 'Redonda', icon: Circle },
    { id: 'BOOTH', label: 'Booth / Box', icon: Square }
  ];

  const sectors = [
    { id: 'SALON_PRINCIPAL', label: 'Salón Principal', emoji: '🏛️', icon: Building2 },
    { id: 'PLANTA_ALTA', label: 'Segundo Piso', emoji: '🪜', icon: ArrowUpRight },
    { id: 'TERRAZA', label: 'Terraza', emoji: '☀️', icon: Sun },
    { id: 'BARRA', label: 'Barra', emoji: '🍸', icon: Wine },
    { id: 'VEREDA', label: 'Vereda / Patio', emoji: '🌳', icon: TreePine }
  ];

  // Candidates for merging (other tables)
  const mergeCandidates = tables.filter(
    (t) => t.id !== selectedTable.id && !t.mergedWithTableId
  );

  const handleMerge = async () => {
    if (!tableToMergeId) return;
    setLoading(true);
    try {
      if (restaurantSlug) {
        await mergeTablesDirect(restaurantSlug, selectedTable.id, tableToMergeId);
      } else {
        mergeTablesLocal(selectedTable.id, tableToMergeId);
      }
      setTableToMergeId('');
    } catch (e) {
      alert('Error al unir mesas');
    } finally {
      setLoading(false);
    }
  };

  const handleUnmerge = async () => {
    setLoading(true);
    try {
      if (restaurantSlug) {
        await unmergeTableDirect(restaurantSlug, selectedTable.id);
      } else {
        unmergeTableLocal(selectedTable.id);
      }
    } catch (e) {
      alert('Error al separar mesas');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      if (restaurantSlug) {
        await deleteTableDirect(restaurantSlug, selectedTable.id);
      } else {
        removeTableLocal(selectedTable.id);
      }
      selectTableCell(null);
    } catch (e) {
      alert('Error al eliminar mesa');
    } finally {
      setLoading(false);
      setIsConfirmingDelete(false);
    }
  };

  const isMerged = !!selectedTable.mergedWithTableId;

  return (
    <div className="w-84 bg-slate-900 border-l border-slate-800 p-5 flex flex-col h-full shadow-2xl z-20 overflow-y-auto animate-slideLeft">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h3 className="text-base font-black text-white flex items-center gap-2">
            <span>Editar Mesa</span>
            {isMerged && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                🔗 Unida
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-400">Sector, geometría y combinaciones</p>
        </div>
        <button
          onClick={() => selectTableCell(null)}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4 py-4 flex-1">
        {/* Label / Name */}
        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1">
            Nombre / Identificador de Mesa
          </label>
          <input
            type="text"
            value={selectedTable.label}
            onChange={(e) => updateTableGeometryLocal(selectedTable.id, { label: e.target.value })}
            placeholder="ej. Mesa 1, Box VIP..."
            className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-white focus:outline-none focus:border-sky-500"
          />
        </div>

        {/* Sector / Floor Picker */}
        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1.5">
            Piso / Sector del Local
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {sectors.map((sec) => {
              const isCurrent = (selectedTable.sector || 'SALON_PRINCIPAL') === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() =>
                    updateTableGeometryLocal(selectedTable.id, {
                      sector: sec.id,
                      isOutdoor: sec.id === 'TERRAZA' || sec.id === 'VEREDA'
                    })
                  }
                  className={`p-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all text-left ${
                    isCurrent
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                      : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-750'
                  }`}
                >
                  <span className="text-sm">{sec.emoji}</span>
                  <span className="truncate">{sec.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Juntar / Unir Mesas Section */}
        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-amber-500/30 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" />
              <span>Juntar / Combinar Mesas</span>
            </span>
          </div>

          {isMerged ? (
            <div className="space-y-2">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 leading-relaxed">
                <p>
                  🔗 <strong>Mesa combinada con:</strong> {selectedTable.mergedWithLabel || 'Mesa compañera'}
                </p>
                <p className="text-[11px] text-amber-300/80 mt-1">
                  Capacidad total unificada: <strong>{selectedTable.capacity} personas</strong>
                </p>
              </div>

              <button
                onClick={handleUnmerge}
                disabled={loading}
                className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-200 hover:text-rose-300 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                <Unlink2 className="w-3.5 h-3.5 text-rose-400" />
                <span>Separar / Desunir Mesas</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400 leading-snug">
                Une esta mesa con otra contigua para eventos o grupos grandes, sumando comensales automáticamente.
              </p>
              <div className="flex gap-2">
                <select
                  value={tableToMergeId}
                  onChange={(e) => setTableToMergeId(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">Elegir mesa vecina...</option>
                  {mergeCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.capacity} pers. - {c.sector})
                    </option>
                  ))}
                </select>

                <button
                  onClick={handleMerge}
                  disabled={!tableToMergeId || loading}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${
                    tableToMergeId
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md active:scale-95'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  }`}
                >
                  <span>Unir</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Geometric Shape */}
        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1.5">Forma Geométrica</label>
          <div className="grid grid-cols-2 gap-2">
            {shapes.map((s) => {
              const Icon = s.icon;
              const isCurrent = (selectedTable.shape || 'RECT') === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => updateTableGeometryLocal(selectedTable.id, { shape: s.id })}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all ${
                    isCurrent
                      ? 'bg-sky-950/60 border-sky-500 text-sky-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Capacity */}
        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1">
            Capacidad (Comensales)
          </label>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400" />
            <input
              type="number"
              min={1}
              max={30}
              value={selectedTable.capacity || 4}
              onChange={(e) =>
                updateTableGeometryLocal(selectedTable.id, { capacity: Number(e.target.value) || 2 })
              }
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-white focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Dimensions (Width & Height) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1">Ancho (px)</label>
            <input
              type="number"
              step={10}
              min={40}
              max={300}
              value={selectedTable.width || 80}
              onChange={(e) =>
                updateTableGeometryLocal(selectedTable.id, { width: Number(e.target.value) || 80 })
              }
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1">Alto (px)</label>
            <input
              type="number"
              step={10}
              min={40}
              max={300}
              value={selectedTable.height || 80}
              onChange={(e) =>
                updateTableGeometryLocal(selectedTable.id, { height: Number(e.target.value) || 80 })
              }
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Zone Assignment */}
        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1">Zona Específica</label>
          <select
            value={selectedTable.floorZoneId || ''}
            onChange={(e) =>
              updateTableGeometryLocal(selectedTable.id, {
                floorZoneId: e.target.value || null
              })
            }
            className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
          >
            <option value="">Sin zona asignada</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>

        {/* Position readout */}
        <div className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-800 text-xs text-slate-400 flex items-center justify-between font-mono">
          <span>X: {selectedTable.posX}px</span>
          <span>Y: {selectedTable.posY}px</span>
          <span>Rot: {selectedTable.rotation}°</span>
        </div>
      </div>

      {/* Footer Actions: Clone and Delete */}
      <div className="pt-4 border-t border-slate-800 space-y-2">
        <button
          onClick={() => duplicateTableLocal(selectedTable.id)}
          className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-98"
        >
          <Copy className="w-4 h-4 text-sky-400" />
          <span>Duplicar Mesa</span>
        </button>

        {isConfirmingDelete ? (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 space-y-2">
            <p className="text-xs font-bold text-rose-300">
              ¿Eliminar permanentemente {selectedTable.label}?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={loading}
                className="flex-1 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black"
              >
                Sí, eliminar
              </button>
              <button
                onClick={() => setIsConfirmingDelete(false)}
                className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsConfirmingDelete(true)}
            className="w-full py-2.5 px-4 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Eliminar del Plano</span>
          </button>
        )}
      </div>
    </div>
  );
};
