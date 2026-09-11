export interface TableQRConfig {
  restaurantSlug: string;
  tableLabel: string;
  baseUrl: string;
}

/**
 * Stable physical QR/NFC destination. A physical tag never embeds a live
 * session token: the table URL resolves the current session at scan time.
 */
export function buildCanonicalTableUrl(config: TableQRConfig): string {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('baseUrl es obligatorio para generar un QR físico.');
  if (!config.restaurantSlug.trim()) throw new Error('restaurantSlug es obligatorio.');
  if (!config.tableLabel.trim()) throw new Error('tableLabel es obligatorio.');

  return `${baseUrl}/r/${encodeURIComponent(config.restaurantSlug.trim())}/mesa/${encodeURIComponent(config.tableLabel.trim())}`;
}
