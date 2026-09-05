import fs from 'fs';
import path from 'path';

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
    margin: 2,
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
  <text x="150" y="60" text-anchor="middle" font-size="14" font-weight="600" fill="#4f46e5">${config.tableLabel.toUpperCase()}</text>
  
  <!-- QR Code Inner -->
  <g transform="translate(30, 75) scale(0.8)">
    ${svgString.replace(/<\?xml.*?\?>/, '').replace(/<svg.*?>/, '').replace(/<\/svg>/, '')}
  </g>
  
  <!-- Footer instructions -->
  <text x="150" y="325" text-anchor="middle" font-size="11" font-weight="500" fill="#6b7280">Apoyá el celular (NFC) o escaneá el QR</text>
  <text x="150" y="342" text-anchor="middle" font-size="9" fill="#9ca3af">Mar del Plata • Sin descargar app</text>
</svg>
`;

  fs.writeFileSync(svgPath, customSvg.trim(), 'utf-8');
  console.log(`✅ QR generado para [${config.tableLabel}] -> ${svgPath}`);
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

  console.log(`🏷️ Generando lote de plantillas QR vectoriales (Base URL: ${targetBaseUrl})...`);

  const tables = [
    'Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Mesa 5',
    'Terraza 1', 'Terraza 2', 'Terraza 3',
    'Vereda 1', 'Barra 1'
  ];

  for (const tableLabel of tables) {
    await generateTableQR(
      {
        restaurantSlug: 'trattoria-del-puerto',
        tableLabel,
        baseUrl: targetBaseUrl
      },
      outputDir
    );
  }

  console.log(`\n🎉 Se generaron ${tables.length} archivos SVG en ${outputDir}`);
}

export type { TableQRConfig };

// No lanzar efectos al importar (tests importan resolveBaseUrl/generateTableQR).
const isQrDirectRun =
  typeof process.argv[1] === 'string' && /generate(\.[jt]s)?$/.test(process.argv[1]);
if (isQrDirectRun && !process.env.VITEST_WORKER_ID) {
  main().catch(console.error);
}
