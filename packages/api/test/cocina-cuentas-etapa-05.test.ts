/**
 * Suite de Pruebas: COCINA-CUENTAS Etapa 05 — Comensal Web
 *
 * Valida:
 * 1. Estructura HTML para comensal: badge de participante, modal de unirse/cambiar nombre,
 *    controles de cantidad y notas en ficha de plato, botón de tanda, barra flotante de carrito,
 *    drawer de comanda con tabs de borrador y seguimiento en vivo.
 * 2. Lógica y contratos en app.js:
 *    - Gestión de identidad de participante ligada a la visita (sessionStorage + /v1/orders/participants/join).
 *    - Carrito borrador local por participante con claves aisladas.
 *    - El cliente envía sólo { menuItemId, quantity, notes } a /v1/orders/tandas con idempotencyKey
 *      y participantToken; no envía precio como autoridad.
 *    - Seguimiento de tandas (/v1/orders/tandas) con mapeo completo de estados FSM.
 *    - Neutralización de XSS: renderizado seguro sin interpolación en innerHTML.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('COCINA-CUENTAS Etapa 05 — Comensal Web (apps/client-web)', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const clientDir = path.join(projectRoot, 'apps', 'client-web');
  const htmlPath = path.join(clientDir, 'index.html');
  const appJsPath = path.join(clientDir, 'app.js');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // =========================================================================
  // 1. ESTRUCTURA HTML DE COMENSAL
  // =========================================================================
  describe('1. Estructura HTML y Controles de Comensal', () => {
    it('el header incluye botón para identificar al participante de visita', () => {
      expect(html).toContain('id="btnParticipantBadge"');
      expect(html).toContain('id="participantDisplayNameText"');
    });

    it('incluye modal para unirse o cambiar nombre de participante', () => {
      expect(html).toContain('id="modalParticipant"');
      expect(html).toContain('id="inputParticipantName"');
      expect(html).toContain('id="btnSaveParticipant"');
      expect(html).toContain('id="btnCloseModalParticipant"');
    });

    it('la ficha de plato (bottom-sheet) incluye selector de cantidad, notas y botón de tanda', () => {
      expect(html).toContain('id="btnDishQtyMinus"');
      expect(html).toContain('id="dishSheetQty"');
      expect(html).toContain('id="btnDishQtyPlus"');
      expect(html).toContain('id="dishSheetNotes"');
      expect(html).toContain('id="btnAddToTanda"');
      expect(html).toContain('id="btnOrderSpecificDish"');
    });

    it('incluye barra flotante de carrito con resumen y botón de ver', () => {
      expect(html).toContain('id="floatingCartBar"');
      expect(html).toContain('id="cartItemCountBadge"');
      expect(html).toContain('id="cartAuthorSubtitle"');
      expect(html).toContain('id="cartEstimatedTotal"');
    });

    it('incluye drawer nativo de comanda con tabs de borrador y seguimiento de tandas', () => {
      expect(html).toContain('id="modalCartSheet"');
      expect(html).toContain('id="tabCartDraftBtn"');
      expect(html).toContain('id="tabTandasTrackingBtn"');
      expect(html).toContain('id="viewCartDraft"');
      expect(html).toContain('id="viewTandasTracking"');
      expect(html).toContain('id="cartParticipantNameDisplay"');
      expect(html).toContain('id="cartDraftItemsContainer"');
      expect(html).toContain('id="inputTandaNotes"');
      expect(html).toContain('id="btnSubmitTanda"');
      expect(html).toContain('id="tandasTrackingListContainer"');
      expect(html).toContain('id="btnRefreshTandas"');
    });

    it('incluye botón de acceso al carrito desde el modal de la carta', () => {
      expect(html).toContain('id="btnOpenCartFromMenu"');
      expect(html).toContain('id="menuCartCountBadge"');
    });
  });

  // =========================================================================
  // 2. CONTRATOS Y LÓGICA EN app.js
  // =========================================================================
  describe('2. Contratos y Lógica en app.js', () => {
    it('gestiona la sesión del participante con sessionStorage y endpoint join', () => {
      expect(appJs).toContain('function initParticipantSession(');
      expect(appJs).toContain('function handleSaveParticipant(');
      expect(appJs).toContain('/orders/participants/join');
      expect(appJs).toContain('currentParticipantToken = data.participantToken');
      expect(appJs).toContain('currentParticipantDisplayName = data.displayName');
    });

    it('almacena y recupera el borrador del carrito localmente por participante', () => {
      expect(appJs).toContain('function loadDraftCart(');
      expect(appJs).toContain('function saveDraftCart(');
      expect(appJs).toContain('function addToDraftCart(');
      expect(appJs).toContain('function updateDraftCartItemQty(');
      expect(appJs).toContain('function removeFromDraftCart(');
    });

    it('el envío de tanda a la API sólo envía { menuItemId, quantity, notes } con idempotencyKey', () => {
      expect(appJs).toContain('function submitCurrentTanda(');
      expect(appJs).toContain('/orders/tandas');
      expect(appJs).toContain('menuItemId: item.id');
      expect(appJs).toContain('quantity: item.quantity');
      expect(appJs).toContain('notes: item.notes');
      expect(appJs).toContain('idempotencyKey');
      expect(appJs).toContain('participantToken: currentParticipantToken');
      // No debe enviar un precio unitario dictado por el cliente en el payload de tanda
      expect(appJs).not.toMatch(/menuItemId:\s*item\.id,\s*price:/);
      expect(appJs).not.toMatch(/menuItemId:\s*item\.id,\s*priceCents:/);
    });

    it('conserva la misma clave de idempotencia para reintentar el mismo borrador tras una respuesta perdida', () => {
      expect(appJs).toContain('function getOrCreatePendingTandaKey(');
      expect(appJs).toContain('function clearPendingTandaKey(');
      expect(appJs).toContain('mesaya_pending_tanda_');
      expect(appJs).toContain('fingerprint === fingerprint');
      expect(appJs).toContain('const idempotencyKey = getOrCreatePendingTandaKey');
      expect(appJs).toContain('clearPendingTandaKey(tableToken);');
    });

    it('maneja los errores de negocio de tandas (agotados, mesa pagada, pedidos desactivados)', () => {
      expect(appJs).toContain('ITEM_UNAVAILABLE');
      expect(appJs).toContain('TABLE_ALREADY_PAID');
      expect(appJs).toContain('ORDERING_DISABLED');
    });

    it('consulta y renderiza el historial de tandas con estados FSM legibles', () => {
      expect(appJs).toContain('function fetchAndRenderTandas(');
      expect(appJs).toContain('CONFIRMED');
      expect(appJs).toContain('IN_KITCHEN');
      expect(appJs).toContain('PREPARING');
      expect(appJs).toContain('READY');
      expect(appJs).toContain('SERVED');
      expect(appJs).toContain('REJECTED');
      expect(appJs).toContain('CANCELLED');
    });

    it('habilita swipe to dismiss en el drawer de comanda modalCartSheet', () => {
      expect(appJs).toContain("enableSheetSwipeToDismiss('modalCartSheet', closeCartSheet)");
    });
  });

  // =========================================================================
  // 3. SEGURIDAD Y PREVENCIÓN DE XSS
  // =========================================================================
  describe('3. Mitigación de XSS en Renderizado de Carrito y Tandas', () => {
    it('renderCartDraft construye nodos DOM seguros con textContent para nombres y notas', () => {
      expect(appJs).toContain('nameEl.textContent = item.name');
      expect(appJs).toContain('noteEl.textContent = `Aclaración: ${item.notes}`');
      expect(appJs).not.toMatch(/cartDraftItemsContainer\.innerHTML\s*=\s*`[\s\S]*?\${item\.name}/);
      expect(appJs).not.toMatch(/cartDraftItemsContainer\.innerHTML\s*=\s*`[\s\S]*?\${item\.notes}/);
    });

    it('fetchAndRenderTandas construye nodos DOM seguros con textContent para autores, notas y rechazos', () => {
      expect(appJs).toContain('authorSpan.textContent = `👤 ${authorName}`');
      expect(appJs).toContain('msg.textContent = `Motivo: ${tanda.rejectionReason}`');
      expect(appJs).toContain('noteP.textContent = `Nota: ${tanda.notes}`');
      expect(appJs).not.toMatch(/tandasTrackingListContainer\.innerHTML\s*=\s*`[\s\S]*?\${tanda\./);
    });
  });
});
