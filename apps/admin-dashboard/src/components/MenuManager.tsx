import React, { useState, useEffect, useRef } from 'react';
import { AdminApi } from '../lib/api';
import { MenuCategoryDTO, MenuItemDTO, MENU_TAGS, BatchMenuImportItem, RestaurantMenuResponse } from '@mesaya/shared';
import { TemplateSelector } from './TemplateSelector';
import { AIChefAssistantModal } from './AIChefAssistantModal';
import {
  Download,
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Sparkles,
  AlertCircle,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Tag,
  Palette,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Flame,
  Star,
  Eye,
  Sliders
} from 'lucide-react';

interface MenuManagerProps {
  restaurantId: string;
}

export const MenuManager: React.FC<MenuManagerProps> = ({ restaurantId }) => {
  const [menuData, setMenuData] = useState<RestaurantMenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('ALL');

  // Modals & Panels
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState<string | null>(null); // categoryId
  const [showBrandingModal, setShowBrandingModal] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  // Import State
  const [importText, setImportText] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [parsedPreview, setParsedPreview] = useState<BatchMenuImportItem[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New Category State
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('🍽️');

  // New Item State
  const [newItemName, setNewItemName] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemPrice, setNewItemPrice] = useState<number | ''>('');
  const [newItemImageUrl, setNewItemImageUrl] = useState('');
  const [newItemTags, setNewItemTags] = useState<string[]>([]);
  const [newItemFeatured, setNewItemFeatured] = useState(false);

  // Branding State
  const [brandColor, setBrandColor] = useState('#f59e0b');
  const [brandCover, setBrandCover] = useState('');

  // Category Collapsed state
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const clientPreviewUrl = (import.meta.env.VITE_CLIENT_URL as string) ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? ':5173' : (window.location.port ? `:${window.location.port}` : '')}/?r=${encodeURIComponent(restaurantId)}&m=${encodeURIComponent('Mesa 1')}`
      : 'http://localhost:5173');

  const loadMenu = async () => {
    setLoading(true);
    try {
      const data = await AdminApi.getMenu(restaurantId);
      setMenuData(data);
      if (data.restaurant.themeColor) setBrandColor(data.restaurant.themeColor);
      if (data.restaurant.coverImageUrl) setBrandCover(data.restaurant.coverImageUrl);
    } catch (err) {
      setFeedback({ message: err instanceof Error ? err.message : 'Error al cargar la carta digital.', isError: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMenu();
  }, [restaurantId]);

  // --- DESCARGAR PLANTILLA EXCEL/CSV ---
  const handleDownloadTemplate = () => {
    const csvContent =
      'Categoria,Plato,Descripcion,Precio,Etiquetas,Foto_URL\n' +
      'Pastas Artesanales,Sorrentinos de Salmón,Con crema de puerros y crocante de nuez,14500,CHEF_PICK|POPULAR,https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=600&q=80\n' +
      'Pastas Artesanales,Fettuccine Frutti di Mare,Langostinos calamares y mejillones al vino blanco,16200,POPULAR,\n' +
      'Pastas Artesanales,Pizza Napolitana di Bufala,Masa madre pomodoro italiano y albahaca fresca,12800,VEGETARIAN,\n' +
      'Carnes & Parrilla,Ojo de Bife a la Leña (400g),Con papas rústicas al romero y manteca de chimichurri,18900,CHEF_PICK|GLUTEN_FREE,https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=600&q=80\n' +
      'Carnes & Parrilla,Pesca del Día al Horno de Barro,Con vegetales glaseados y emulsión de limón,17500,GLUTEN_FREE,\n' +
      'Bebidas & Tragos,Aperol Spritz Clásico,Prosecco Aperol golpe de soda y rodaja de naranja,4500,POPULAR,\n' +
      'Bebidas & Tragos,Gin Tonic de Frutos Rojos,Gin artesanal marplatense con bayas frescas,4800,CHEF_PICK,\n' +
      'Postres,Tiramisú Tradicional,Con café espresso y cacao amargo 70%,5200,POPULAR,\n' +
      'Postres,Volcán de Dulce de Leche,Con helado artesanal de crema americana,5800,CHEF_PICK|GLUTEN_FREE,';

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `plantilla_menu_${restaurantId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- PARSER CSV / EXCEL PEGAR / ARCHIVO ---
  const parseCSVContent = (content: string) => {
    try {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        setImportError('El archivo o texto no contiene filas de datos.');
        setParsedPreview([]);
        return;
      }

      // Detect separator: comma or semicolon or tab
      const firstLine = lines[0];
      let sep = ',';
      if (firstLine.includes(';') && !firstLine.includes(',')) sep = ';';
      if (firstLine.includes('\t')) sep = '\t';

      const items: BatchMenuImportItem[] = [];

      for (let i = 1; i < lines.length; i++) {
        const rawLine = lines[i].trim();
        if (!rawLine) continue;

        // Split respecting quotes if possible or direct split
        const cols = rawLine.split(sep).map((c) => c.replace(/^["']|["']$/g, '').trim());
        if (cols.length < 2) continue;

        const category = cols[0] || 'Varios';
        const name = cols[1];
        if (!name) continue;

        const description = cols[2] || '';
        const rawPrice = (cols[3] || '0').replace(/[^0-9.,]/g, '').replace(',', '.');
        const price = parseFloat(rawPrice) || 0;

        const rawTags = (cols[4] || '')
          .toUpperCase()
          .split(/[|,;]/)
          .map((t) => t.trim())
          .filter(Boolean);

        // Normalize tag names
        const normalizedTags = rawTags.map((t) => {
          if (t.includes('TACC') || t.includes('CELIAC') || t.includes('GLUTEN')) return 'GLUTEN_FREE';
          if (t.includes('VEGAN')) return 'VEGAN';
          if (t.includes('VEGETARIAN') || t.includes('VEGGIE')) return 'VEGETARIAN';
          if (t.includes('CHEF') || t.includes('RECOMEND') || t.includes('SUGER')) return 'CHEF_PICK';
          if (t.includes('SPICY') || t.includes('PICANTE')) return 'SPICY';
          if (t.includes('POPULAR') || t.includes('MAS_PEDIDO') || t.includes('DESTACADO')) return 'POPULAR';
          return t;
        });

        const imageUrl = cols[5] || '';
        const isFeatured = normalizedTags.includes('CHEF_PICK') || normalizedTags.includes('POPULAR');

        items.push({
          category,
          name,
          description,
          price,
          tags: normalizedTags,
          imageUrl: imageUrl || undefined,
          isFeatured
        });
      }

      setParsedPreview(items);
      setImportError(null);
    } catch (err: any) {
      setImportError(`Error al procesar formato: ${err.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setImportText(text);
      parseCSVContent(text);
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (parsedPreview.length === 0) return;
    setImportLoading(true);
    try {
      await AdminApi.importMenuBatch(restaurantId, {
        replaceExisting,
        items: parsedPreview
      });
      setShowImportModal(false);
      setParsedPreview([]);
      setImportText('');
      await loadMenu();
    } catch (err: any) {
      setImportError(err.message || 'Error al guardar');
    } finally {
      setImportLoading(false);
    }
  };

  // --- ACTIONS INLINE ---
  const handleToggleStock = async (item: MenuItemDTO) => {
    try {
      // Optimistic update
      setMenuData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          categories: prev.categories.map((cat) => ({
            ...cat,
            items: cat.items.map((it) => (it.id === item.id ? { ...it, isAvailable: !it.isAvailable } : it))
          }))
        };
      });

      await AdminApi.updateMenuItem(restaurantId, item.id, {
        isAvailable: !item.isAvailable
      });
      setFeedback({ message: `Disponibilidad de "${item.name}" actualizada.` });
    } catch (err) {
      setFeedback({ message: err instanceof Error ? err.message : 'Error al cambiar disponibilidad.', isError: true });
      loadMenu();
    }
  };

  const handleUpdatePrice = async (itemId: string, newPrice: number) => {
    if (isNaN(newPrice) || newPrice < 0) return;
    try {
      await AdminApi.updateMenuItem(restaurantId, itemId, { price: newPrice });
      setFeedback({ message: 'Precio actualizado con éxito.' });
    } catch (err) {
      setFeedback({ message: err instanceof Error ? err.message : 'Error al actualizar el precio.', isError: true });
      loadMenu();
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm('¿Eliminar este plato de la carta?')) return;
    try {
      await AdminApi.deleteMenuItem(restaurantId, itemId);
      setFeedback({ message: 'Plato eliminado de la carta.' });
      loadMenu();
    } catch (err) {
      setFeedback({ message: err instanceof Error ? err.message : 'Error al eliminar el plato.', isError: true });
    }
  };

  const handleDeleteCategory = async (catId: string, name: string) => {
    if (!window.confirm(`¿Eliminar la categoría "${name}" y todos sus platos?`)) return;
    try {
      await AdminApi.deleteCategory(restaurantId, catId);
      setFeedback({ message: `Categoría "${name}" eliminada.` });
      loadMenu();
    } catch (err) {
      setFeedback({ message: err instanceof Error ? err.message : 'Error al eliminar la categoría.', isError: true });
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setActionSubmitting(true);
    setModalError(null);
    try {
      await AdminApi.createCategory(restaurantId, newCatName.trim(), newCatIcon);
      setNewCatName('');
      setShowAddCategoryModal(false);
      setFeedback({ message: 'Categoría creada con éxito.' });
      loadMenu();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al crear la categoría.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddItemModal || !newItemName.trim() || newItemPrice === '') return;
    setActionSubmitting(true);
    setModalError(null);
    try {
      await AdminApi.createMenuItem(restaurantId, {
        categoryId: showAddItemModal,
        name: newItemName.trim(),
        description: newItemDesc.trim() || undefined,
        price: Number(newItemPrice),
        imageUrl: newItemImageUrl.trim() || undefined,
        tags: newItemTags,
        isFeatured: newItemFeatured,
        isAvailable: true
      });

      setNewItemName('');
      setNewItemDesc('');
      setNewItemPrice('');
      setNewItemImageUrl('');
      setNewItemTags([]);
      setNewItemFeatured(false);
      setShowAddItemModal(null);
      setFeedback({ message: `Plato "${newItemName.trim()}" agregado al menú.` });
      loadMenu();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al crear el plato.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionSubmitting(true);
    setModalError(null);
    try {
      await AdminApi.updateBranding(restaurantId, {
        themeColor: brandColor,
        coverImageUrl: brandCover.trim() || undefined
      });
      setShowBrandingModal(false);
      setFeedback({ message: 'Identidad y estilo de carta guardados.' });
      loadMenu();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al guardar la identidad visual.');
    } finally {
      setActionSubmitting(false);
    }
  };

  // Stats calculation
  const totalCategories = menuData?.categories.length || 0;
  const allItems = menuData?.categories.flatMap((c) => c.items) || [];
  const totalItems = allItems.length;
  const activeItemsCount = allItems.filter((i) => i.isAvailable).length;
  const pausedItemsCount = totalItems - activeItemsCount;

  // Filtered categories and items
  const filteredCategories = (menuData?.categories || []).map((cat) => {
    const items = cat.items.filter((item) => {
      const matchesSearch =
        searchQuery === '' ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesTag =
        selectedTagFilter === 'ALL' ||
        (selectedTagFilter === 'AVAILABLE' && item.isAvailable) ||
        (selectedTagFilter === 'PAUSED' && !item.isAvailable) ||
        item.tags.includes(selectedTagFilter);

      return matchesSearch && matchesTag;
    });

    return { ...cat, items };
  });

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          role="alert"
          className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center justify-between transition-all ${
            feedback.isError
              ? 'bg-rose-500/20 border-rose-500/30 text-rose-200'
              : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded"
            aria-label="Cerrar notificación"
          >
            ✕
          </button>
        </div>
      )}

      {/* TOP HEADER & ACTION BAR */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-5 rounded-3xl shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📖</span>
            <h2 className="text-xl font-extrabold text-white tracking-tight">
              Carta Digital & Precios en Vivo
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Gestiona categorías, disponibilidad en tiempo real y carga masiva desde Excel/CSV para{' '}
            <span className="text-amber-400 font-semibold">{menuData?.restaurant?.name || restaurantId}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={clientPreviewUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all active:scale-95"
            aria-label="Abrir vista previa de la carta para el cliente"
          >
            <Eye className="w-3.5 h-3.5 text-indigo-300" />
            <span>Vista cliente</span>
          </a>
          {/* AI Chef Copilot Button */}
          <button
            onClick={() => setShowAiModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-extrabold shadow-lg shadow-amber-500/25 transition-all active:scale-95 animate-glow"
          >
            <Sparkles className="w-4 h-4 stroke-[2.5]" />
            <span>✨ Asistente IA Chef</span>
          </button>

          {/* Template Selector Button */}
          <button
            onClick={() => setShowTemplateSelector(!showTemplateSelector)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
              showTemplateSelector
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            <Palette className="w-3.5 h-3.5 text-amber-400" />
            <span>🎨 Templates ({menuData?.restaurant?.templateId || 'GOURMET'})</span>
          </button>

          {/* Download Template */}
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-all active:scale-95 shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Excel</span>
          </button>

          {/* Import Excel / CSV Button */}
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 transition-all active:scale-95"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Cargar CSV</span>
          </button>

          {/* Add Category Button */}
          <button
            onClick={() => setShowAddCategoryModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-950/40 transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Categoría</span>
          </button>
        </div>
      </div>

      {/* CONDITIONAL: TEMPLATE SELECTOR ACCORDION */}
      {showTemplateSelector && (
        <div className="animate-in fade-in slide-in-from-top-2">
          <TemplateSelector
            restaurantSlug={restaurantId}
            currentTemplateId={menuData?.restaurant?.templateId as any}
            onTemplateChanged={() => {
              loadMenu();
            }}
          />
        </div>
      )}

      {/* METRIC BADGES */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 block">Categorías</span>
            <span className="text-xl font-extrabold text-white">{totalCategories}</span>
          </div>
          <span className="text-2xl">📂</span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 block">Total Platos</span>
            <span className="text-xl font-extrabold text-white">{totalItems}</span>
          </div>
          <span className="text-2xl">🍽️</span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-emerald-400 block">En Carta (Activos)</span>
            <span className="text-xl font-extrabold text-emerald-300">{activeItemsCount}</span>
          </div>
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-amber-400 block">Pausados (Sin Stock)</span>
            <span className="text-xl font-extrabold text-amber-300">{pausedItemsCount}</span>
          </div>
          <XCircle className="w-6 h-6 text-amber-400" />
        </div>
      </div>

      {/* SEARCH & FILTERS BAR */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/40 p-3 rounded-2xl border border-slate-800/80">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar plato o ingrediente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 text-xs no-scrollbar">
          <button
            onClick={() => setSelectedTagFilter('ALL')}
            className={`px-3 py-1.5 rounded-xl font-semibold text-[11px] transition-all whitespace-nowrap ${
              selectedTagFilter === 'ALL'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            Todos ({totalItems})
          </button>
          <button
            onClick={() => setSelectedTagFilter('AVAILABLE')}
            className={`px-3 py-1.5 rounded-xl font-semibold text-[11px] transition-all whitespace-nowrap ${
              selectedTagFilter === 'AVAILABLE'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            🟢 Activos
          </button>
          <button
            onClick={() => setSelectedTagFilter('PAUSED')}
            className={`px-3 py-1.5 rounded-xl font-semibold text-[11px] transition-all whitespace-nowrap ${
              selectedTagFilter === 'PAUSED'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            🔴 Pausados
          </button>
          {Object.entries(MENU_TAGS).map(([tagKey, tagData]) => (
            <button
              key={tagKey}
              onClick={() => setSelectedTagFilter(tagKey)}
              className={`px-3 py-1.5 rounded-xl font-semibold text-[11px] transition-all whitespace-nowrap ${
                selectedTagFilter === tagKey
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800/80 text-slate-400 hover:text-white'
              }`}
            >
              <span>{tagData.emoji}</span> {tagData.label}
            </button>
          ))}
        </div>
      </div>

      {/* CATEGORIES ACCORDION & ITEMS LIST */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 flex flex-col items-center gap-2">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
          <p className="text-xs">Cargando carta gastronómica...</p>
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="py-16 text-center bg-slate-900/30 rounded-3xl border border-dashed border-slate-800 p-8 space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-800 mx-auto flex items-center justify-center text-slate-400">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">No hay platos que coincidan</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Puedes cargar tu carta subiendo un archivo Excel/CSV o agregando categorías y platos de forma manual.
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <button
              onClick={() => setShowImportModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
            >
              Cargar Archivo Excel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCategories.map((cat) => {
            const isCollapsed = collapsedCats[cat.id] || false;
            return (
              <div
                key={cat.id}
                className="rounded-3xl bg-slate-900/70 border border-slate-800/90 overflow-hidden shadow-lg"
              >
                {/* Category Header */}
                <div className="p-4 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between">
                  <div
                    className="flex items-center gap-3 cursor-pointer select-none"
                    onClick={() => setCollapsedCats((prev) => ({ ...prev, [cat.id]: !isCollapsed }))}
                  >
                    <span className="text-2xl">{cat.icon || '🍽️'}</span>
                    <div>
                      <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                        {cat.name}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                          {cat.items.length} platos
                        </span>
                      </h3>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowAddItemModal(cat.id)}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Agregar Plato</span>
                    </button>

                    <button
                      onClick={() => handleDeleteCategory(cat.id, cat.name)}
                      className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white transition-all"
                      title="Eliminar categoría"
                      aria-label={`Eliminar categoría ${cat.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => setCollapsedCats((prev) => ({ ...prev, [cat.id]: !isCollapsed }))}
                      className="p-1.5 text-slate-400 hover:text-white"
                      aria-expanded={!isCollapsed}
                      aria-label={`${isCollapsed ? 'Desplegar' : 'Plegar'} categoría ${cat.name}`}
                    >
                      {isCollapsed ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Items Grid */}
                {!isCollapsed && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950/40">
                    {cat.items.length === 0 ? (
                      <div className="col-span-full py-6 text-center text-slate-500 text-xs italic">
                        No hay platos en esta categoría. Haz clic en "Agregar Plato" o carga un Excel.
                      </div>
                    ) : (
                      cat.items.map((item) => (
                        <div
                          key={item.id}
                          className={`p-3.5 rounded-2xl border transition-all flex gap-3.5 relative ${
                            item.isAvailable
                              ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                              : 'bg-slate-950/80 border-rose-950/40 opacity-70'
                          }`}
                        >
                          {/* Dish Image Thumbnail */}
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="w-20 h-20 rounded-xl object-cover border border-slate-800 shrink-0"
                            />
                          ) : (
                            <div className="w-20 h-20 rounded-xl bg-slate-800/80 border border-slate-700/50 flex items-center justify-center text-2xl shrink-0">
                              {cat.icon || '🍽️'}
                            </div>
                          )}

                          {/* Content */}
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-sm font-bold text-white truncate leading-tight">
                                {item.name}
                              </h4>

                              {/* Price Inline Input */}
                              <div className="flex items-center gap-1 bg-slate-950/80 px-2 py-1 rounded-lg border border-slate-800">
                                <span className="text-[11px] text-amber-400 font-bold">$</span>
                                <input
                                  type="number"
                                  defaultValue={item.price}
                                  onBlur={(e) => handleUpdatePrice(item.id, parseFloat(e.target.value))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  }}
                                  className="w-20 bg-transparent text-amber-300 font-mono font-extrabold text-xs text-right focus:outline-none"
                                />
                              </div>
                            </div>

                            {item.description && (
                              <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                                {item.description}
                              </p>
                            )}

                            {/* Tags & Controls Bar */}
                            <div className="flex items-center justify-between pt-1 gap-2">
                              <div className="flex flex-wrap items-center gap-1">
                                {item.tags.map((tagKey) => {
                                  const tagInfo = MENU_TAGS[tagKey];
                                  if (!tagInfo) return null;
                                  return (
                                    <span
                                      key={tagKey}
                                      className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold border ${tagInfo.colorClass}`}
                                    >
                                      {tagInfo.emoji} {tagInfo.label}
                                    </span>
                                  );
                                })}
                                {item.isFeatured && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-0.5">
                                    <Star className="w-2.5 h-2.5 fill-amber-300" /> Destacado
                                  </span>
                                )}
                              </div>

                              {/* Stock Switch & Delete */}
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => handleToggleStock(item)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-extrabold transition-all flex items-center gap-1 ${
                                    item.isAvailable
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                                  }`}
                                  title="Alternar stock del plato"
                                >
                                  {item.isAvailable ? (
                                    <>
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                      <span>En Stock</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                                      <span>Agotado</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  onClick={() => handleDeleteItem(item.id)}
                                  className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                                  title="Eliminar plato"
                                  aria-label={`Eliminar plato ${item.name}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ==========================================
          MODAL: IMPORTAR DESDE EXCEL / CSV
      ========================================== */}
      {showImportModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-import-title"
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <h3 id="modal-import-title" className="text-base font-extrabold text-white">
                  Carga Masiva de Menú (Excel / CSV)
                </h3>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-white font-bold"
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <p className="text-xs text-slate-300">
                Sube tu archivo <span className="text-emerald-400 font-semibold">.csv</span> o pega las
                filas copiadas de tu Excel/Google Sheets. Columnas:
                <code className="text-amber-300 ml-1 font-mono text-[11px]">
                  Categoria, Plato, Descripcion, Precio, Etiquetas, Foto_URL
                </code>
              </p>

              {/* Upload Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-emerald-500/40 hover:border-emerald-500 bg-emerald-950/10 hover:bg-emerald-950/20 p-6 rounded-2xl text-center cursor-pointer transition-all space-y-2"
              >
                <Upload className="w-8 h-8 mx-auto text-emerald-400" />
                <p className="text-xs font-bold text-emerald-300">
                  Haz clic aquí para seleccionar tu archivo CSV o Excel
                </p>
                <p className="text-[10px] text-slate-400">Archivos .csv, .txt o formato delimitado</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>

              {/* Or Paste Raw Text */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 block">
                  O pega aquí el contenido de tu tabla directamente:
                </label>
                <textarea
                  rows={4}
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value);
                    parseCSVContent(e.target.value);
                  }}
                  placeholder="Pastas,Sorrentinos de Salmón,Con crema de puerros,14500,CHEF_PICK"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                ></textarea>
              </div>

              {importError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {/* Preview Table */}
              {parsedPreview.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-emerald-400">
                      ✓ Vista previa ({parsedPreview.length} platos detectados)
                    </h4>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={replaceExisting}
                        onChange={(e) => setReplaceExisting(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-indigo-600"
                      />
                      <span>Reemplazar toda la carta actual</span>
                    </label>
                  </div>

                  <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950/60 divide-y divide-slate-900 text-xs">
                    {parsedPreview.map((p, idx) => (
                      <div key={idx} className="p-2.5 flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 mr-2">
                            {p.category}
                          </span>
                          <span className="font-semibold text-white">{p.name}</span>
                          {p.description && (
                            <span className="text-slate-400 text-[11px] block truncate max-w-sm">
                              {p.description}
                            </span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono font-bold text-amber-300">
                            ${p.price.toLocaleString('es-AR')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={parsedPreview.length === 0 || importLoading}
                onClick={handleConfirmImport}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-950/30"
              >
                {importLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando carta...</span>
                  </>
                ) : (
                  <>
                    <span>Confirmar e Importar {parsedPreview.length} platos</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL: NUEVA CATEGORÍA
      ========================================== */}
      {showAddCategoryModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="add-category-title" className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCategory}
            className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="add-category-title" className="text-base font-extrabold text-white">Nueva Categoría de Carta</h3>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowAddCategoryModal(false);
                }}
                className="text-slate-400 hover:text-white font-bold"
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs font-semibold">
                {modalError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-300 block mb-1">Emoji / Ícono</label>
                <div className="flex gap-2">
                  {['🍝', '🥩', '🍹', '🍰', '☕', '🍔', '🥗', '🍷', '🍕', '🍣'].map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setNewCatIcon(icon)}
                      aria-label={`Seleccionar ícono ${icon}`}
                      className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center border transition-all ${
                        newCatIcon === icon
                          ? 'bg-indigo-600/30 border-indigo-500 scale-110'
                          : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-300 block mb-1">Nombre de la Categoría</label>
                <input
                  type="text"
                  placeholder="Ej: Pastas Caseras, Vinos de Guarda, Cafetería"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowAddCategoryModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={actionSubmitting}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30"
              >
                {actionSubmitting ? 'Creando...' : 'Crear Categoría'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==========================================
          MODAL: NUEVO PLATO
      ========================================== */}
      {showAddItemModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="add-item-title" className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateItem}
            className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="add-item-title" className="text-base font-extrabold text-white">Agregar Plato a la Carta</h3>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowAddItemModal(null);
                }}
                className="text-slate-400 hover:text-white font-bold"
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs font-semibold">
                {modalError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-300 block mb-1">Nombre del Plato *</label>
                <input
                  type="text"
                  placeholder="Ej: Raviolones de Ricota & Nueces"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-300 block mb-1">Descripción / Ingredientes</label>
                <textarea
                  rows={2}
                  placeholder="Ej: Con salsa fileto suave, albahaca fresca y lluvia de parmesano reggiano"
                  value={newItemDesc}
                  onChange={(e) => setNewItemDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                ></textarea>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-300 block mb-1">Precio ($ ARS) *</label>
                  <input
                    type="number"
                    placeholder="12500"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-amber-300 font-mono font-bold focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-300 block mb-1">URL de Foto (Opcional)</label>
                  <input
                    type="url"
                    placeholder="https://images.unsplash.com/..."
                    value={newItemImageUrl}
                    onChange={(e) => setNewItemImageUrl(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-300 block mb-1.5">Etiquetas Especiales</label>
                {/* E19: las etiquetas dietarias se muestran tal cual en la carta pública; marcar sólo las confirmadas por el local. */}
                <p className="text-[11px] leading-relaxed text-slate-400 mb-1.5">
                  Marcá sólo etiquetas confirmadas por el local: se muestran tal cual en la carta pública para filtrar Sin TACC, Vegano y Vegetariano. Sin etiqueta confirmada el plato sigue visible en “Todas” y se indica sin información confirmada.
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(MENU_TAGS).map(([tagKey, tagData]) => {
                    const isSelected = newItemTags.includes(tagKey);
                    return (
                      <button
                        key={tagKey}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setNewItemTags(newItemTags.filter((t) => t !== tagKey));
                          } else {
                            setNewItemTags([...newItemTags, tagKey]);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-xl font-semibold text-[11px] border transition-all ${
                          isSelected
                            ? `${tagData.colorClass} border-amber-400 ring-1 ring-amber-400`
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>{tagData.emoji}</span> {tagData.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newItemFeatured}
                    onChange={(e) => setNewItemFeatured(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-600"
                  />
                  <span>⭐ Marcar como Destacado / Sugerencia del Chef</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowAddItemModal(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={actionSubmitting}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30"
              >
                {actionSubmitting ? 'Guardando...' : 'Guardar Plato'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==========================================
          MODAL: PERSONALIZACIÓN DE MARCA
      ========================================== */}
      {showBrandingModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="branding-modal-title" className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveBranding}
            className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Palette className="w-5 h-5 text-amber-400" />
                <h3 id="branding-modal-title" className="text-base font-extrabold text-white">Marca & Estilo Visual</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowBrandingModal(false);
                }}
                className="text-slate-400 hover:text-white font-bold"
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs font-semibold">
                {modalError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-300 block mb-1">Color de Acento de la Marca</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="w-10 h-10 rounded-xl bg-transparent border-0 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono uppercase focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-300 block mb-1">Imagen de Portada / Hero (URL)</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/photo-..."
                  value={brandCover}
                  onChange={(e) => setBrandCover(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowBrandingModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={actionSubmitting}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs transition-all shadow-md shadow-amber-500/30"
              >
                {actionSubmitting ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* AI CHEF COPILOT MODAL */}
      <AIChefAssistantModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        restaurantSlug={restaurantId}
        onMenuApplied={() => {
          loadMenu();
        }}
      />
    </div>
  );
};
