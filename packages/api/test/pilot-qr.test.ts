import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateTableQR } from '../../../hardware/qr-generator/generate';

describe('Kit QR físico del piloto', () => {
  it('conserva viewBox, tamaño legible y etiqueta escapada; devuelve la URL para NFC', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesaya-qr-'));
    try {
      const result = await generateTableQR({ restaurantSlug: 'mesaya-piloto', tableLabel: 'Mesa 1 & <2>', baseUrl: 'https://piloto.example.com' }, dir);
      const svg = fs.readFileSync(result.svgPath, 'utf8');
      expect(svg).toMatch(/<svg x="30" y="75" width="240" height="240"[^>]*viewBox="0 0 \d+ \d+"/);
      expect(svg).toContain('MESA 1 &amp; &lt;2&gt;');
      expect(result.url).toBe('https://piloto.example.com/r/mesaya-piloto/mesa/Mesa%201%20%26%20%3C2%3E');
      expect(result.url).not.toContain('token=');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
