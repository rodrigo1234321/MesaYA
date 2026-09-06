import fs from 'fs';
import path from 'path';

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]!));

interface TableQRConfig {
  restaurantSlug: string;
  tableLabel: string;
  token?: string;
  baseUrl?: string;
}

export async function generateTableQR(config: TableQRConfig, outputDir: string) {
  // Sin fallback silencioso: baseUrl explícita requerida por el llamante.
  const baseUrl = config.baseUrl;
  if (!baseUrl) {
    throw new Error('generateTableQR requiere baseUrl explícita (ver resolveBaseUrl).');
  }
  const url = config.token
    ? `${baseUrl}/mesa/${encodeURIComponent(config.tableLabel)}?token=${config.token}`
    : `${baseUrl}/r/${config.restaurantSlug}/mesa/${encodeURIComponent(config.tableLabel)}`;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const safeName = config.tableLabel.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const svgPath = path.join(outputDir, `qr_${safeName}.svg`);

  // Importación diferida: los tests de resolveBaseUrl no requieren 'qrcode'.
  const { default: QRCode } = await import('qrcode');
  // Generate SVG with high error correction (Level H for laser engraving / logo embedding)
  const svgString = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 4,
    color: {
      dark: '#111827',
      light: '#ffffff'
    }
  });

  // Embed table label in SVG header
  const customSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 360" width="300" height="360" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <rect width="300" height="360" rx="16" fill="#ffffff" stroke="#e5e7eb" stroke-width="2"/>
  
  <!-- Header / Table Label -->
  <text x="150" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#111827" letter-spacing="1">MESAYA</text>
  <text x="150" y="60" text-anchor="middle" font-size="14" font-weight="600" fill="#4f46e5">${escapeXml(config.tableLabel.toUpperCase())}</text>
  
  <!-- QR Code Inner -->
  ${svgString.replace(/<\?xml.*?\?>/, '').replace('<svg ', '<svg x="30" y="75" width="240" height="240" ')}
  
  <!-- Footer instructions -->
  <text x="150" y="325" text-anchor="middle" font-size="11" font-weight="500" fill="#6b7280">Apoyá el celular (NFC) o escaneá el QR</text>
  <text x="150" y="342" text-anchor="middle" font-size="9" fill="#9ca3af">Mar del Plata • Sin descargar app</text>
</svg>
`;

  fs.writeFileSync(svgPath, customSvg.trim(), 'utf-8');
  console.log(`✅ QR generado para [${config.tableLabel}] -> ${svgPath}`);
  return { tableLabel: config.tableLabel, url, svgPath };
}

export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): string {
  const isProduction = env.NODE_ENV === 'production';
  const explicit = (env.MESAYA_PUBLIC_URL || env.VITE_CLIENT_URL || env.VITE_CLIENT_WEB_URL || '').trim();
  if (explicit) {
    let url: URL;
    try {
      url = new URL(explicit);
    } catch (_) {
      throw new Error(`URL pública de QR inválida: ${explicit}. Configurá MESAYA_PUBLIC_URL (o VITE_CLIENT_URL) con https://<dominio-comensal>.`);
    }
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new Error(`URL pública de QR debe ser HTTPS pública: ${explicit}. En local usá --dev (http://localhost:5173).`);
    }
    return explicit.replace(/\/$/, '');
  }
  if (isProduction) {
    throw new Error('En producción se exige MESAYA_PUBLIC_URL (o VITE_CLIENT_URL) con URL pública HTTPS para QR. Sin ella no se genera ningún QR.');
  }
  // Experiencia local segura: localhost explícito.
  if (argv.includes('--dev')) return 'http://localhost:5173';
  return 'http://localhost:5173';
}

async function main() {
  const outputDir = path.join(__dirname, 'output');
  const targetBaseUrl = resolveBaseUrl();
  if (!targetBaseUrl.startsWith('https://') && !process.argv.includes('--dev')) {
    throw new Error('Configurá MESAYA_PUBLIC_URL HTTPS antes de generar el lote físico; --dev es sólo para muestras locales.');
  }

  const slugIndex = process.argv.indexOf('--slug');
  const slug = slugIndex >= 0 ? process.argv[slugIndex + 1] : process.env.BOOTSTRAP_RESTAURANT_SLUG;
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Indicá --slug con el slug real del restaurante.');
  }
  const tablesIndex = process.argv.indexOf('--tables-json');
  if (tablesIndex < 0 || !process.argv[tablesIndex + 1]) {
    throw new Error('Indicá --tables-json con un archivo JSON de etiquetas reales, por ejemplo ["Mesa 1", "Mesa 2"].');
  }
  const tables: unknown = JSON.parse(fs.readFileSync(process.argv[tablesIndex + 1], 'utf8'));
  if (!Array.isArray(tables) || tables.length === 0 || tables.length > 100 || tables.some(t => typeof t !== 'string' || !t.trim())) {
    throw new Error('El archivo debe contener entre 1 y 100 etiquetas de mesa no vacías.');
  }
  const filenames = tables.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  if (new Set(filenames).size !== tables.length) throw new Error('Etiquetas generan archivos duplicados; corregí las etiquetas.');

  console.log(`🏷️ Generando lote de plantillas QR vectoriales (Base URL: ${targetBaseUrl})...`);

  const manifest = [];
  for (const tableLabel of tables) {
    manifest.push(await generateTableQR(
      {
        restaurantSlug: slug,
        tableLabel,
        baseUrl: targetBaseUrl
      },
      outputDir
    ));
  }

  fs.writeFileSync(path.join(outputDir, 'nfc-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\n🎉 Se generaron ${tables.length} archivos SVG en ${outputDir}`);
}

export type { TableQRConfig };

// No lanzar efectos al importar (tests importan resolveBaseUrl/generateTableQR).
const isQrDirectRun =
  typeof process.argv[1] === 'string' && /generate(\.[jt]s)?$/.test(process.argv[1]);
if (isQrDirectRun && !process.env.VITEST_WORKER_ID) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
