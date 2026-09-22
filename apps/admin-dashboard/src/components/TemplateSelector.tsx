import React, { useState, useEffect } from 'react';
import { MenuTemplateId, MENU_TEMPLATES } from '@mesaya/shared';
import { AdminApi } from '../lib/api';
import { Check, Paintbrush, Flame, Waves, Coffee, Utensils } from 'lucide-react';

interface TemplateSelectorProps {
  restaurantSlug: string;
  currentTemplateId: MenuTemplateId;
  onTemplateChanged: (newTemplateId: MenuTemplateId) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  restaurantSlug,
  currentTemplateId,
  onTemplateChanged
}) => {
  const [selected, setSelected] = useState<MenuTemplateId>(currentTemplateId || MenuTemplateId.GOURMET_OBSIDIAN);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (currentTemplateId) {
      setSelected(currentTemplateId);
    }
  }, [currentTemplateId]);

  const getIconForTemplate = (id: MenuTemplateId) => {
    switch (id) {
      case MenuTemplateId.GOURMET_OBSIDIAN:
        return <Utensils className="w-5 h-5 text-amber-400" />;
      case MenuTemplateId.NEON_BURGER:
        return <Flame className="w-5 h-5 text-lime-400" />;
      case MenuTemplateId.COASTAL_BEACH:
        return <Waves className="w-5 h-5 text-cyan-400" />;
      case MenuTemplateId.MINIMAL_BISTRO:
        return <Coffee className="w-5 h-5 text-slate-300" />;
    }
  };

  const handleApply = async (templateId: MenuTemplateId) => {
    setSaving(true);
    setSuccessMsg(null);
    try {
      const config = MENU_TEMPLATES[templateId];
      await AdminApi.updateTemplate(restaurantSlug, {
        templateId,
        themeColor: config.primaryColor
      });
      setSelected(templateId);
      onTemplateChanged(templateId);
      setSuccessMsg(`¡Template "${config.name}" activado correctamente!`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Error al cambiar template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-base font-extrabold text-white flex items-center gap-2">
            <Paintbrush className="w-5 h-5 text-amber-400" />
            <span>Templates Visuales Gastronómicos (Mobile-First)</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Elige la identidad visual para la carta web en los celulares de tus comensales
          </p>
        </div>

        {successMsg && (
          <div className="px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5 animate-in fade-in">
            <Check className="w-4 h-4" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Object.values(MENU_TEMPLATES) as any[]).map((tmpl) => {
          const isActive = selected === tmpl.id;
          return (
            <div
              key={tmpl.id}
              onClick={() => handleApply(tmpl.id)}
              className={`relative overflow-hidden rounded-2xl p-5 border-2 transition-all cursor-pointer flex flex-col justify-between space-y-4 group ${
                isActive
                  ? 'border-amber-500 bg-slate-850 shadow-xl shadow-amber-950/20 ring-2 ring-amber-500/20'
                  : 'border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-850/80'
              }`}
            >
              {/* Active Badge */}
              {isActive && (
                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-amber-500 text-slate-950 font-extrabold text-[11px] flex items-center gap-1 shadow-lg">
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                  <span>En Uso</span>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <div className={`p-2.5 rounded-xl bg-gradient-to-br ${tmpl.previewGradient} border border-slate-700/60`}>
                    {getIconForTemplate(tmpl.id)}
                  </div>
                  <div>
                    <h4 className="text-sm font-extrabold text-white group-hover:text-amber-300 transition-colors">
                      {tmpl.name}
                    </h4>
                    <p className="text-[11px] text-slate-400">{tmpl.tagline}</p>
                  </div>
                </div>

                <div className="pt-2">
                  <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                    Gastronomía Ideal
                  </span>
                  <p className="text-xs text-slate-300 font-medium mt-0.5">
                    {tmpl.recommendedFor}
                  </p>
                </div>
              </div>

              {/* Color Swatches & Action Bar */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-medium">Paleta:</span>
                  <span
                    className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                    style={{ backgroundColor: tmpl.primaryColor }}
                    title={tmpl.primaryColor}
                  />
                  <span className="w-4 h-4 rounded-full bg-slate-950 border border-slate-700" title="Canvas Obsidian" />
                </div>

                <button
                  disabled={saving}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30 cursor-default'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 group-hover:border-amber-500/50'
                  }`}
                >
                  {isActive ? 'Activo' : 'Activar Template'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
