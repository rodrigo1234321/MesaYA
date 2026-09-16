import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

const appSrc = read('apps/admin-dashboard/src/App.tsx');
const metricsSrc = read('apps/admin-dashboard/src/components/MetricsView.tsx');
const modulesSrc = read('apps/admin-dashboard/src/components/ModuleConfigManager.tsx');
const rtmsSrc = read('apps/admin-dashboard/src/components/RTMSAnalyticsView.tsx');
const staffSrc = read('apps/admin-dashboard/src/components/StaffManager.tsx');
const salesSrc = read('apps/admin-dashboard/src/components/SalesManager.tsx');
const apiSrc = read('apps/admin-dashboard/src/lib/api.ts');
const tablesSrc = read('apps/admin-dashboard/src/components/TablesManager.tsx');
const qrContractSrc = read('packages/shared/src/contracts/qr.ts');

describe('E18 — Admin accesible, tenant-scoped y sin pérdida de Ventas (S25)', () => {
  it('conserva todas las entradas del Admin y las expone como tabs/panels accesibles', () => {
    const tabs = ['floorplan', 'tables', 'menu', 'modules', 'staff', 'metrics', 'sales'];
    expect(appSrc).toContain("const activeTabOrder = ['floorplan', 'tables', 'menu', 'modules', 'staff', 'metrics', 'sales']");
    expect(appSrc).toContain("e.key === 'ArrowRight'");
    expect(appSrc).toContain("e.key === 'ArrowLeft'");
    expect(appSrc).toContain("e.key === 'Home'");
    expect(appSrc).toContain("e.key === 'End'");
    expect(appSrc).toContain('role="tablist"');

    for (const tab of tabs) {
      expect(appSrc).toContain(`id="admin-tab-${tab}"`);
      expect(appSrc).toContain(`aria-controls="admin-panel-${tab}"`);
      expect(appSrc).toContain(`id="admin-panel-${tab}"`);
    }
    expect(appSrc).toContain('<FloorPlanManager');
    expect(appSrc).toContain('<TablesManager');
    expect(appSrc).toContain('<MenuManager');
    expect(appSrc).toContain('<ModuleConfigManager');
    expect(appSrc).toContain('<StaffManager');
    expect(appSrc).toContain('<RTMSAnalyticsView');
    expect(appSrc).toContain('<MetricsView');
    expect(appSrc).toContain('<SalesManager');
  });

  it('pasa cada vista con el tenant correcto y no inventa rutas de despliegue', () => {
    expect(appSrc).toContain('restaurantId={activeRestaurant.id}');
    expect(appSrc).toContain('restaurantSlug={activeRestaurant.slug || activeRestaurant.id}');
    expect(appSrc).toContain('restaurantSlug={activeRestaurant.slug}');
    expect(appSrc).toContain('restaurantId={selectedSlug}');
    expect(appSrc).not.toMatch(/href\s*=\s*["']\/(?:admin|staff)(?:["'\/])/);
  });

  it('mantiene la navegación semántica, foco y diálogos del dueño', () => {
    expect(appSrc).toContain('focus-visible:outline-2');
    expect(appSrc).toContain('aria-hidden="true"');
    expect(appSrc).toContain('role="dialog" aria-modal="true" aria-labelledby="admin-login-title"');
    expect(appSrc).toContain('role="dialog" aria-modal="true" aria-labelledby="admin-register-title"');
    expect(appSrc).toContain('id="admin-login-pin"');
    expect(appSrc).toContain('htmlFor="admin-login-pin"');
    expect(appSrc).toContain('id="admin-register-name"');
    expect(appSrc).toContain('htmlFor="admin-register-name"');
    expect(appSrc).toContain('role="alert"');
  });

  it('preserva flags, configuración de cobro y auditoría de módulos', () => {
    for (const key of [
      'allowOrdering',
      'allowSplitBill',
      'allowWaitersToCollectCash',
      'requireWaiterValidation',
      'enableUpsell',
      'enableSmartTips',
      'enableWaitlist',
      'enableWaitlistPreOrder',
      'enableRewards'
    ]) {
      expect(modulesSrc).toContain(key);
    }
    expect(modulesSrc).toContain('role="tablist"');
    expect(modulesSrc).toContain('role="switch"');
    expect(modulesSrc).toContain('aria-checked={config.allowWaitersToCollectCash}');
    expect(modulesSrc).toContain('getModuleConfigAudit');
    expect(modulesSrc).toContain('role="status"');
    expect(modulesSrc).toContain('role="alert"');
  });

  it('preserva Ventas, tickets, fiscal, filtros y exportaciones de E16', () => {
    for (const method of [
      'getSalesSummary',
      'getSalesOperations',
      'getFiscalDocuments',
      'exportSalesCsv',
      'downloadSalesSummaryPdf',
      'getReceipt',
      'downloadReceiptPdf',
      'createFiscalAssociation',
      'createPaymentAdjustment'
    ]) {
      expect(salesSrc).toContain(`AdminApi.${method}`);
    }
    for (const filter of ['shiftFilter', 'methodFilter', 'responsibleFilter', 'fiscalFilter']) {
      expect(salesSrc).toContain(filter);
    }
    expect(salesSrc).toContain('role="tablist"');
    expect(salesSrc).toContain('aria-label="Filtros de ventas"');
    expect(salesSrc).toContain('role="dialog" aria-modal="true"');
    expect(salesSrc).toContain('Cobrado neto');
    expect(salesSrc).toContain('Devolución');
    expect(apiSrc).toContain('/sales/summary');
    expect(apiSrc).toContain('/sales/operations');
    expect(apiSrc).toContain('/sales/export/csv');
    expect(apiSrc).toContain('/sales/summary/pdf');
  });

  it('mantiene estado honesto en métricas y hace RTMS utilizable sin hover/color', () => {
    expect(metricsSrc).toContain('role="status"');
    expect(metricsSrc).toContain('role="alert"');
    expect(metricsSrc).toContain('setMetrics');
    expect(rtmsSrc).toContain('setLoadError');
    expect(rtmsSrc).toContain('role="alert"');
    expect(rtmsSrc).toContain('aria-hidden="true"');
    expect(rtmsSrc).toContain('Ver ocupación por día y hora como texto');
    expect(rtmsSrc).toContain('scope="col"');
    expect(rtmsSrc).toContain('Sin ocupación registrada en el rango seleccionado.');
  });

  it('mantiene el alta de personal con permisos visibles y diálogo identificable', () => {
    expect(staffSrc).toContain('AdminApi.getStaff');
    expect(staffSrc).toContain('AdminApi.createStaff');
    expect(staffSrc).toContain('role="dialog" aria-modal="true" aria-label="Alta de personal"');
    expect(staffSrc).toContain('type="button"');
  });

  it('genera QR sólo desde VITE_CLIENT_WEB_URL y diagnostica su ausencia', () => {
    expect(tablesSrc).toContain('VITE_CLIENT_WEB_URL');
    expect(tablesSrc).toContain('buildCanonicalClientTableUrl');
    expect(tablesSrc).toContain('No se puede generar el QR: falta configurar VITE_CLIENT_WEB_URL');
    expect(tablesSrc).toContain('disabled={!clientUrl}');
    expect(tablesSrc).toContain('QR no disponible');
    expect(tablesSrc).toContain('role="dialog" aria-modal="true" aria-labelledby="admin-qr-title"');
    expect(tablesSrc).not.toContain('window.location.hostname');
    expect(tablesSrc).not.toContain('VITE_CLIENT_URL');
    expect(qrContractSrc).toContain('/r/${cleanSlug}/mesa/${cleanLabel}');
  });

  it('no filtra detalles internos al presentar 401/403 del Admin', () => {
    expect(apiSrc).toContain('response.status === 401 || response.status === 403');
    expect(apiSrc).toContain('Tu sesión no tiene autorización para esta acción');
    expect(apiSrc).not.toContain('error.stack');
  });
});
