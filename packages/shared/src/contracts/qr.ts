/**
 * Contrato canónico para la construcción de URLs de acceso comensal a mesas.
 */

export function buildCanonicalClientTableUrl(
  baseUrl: string,
  restaurantSlug: string,
  tableLabel: string
): string {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('baseUrl is required to construct canonical table URL');
  }
  if (!restaurantSlug || typeof restaurantSlug !== 'string') {
    throw new Error('restaurantSlug is required to construct canonical table URL');
  }
  if (!tableLabel || typeof tableLabel !== 'string') {
    throw new Error('tableLabel is required to construct canonical table URL');
  }

  const cleanBase = baseUrl.trim().replace(/\/+$/, '');
  const cleanSlug = restaurantSlug.trim().toLowerCase();
  const cleanLabel = encodeURIComponent(tableLabel.trim());

  return `${cleanBase}/r/${cleanSlug}/mesa/${cleanLabel}`;
}
