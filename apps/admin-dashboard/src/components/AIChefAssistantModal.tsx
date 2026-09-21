import React, { useState, useEffect } from 'react';
import { ChefAIGenerateResponse, MenuTemplateId } from '@mesaya/shared';
import { AdminApi } from '../lib/api';
import { Sparkles, Bot, Check, ArrowRight, Loader2, Utensils, Flame, Waves, Coffee, X, AlertTriangle } from 'lucide-react';

interface AIChefAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantSlug: string;
  onMenuApplied: () => void;
}

export const AIChefAssistantModal: React.FC<AIChefAssistantModalProps> = ({
  isOpen,
  onClose,
  restaurantSlug,
  onMenuApplied
}) => {
  const [concept, setConcept] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<ChefAIGenerateResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const PRESETS = [
    {
      id: 'BURGER_BAR',
      label: '🍔 Smash Burgers & Birra',
      desc: 'Hamburguesería artesanal con smash burgers, papas cheddar y cervezas tiradas',
      template: MenuTemplateId.NEON_BURGER
    },
    {
      id: 'PARRILLA_STEAK',
      label: '🥩 Parrilla & Bodegón',
      desc: 'Carnes a la leña, empanadas caseras, provoleta a la chapa y vinos',
      template: MenuTemplateId.GOURMET_OBSIDIAN
    },
    {
      id: 'TRATTORIA_PASTA',
      label: '🍝 Trattoria & Pastas',
      desc: 'Pastas caseras de autor, salsas clásicas y postres tradicionales italianos',
      template: MenuTemplateId.GOURMET_OBSIDIAN
    },
    {
      id: 'COASTAL_SEAFOOD',
      label: '🐟 Marisquería & Playa MDP',
      desc: 'Pesca del día fresca, rabas crujientes, cazuelas y tragos de playa',
      template: MenuTemplateId.COASTAL_BEACH
    },
    {
      id: 'SPECIALTY_CAFE',
      label: '☕ Café de Especialidad & Brunch',
      desc: 'Granos de origen, cold brew, tostones de masa madre y pastelería',
      template: MenuTemplateId.MINIMAL_BISTRO
    }
  ];

  const handleSelectPreset = (preset: typeof PRESETS[0]) => {
    setSelectedPreset(preset.id);
    setConcept(preset.desc);
  };

  const handleGenerate = async () => {
    if (!concept.trim()) {
      setErrorMsg('Por favor escribe una descripción de tu local o elige una especialidad rápida');
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    setGeneratedResult(null);

    try {
      const res = await AdminApi.generateMenuWithAI(restaurantSlug, {
        concept,
        gastronomyType: selectedPreset || undefined,
        autoApply: false
      });
      setGeneratedResult(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al generar la carta con IA');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-chef-title"
        className="bg-slate-900 border border-amber-500/40 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl shadow-amber-950/30 animate-in fade-in zoom-in-95"
      >
        
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/20">
              <Sparkles className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h3 id="ai-chef-title" className="text-base font-extrabold text-white flex items-center gap-2">
                <span>Chef Copilot IA</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  Inteligencia Gastronómica
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Genera tu carta completa con descripciones apetecibles, fotos y template ideal
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar modal IA"
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs font-bold transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {errorMsg && (
            <div role="alert" className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Quick Gastronomy Presets */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              1. Selecciona un estilo gastronómico o escribe tu concepto
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PRESETS.map((p) => {
                const isSelected = selectedPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p)}
                    className={`p-3 rounded-2xl text-left border transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'border-amber-500 bg-amber-500/10 text-amber-200'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <span className="font-extrabold text-xs text-white">{p.label}</span>
                    <span className="text-[11px] text-slate-400 mt-1 line-clamp-1">{p.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Concept Input */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              2. Describe tu propuesta (ingredientes clave, especialidades, ciudad)
            </label>
            <textarea
              rows={3}
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Ej: Somos una pizzería napolitana en Mar del Plata, masa fermentada 48hs, horno a leña y cervezas artesanales..."
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/80 transition-all resize-none"
            />
          </div>

          {/* Generate Action Button */}
          <button
            type="button"
            disabled={loading || !concept.trim()}
            onClick={handleGenerate}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 shadow-xl shadow-amber-500/20 active:scale-98 transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Chef IA redactando categorías y platos gourmet...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>✨ Generar Carta Gastronómica con IA</span>
              </>
            )}
          </button>

          {/* Generated Result Preview */}
          {generatedResult && (
            <div className="space-y-4 pt-4 border-t border-slate-800 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-extrabold text-white flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>{generatedResult.degraded ? 'Vista previa degradada' : `Propuesta de Carta Lista (${generatedResult.categories.length} categorías)`}</span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Template sugerido: <strong className="text-amber-300">{generatedResult.suggestedTemplateId}</strong>
                  </p>
                </div>
              </div>

              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {generatedResult.categories.map((cat, cIdx) => (
                  <div key={cIdx} className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-amber-400 text-xs">
                      <span>{cat.icon}</span>
                      <span>{cat.name}</span>
                      <span className="text-[10px] text-slate-500">({cat.items.length} platos)</span>
                    </div>

                    <div className="space-y-1.5">
                      {cat.items.map((item, iIdx) => (
                        <div key={iIdx} className="flex items-center justify-between text-[11px] text-slate-300 py-1 border-b border-slate-900/80 last:border-0">
                          <div className="min-w-0 pr-2">
                            <span className="font-semibold text-white">{item.name}</span>
                            <span className="text-[10px] text-slate-400 block truncate">{item.description}</span>
                          </div>
                          <span className="font-mono font-bold text-amber-300 shrink-0">
                            ${Number(item.price).toLocaleString('es-AR')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Allergen & Safety Warning Banner */}
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <div className="space-y-0.5 text-[11px] leading-relaxed">
                  <span className="font-bold text-amber-300">Aviso de Seguridad y Alérgenos:</span>
                  <p className="text-slate-300">
                    Las propuestas generadas por IA son sugerencias creativas y <strong className="text-white">requieren revisión humana obligatoria</strong>. Verifica descripciones, precios, alérgenos y trazabilidad de ingredientes antes de publicar en la carta activa.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-700 text-slate-300 text-[11px] leading-relaxed">
                Esta pantalla es únicamente una vista previa. La propuesta no se importa ni publica desde aquí; revisá manualmente cada plato, precio y alérgeno y usá el flujo explícito de edición del menú para decidir qué guardar.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
