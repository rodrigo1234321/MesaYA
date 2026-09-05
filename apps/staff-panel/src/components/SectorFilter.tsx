import React from 'react';
import { Sector, SECTOR_LABELS } from '@mesaya/shared';

interface SectorFilterProps {
  selectedSector: Sector | 'ALL';
  onSelectSector: (sector: Sector | 'ALL') => void;
  countsBySector: Record<string, number>;
}

export const SectorFilter: React.FC<SectorFilterProps> = ({
  selectedSector,
  onSelectSector,
  countsBySector
}) => {
  const sectors: Array<{ key: Sector | 'ALL'; label: string }> = [
    { key: 'ALL', label: 'Todos' },
    { key: Sector.SALON_PRINCIPAL, label: SECTOR_LABELS[Sector.SALON_PRINCIPAL] },
    { key: Sector.TERRAZA, label: SECTOR_LABELS[Sector.TERRAZA] },
    { key: Sector.VEREDA, label: SECTOR_LABELS[Sector.VEREDA] },
    { key: Sector.PLANTA_ALTA, label: SECTOR_LABELS[Sector.PLANTA_ALTA] },
    { key: Sector.BARRA, label: SECTOR_LABELS[Sector.BARRA] }
  ];

  return (
    <div className="flex items-center space-x-1.5 overflow-x-auto pb-2 scrollbar-none">
      {sectors.map(s => {
        const isSelected = selectedSector === s.key;
        const count = s.key === 'ALL'
          ? Object.values(countsBySector).reduce((a, b) => a + b, 0)
          : countsBySector[s.key] || 0;

        return (
          <button
            key={s.key}
            onClick={() => onSelectSector(s.key)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              isSelected
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <span>{s.label}</span>
            {count > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                isSelected ? 'bg-indigo-950 text-indigo-200' : 'bg-slate-800 text-amber-300'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
