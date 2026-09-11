import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { buildCanonicalTableUrl, TableQRConfig } from './qr-url';

async function generateTableQR(config: TableQRConfig, outputDir: string) {
  const url = buildCanonicalTableUrl(config);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const safeName = config.tableLabel.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const svgPath = path.join(outputDir, `qr_${safeName}.svg`);

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
  <text x="150" y="325" text-anchor="middle" font-size="11" font-weight="500" fill="#6b7280">Acercá el celular al NFC o escaneá el QR</text>
  <text x="150" y="342" text-anchor="middle" font-size="9" fill="#9ca3af">Sin descargar app</text>
</svg>
`;

  fs.writeFileSync(svgPath, customSvg.trim(), 'utf-8');
  console.log(`✅ QR generado para [${config.tableLabel}] -> ${svgPath}`);
}

async function main() {
  const outputDir = path.join(__dirname, 'output');
  const isDev = process.argv.includes('--dev');
  const targetBaseUrl = process.env.MESAYA_PUBLIC_URL || process.env.VITE_CLIENT_URL ||
    (isDev ? 'http://localhost:5173' : undefined);
  const restaurantSlug = process.env.MESAYA_RESTAURANT_SLUG;
  const tables = (process.env.MESAYA_TABLES || '')
    .split(',')
    .map((table) => table.trim())
    .filter(Boolean);

  if (!targetBaseUrl && !isDev) {
    throw new Error('Definí MESAYA_PUBLIC_URL (o VITE_CLIENT_URL) para generar QR de una instalación concreta.');
  }
  if (!restaurantSlug) {
    throw new Error('Definí MESAYA_RESTAURANT_SLUG; el generador no usa slugs históricos por defecto.');
  }
  if (tables.length === 0) {
    throw new Error('Definí MESAYA_TABLES como lista separada por comas (por ejemplo "Mesa 1,Mesa 2").');
  }

  console.log(`🏷️ Generando QR vectoriales para ${restaurantSlug} (Base URL: ${targetBaseUrl})...`);

  for (const tableLabel of tables) {
    await generateTableQR(
      {
        restaurantSlug,
        tableLabel,
        baseUrl: targetBaseUrl!
      },
      outputDir
    );
  }

  console.log(`\n🎉 Se generaron ${tables.length} archivos SVG en ${outputDir}`);
}

main().catch(console.error);
