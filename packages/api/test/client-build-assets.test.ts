import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../../..');
const clientRoot = path.join(projectRoot, 'apps', 'client-web');

describe('Etapa 21 — Build productivo del cliente sin demo ni Tailwind runtime', () => {
  it('retira CDN/runtime y controles de demostración del HTML de producción', () => {
    const html = fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf8');
    expect(html).not.toMatch(/cdn\.tailwindcss\.com/i);
    expect(html).not.toMatch(/btn-switch-(?:table|theme)/i);
    expect(html).not.toMatch(/maximum-scale\s*=|user-scalable\s*=/i);
  });

  it('mantiene la compilación CSS local y no una fuente duplicada de Google Fonts', () => {
    const css = fs.readFileSync(path.join(clientRoot, 'styles.css'), 'utf8');
    expect(css).toContain('@tailwind utilities;');
    expect(css).not.toMatch(/@import\s+url\([^)]*fonts\.googleapis\.com/i);
  });

  it('conserva Tailwind/PostCSS como dependencias de build del workspace', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(clientRoot, 'package.json'), 'utf8'));
    expect(pkg.devDependencies.tailwindcss).toBeTruthy();
    expect(pkg.devDependencies.postcss).toBeTruthy();
    expect(pkg.devDependencies.autoprefixer).toBeTruthy();
  });
});
