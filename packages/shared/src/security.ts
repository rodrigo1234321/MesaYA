/**
 * Utilidades de Sanitización y Mitigación Contextual de XSS (Etapa 19)
 *
 * Manejo estricto por contexto:
 * - Texto HTML (escapeHtml)
 * - Atributos HTML (escapeHtmlAttr)
 * - URLs de navegación / recursos (sanitizeUrl)
 * - Place IDs externos (sanitizeGooglePlaceId)
 */

/**
 * Escapa caracteres peligrosos para ser insertados como contenido de texto en HTML.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapa caracteres para inserción dentro de atributos HTML delimitados por comillas.
 */
export function escapeHtmlAttr(str: unknown): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/**
 * Allowlist de hosts externos de confianza para imágenes y recursos del cliente web.
 * Preserva las fuentes legítimas actualmente empleadas en el piloto.
 */
export const ALLOWED_EXTERNAL_HOSTS = new Set<string>([
  'images.unsplash.com',
  'plus.unsplash.com'
]);

export const ALLOWED_IMAGE_HOSTS = ALLOWED_EXTERNAL_HOSTS;

/**
 * Valida y sanitiza una URL antes de asignarla a src, href o similar.
 * 
 * Reglas de seguridad:
 * 1. Rechaza esquemas peligrosos (javascript:, data:, vbscript:, file:).
 * 2. Rechaza cualquier entrada que contenga barras invertidas ('\') o caracteres de control/espacio,
 *    evitando bypasses de normalización de navegadores (e.g. '/\\evil.example/x').
 * 3. Rutas relativas locales (/ o ./) son canonicalizadas contra un origen dummy y
 *    deben preservar origen local idéntico sin authority ni credenciales.
 * 4. URLs absolutas http: y https: deben cumplir:
 *    - Sin credenciales embebidas (username / password).
 *    - Puertos estándar (vacío, 80 para http o 443 para https).
 *    - Hostname estrictamente incluido en la allowlist de hosts de confianza.
 */
export function sanitizeUrl(
  url: unknown,
  fallback: string = '',
  allowedHosts: Set<string> = ALLOWED_EXTERNAL_HOSTS
): string {
  if (!url || typeof url !== 'string') return fallback;

  const trimmed = url.trim();
  if (!trimmed) return fallback;

  // Rechazar barras invertidas ('\') y caracteres de control/espacios internos
  if (trimmed.includes('\\') || /[\x00-\x1F\x7F\s]/.test(trimmed)) {
    return fallback;
  }

  // Rutas relativas locales seguras (/ o ./)
  if (trimmed.startsWith('/') || trimmed.startsWith('./')) {
    // Evitar bypasses tipo '//evil.com' (protocol-relative)
    if (trimmed.startsWith('//')) return fallback;

    try {
      const dummyOrigin = 'http://localhost-guard.local';
      const parsed = new URL(trimmed, dummyOrigin);

      // Si el navegador o el parser canonicalizó hacia un host externo, rechazar
      if (parsed.origin !== dummyOrigin) return fallback;
      if (parsed.username || parsed.password) return fallback;
      if (!parsed.pathname.startsWith('/')) return fallback;

      if (trimmed.startsWith('./')) {
        return '.' + parsed.pathname + parsed.search + parsed.hash;
      }
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (_) {
      return fallback;
    }
  }

  // URLs absolutas HTTP y HTTPS con allowlist estricta
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol !== 'http:' && protocol !== 'https:') {
      return fallback;
    }

    // Rechazar credenciales embebidas (user:pass@host)
    if (parsed.username || parsed.password) {
      return fallback;
    }

    // Rechazar puertos no estándar según el protocolo específico
    if (protocol === 'http:') {
      if (parsed.port && parsed.port !== '80') {
        return fallback;
      }
    } else if (protocol === 'https:') {
      if (parsed.port && parsed.port !== '443') {
        return fallback;
      }
    }

    // Comprobar hostname en allowlist
    const hostname = parsed.hostname.toLowerCase();
    if (!allowedHosts.has(hostname)) {
      return fallback;
    }

    return parsed.href;
  } catch (_) {
    return fallback;
  }
}

/**
 * Valida un identificador de Google Place ID.
 * Un Place ID legítimo está compuesto exclusivamente por caracteres alfanuméricos, guiones y guiones bajos.
 */
export function sanitizeGooglePlaceId(placeId: unknown): string | null {
  if (!placeId || typeof placeId !== 'string') return null;
  const trimmed = placeId.trim();
  if (/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}
