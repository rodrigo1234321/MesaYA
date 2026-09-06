/**
 * MesaYA RTMS — Centralized Allergen Detection Module
 * Shared across client, staff panel, and backend services to ensure
 * high-safety human waiter validation for sensitive dietary requirements.
 */

export const ALLERGEN_KEYWORDS = [
  'alerg',
  'celiac',
  'tacc',
  'gluten',
  'mani',
  'nuez',
  'nueces',
  'fruto seco',
  'frutos secos',
  'almendra',
  'avellana',
  'pistacho',
  'castana',
  'marisc',
  'camaron',
  'langostino',
  'pescado',
  'huevo',
  'leche',
  'lactos',
  'lacte',
  'soja',
  'soya',
  'sesamo',
  'sulfito',
  'intoleran'
] as const;

/**
 * Robust allergen detector supporting accented and unaccented Spanish keywords.
 * Normalizes input text via NFD diacritics removal before matching.
 */
export function containsAllergenMention(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;

  const trimmed = text.trim();
  if (!trimmed) return false;

  // 1. Direct regex check for accented and non-accented variants
  const directRegex =
    /(alerg|alérg|celiac|celíac|tacc|sin tacc|gluten|sin gluten|mani|maní|cacahuate|nuez|nueces|fruto[s]?\s*seco|almendra|avellana|pistacho|casta[nñ]a|marisc|camar[oó]n|langostino|pescado|huevo|leche|lactos|l[aá]cte|soja|soya|s[eé]samo|sulfito|intoleran)/i;
  if (directRegex.test(trimmed)) {
    return true;
  }

  // 2. Normalized check (removes diacritics / tildes: á->a, é->e, etc.)
  const normalized = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const normalizedRegex =
    /(alerg|celiac|tacc|sin tacc|gluten|sin gluten|mani|cacahuate|nuez|nueces|fruto[s]?\s*seco|almendra|avellana|pistacho|castana|marisc|camaron|langostino|pescado|huevo|leche|lactos|lacte|soja|soya|sesamo|sulfito|intoleran)/i;

  return normalizedRegex.test(normalized);
}
