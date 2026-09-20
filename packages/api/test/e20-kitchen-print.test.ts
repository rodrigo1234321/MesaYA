import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * E20 — comanda de cocina imprimible y operación con un equipo (S18).
 *
 * Contrato estático de apps/staff-panel/src/components/KitchenOrdersManager.tsx
 * + apps/staff-panel/src/index.css: hoja COMANDA DE COCINA separada del recibo
 * económico, con ID/mesa/hora/cantidades/notas/comensal, advertencias honestas,
 * bloque de entrega manual, formatos 58/80/A4, guía de una pantalla, handler de
 * impresión sólo local (sin mutación ni nuevo pedido) y estilos @media print
 * que ocultan la interfaz sólo al imprimir. Sin hardware ni ESC/POS.
 */
describe('E20 — comanda de cocina imprimible en un puesto único (S18)', () => {
  const repoRoot = resolve(__dirname, '../../..');
  const src = readFileSync(
    resolve(repoRoot, 'apps/staff-panel/src/components/KitchenOrdersManager.tsx'),
    'utf8'
  );
  const css = readFileSync(resolve(repoRoot, 'apps/staff-panel/src/index.css'), 'utf8');

  function fnBody(source: string, marker: string): string {
    const start = source.indexOf(marker);
    expect(start, `${marker} existe`).toBeGreaterThanOrEqual(0);
    // Recorta hasta la próxima const de handler de negocio o hook, sin
    // arrastrar el resto del archivo (que sí contiene mutaciones E14).
    const tail = source.slice(start);
    const next = tail.slice(marker.length).search(/\n  const (handle|filteredOrders|count|printOrder)\b/);
    return next === -1 ? tail : tail.slice(0, next + marker.length);
  }

  const openPrintBody = () => fnBody(src, 'const handleOpenKitchenPrint');
  const requestKitchenPrintBody = () => fnBody(src, 'const handleRequestKitchenPrint');
  const requestPrintBody = () => fnBody(src, 'const requestBrowserPrint');
  const closePrintBody = () => fnBody(src, 'const handleCloseKitchenPrint');

  describe('hoja de cocina diferenciada del recibo económico', () => {
    it('titula COMANDA DE COCINA y niega recibo/cobro', () => {
      expect(src).toContain('COMANDA DE COCINA');
      expect(src).toContain('No es un recibo económico');
      for (const body of [openPrintBody(), requestKitchenPrintBody(), requestPrintBody()]) {
        expect(body).not.toContain('ReceiptService');
        expect(body).not.toContain('PAYMENT_RECEIPT');
        expect(body).not.toContain('PRE_BILL_DETAIL');
      }
    });

    it('muestra ID, mesa/sector, fecha-hora, cantidades, notas y comensal', () => {
      expect(src).toContain('ID de comanda:');
      expect(src).toContain('{printOrder.id}');
      expect(src).toContain('{printOrder.tableLabel}');
      expect(src).toContain('{printOrder.sector}');
      expect(src).toContain('{printOrder.createdAt}');
      expect(src).toContain('{item.quantity}x');
      expect(src).toContain('{item.name}');
      expect(src).toContain('Notas: {item.notes}');
      expect(src).toContain('Comensal: {item.guestName}');
    });

    it('advierte que abrir/imprimir no es entrega, cobro ni cambio de estado', () => {
      expect(src).toContain(
        'Abrir o imprimir esta hoja no confirma entrega, cobro ni cambio de estado.'
      );
      expect(src).toContain('Registrar la solicitud no confirma que salió papel.');
      expect(src).toContain('Listo para servir sigue esperando retiro por mozo');
    });
  });

  describe('entrega manual, una pantalla y formatos', () => {
    it('incluye ficha manual con entregó/recibió/hora e iniciales-conciliación', () => {
      expect(src).toContain('aria-label="Entrega manual"');
      expect(src).toContain('Entregó:');
      expect(src).toContain('Recibió:');
      expect(src).toContain('Hora de recepción:');
      expect(src).toContain('Iniciales / firma:');
      expect(src).toContain('Conciliación:');
      expect(src).toContain('sin crear otro pedido');
    });

    it('explica el modo de una pantalla y el gate humano/físico pendiente', () => {
      expect(src).toContain('Modo de una pantalla');
      expect(src).toContain('Imprimí o copiá los datos');
      expect(src).toContain('llevá la comanda a cocina');
      expect(src).toContain('completá la recepción manual');
      expect(src).toContain('queda pendiente el gate humano/físico');
    });

    it('permite elegir formato 58 mm, 80 mm o A4', () => {
      expect(src).toContain('Formato de impresión:');
      expect(src).toContain('aria-label="Formato de impresión"');
      expect(src).toContain('<option value="58">58 mm</option>');
      expect(src).toContain('<option value="80">80 mm</option>');
      expect(src).toContain('<option value="A4">A4</option>');
      expect(src).toContain('e20-format-');
      expect(css).toContain('.e20-format-58');
      expect(css).toContain('.e20-format-80');
      expect(css).toContain('.e20-format-A4');
    });
  });

  describe('imprimir sin mutación ni nuevo pedido', () => {
    it('el handler de impresión no muta negocio ni pide recibo', () => {
      for (const body of [openPrintBody(), requestPrintBody()]) {
        expect(body).not.toContain('updateOrderStatus');
        expect(body).not.toContain('addManualOrderByStaff');
        expect(body).not.toContain('StaffApi');
        expect(body).not.toContain('ReceiptService');
        expect(body).not.toContain('fetch(');
        expect(body).not.toContain('/receipt');
      }
    });

    it('la reimpresión es sólo estado local, rotulada y sin crear pedido', () => {
      expect(src).toContain('const [printRequests, setPrintRequests]');
      expect(src).toContain("setPrintVariant(prior > 0 ? 'reprint' : 'original')");
      expect(src).toContain('Imprimir comanda');
      expect(src).toContain('Reimprimir comanda');
      expect(src).toContain('REIMPRESIÓN / SOLICITUD DE COPIA');
      expect(openPrintBody()).not.toContain('addManualOrderByStaff');
      expect(openPrintBody()).toContain('setPrintRequests');
      expect(requestKitchenPrintBody()).toContain('setPrintVariant');
      expect(requestKitchenPrintBody()).toContain('setPrintRequests');
      expect(requestKitchenPrintBody()).not.toContain('addManualOrderByStaff');
    });

    it('cancelar el diálogo no marca entrega: no hay callback de estado', () => {
      expect(src).not.toContain('onafterprint');
      expect(src).not.toContain('afterprint');
      expect(closePrintBody()).toContain('setPrintOrderId(null)');
      expect(closePrintBody()).not.toContain('updateOrderStatus');
      expect(closePrintBody()).not.toContain('SERVE_ORDER');
      expect(closePrintBody()).not.toContain('entregado');
    });

    it('window.print sólo ocurre al abrir la hoja, sin popups ni hardware', () => {
      const occurrences = src.split('window.print').length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(1);
      expect(requestPrintBody()).toContain('window.print()');
      expect(requestKitchenPrintBody()).toContain('requestBrowserPrint()');
      expect(src).not.toContain('window.open');
      expect(src).not.toContain('ESC/POS');
      expect(src).not.toContain('navigator.usb');
      expect(src).not.toContain('navigator.serial');
      expect(src).not.toContain('navigator.bluetooth');
    });
  });

  describe('accesibilidad, E14 preservado e impresión', () => {
    it('botones de comanda con type, nombre accesible y foco visible', () => {
      const printAt = src.indexOf('handleOpenKitchenPrint(order)');
      expect(printAt).toBeGreaterThanOrEqual(0);
      const buttonStart = src.lastIndexOf('<button', printAt);
      const button = src.slice(buttonStart, src.indexOf('>', printAt) + 1);
      expect(button).toContain('type="button"');
      expect(button).toContain('aria-label=');
      expect(button).toContain('focus-visible:');
      expect(button).toContain('disabled={isActing}');
    });

    it('conserva estados E14 sin convertir listo en entregado', () => {
      expect(src).toContain('Listo para servir (Avisar a salón)');
      expect(src).toContain('Esperando retiro por mozo');
      expect(src).toContain("updateOrderStatus(orderId, 'READY_TO_SERVE')");
      expect(openPrintBody()).not.toContain('READY_TO_SERVE');
      expect(openPrintBody()).not.toContain('SERVED');
      expect(src).not.toContain('marcar entregado');
    });

    it('conserva notas, comensal e ítems E14 en la tarjeta', () => {
      expect(src).toContain('{item.notes}');
      expect(src).toContain('{item.guestName}');
      expect(src).toContain('{item.quantity}x');
      expect(src).toContain('En Preparación');
    });

    it('los estilos @media print ocultan la interfaz sólo al imprimir', () => {
      expect(css).toContain('@media print');
      expect(css).toContain('.e20-kitchen-scope > *:not(.e20-print-overlay)');
      expect(css).toContain('.e20-no-print');
      expect(css).toContain('.e20-kitchen-ticket');
      expect(css).toContain('@page');
      // El ticket no se oculta en render normal: el bloque E20 previo al
      // @media print sólo define color/fondo y anchos, sin display.
      const e20Pre = css.slice(css.indexOf('.e20-kitchen-ticket'));
      const e20PrePrint = e20Pre.slice(0, e20Pre.indexOf('@media print'));
      expect(e20PrePrint).toContain('.e20-format-58');
      expect(e20PrePrint).not.toContain('display');
    });
  });
});
