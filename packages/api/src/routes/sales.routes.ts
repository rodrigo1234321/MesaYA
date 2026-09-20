import { FastifyPluginAsync } from 'fastify';
import { SalesReportsService } from '../services/sales-reports.service';
import { ReceiptService } from '../services/receipt.service';
import { FiscalService } from '../services/fiscal.service';
import { verifyManagerRole, requireRestaurantAccess } from '../middlewares/auth.middleware';
import { sendSanitizedError } from '../lib/errorHandler';
import { prisma } from '../lib/prisma';

export const salesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/admin/restaurants/:restaurantId/sales/summary
   * Resumen financiero de ventas y cobros por período. Requiere MANAGER del tenant.
   */
  fastify.get<{
    Params: { restaurantId: string };
    Querystring: {
      period?: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
      dateFrom?: string;
      dateTo?: string;
      shiftId?: string;
      paymentMethod?: string;
      responsibleStaffUserId?: string;
      hasFiscalDocument?: string;
    };
  }>(
    '/admin/restaurants/:restaurantId/sales/summary',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId } = request.params;
      const q = request.query || {};
      try {
        const summary = await SalesReportsService.getSalesSummary(restaurantId, {
          period: q.period,
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
          shiftId: q.shiftId,
          paymentMethod: q.paymentMethod,
          responsibleStaffUserId: q.responsibleStaffUserId,
          hasFiscalDocument: q.hasFiscalDocument !== undefined ? q.hasFiscalDocument === 'true' : undefined
        });
        return reply.send(summary);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * GET /v1/admin/restaurants/:restaurantId/sales/operations
   * Detalle de operaciones con drill-down a tandas e ítems. Requiere MANAGER del tenant.
   */
  fastify.get<{
    Params: { restaurantId: string };
    Querystring: {
      period?: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
      dateFrom?: string;
      dateTo?: string;
      shiftId?: string;
      paymentMethod?: string;
      responsibleStaffUserId?: string;
      hasFiscalDocument?: string;
    };
  }>(
    '/admin/restaurants/:restaurantId/sales/operations',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId } = request.params;
      const q = request.query || {};
      try {
        const ops = await SalesReportsService.getSalesOperations(restaurantId, {
          period: q.period,
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
          shiftId: q.shiftId,
          paymentMethod: q.paymentMethod,
          responsibleStaffUserId: q.responsibleStaffUserId,
          hasFiscalDocument: q.hasFiscalDocument !== undefined ? q.hasFiscalDocument === 'true' : undefined
        });
        return reply.send({ operations: ops });
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * GET /v1/admin/restaurants/:restaurantId/sales/summary/pdf
   * Reporte resumen de ventas en formato A4 PDF con leyenda de documento no fiscal. Requiere MANAGER.
   */
  fastify.get<{
    Params: { restaurantId: string };
    Querystring: {
      period?: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
      dateFrom?: string;
      dateTo?: string;
      shiftId?: string;
      paymentMethod?: string;
      responsibleStaffUserId?: string;
      hasFiscalDocument?: string;
    };
  }>(
    '/admin/restaurants/:restaurantId/sales/summary/pdf',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId } = request.params;
      const q = request.query || {};
      try {
        const summary = await SalesReportsService.getSalesSummary(restaurantId, {
          period: q.period,
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
          shiftId: q.shiftId,
          paymentMethod: q.paymentMethod,
          responsibleStaffUserId: q.responsibleStaffUserId,
          hasFiscalDocument: q.hasFiscalDocument !== undefined ? q.hasFiscalDocument === 'true' : undefined
        });

        const restaurant = await prisma.restaurant.findUnique({
          where: { id: restaurantId },
          select: { name: true, timezone: true }
        });

        const name = restaurant?.name || 'MesaYA Restaurante';
        const tz = restaurant?.timezone || 'America/Argentina/Buenos_Aires';
        const pdfBuffer = ReceiptService.generateSalesSummaryA4PdfBuffer(summary, name, tz);

        reply.header('Content-Type', 'application/pdf');
        reply.header(
          'Content-Disposition',
          `inline; filename="resumen-ventas-${restaurantId}-${new Date().toISOString().slice(0, 10)}.pdf"`
        );
        return reply.send(pdfBuffer);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/admin/restaurants/:restaurantId/sales/settlements/:settlementId/adjustments
   * Registra una devolución o ajuste parcial/total sobre un cobro existente. Requiere MANAGER.
   */
  fastify.post<{
    Params: { restaurantId: string; settlementId: string };
    Body: {
      amountMinor: number;
      tipMinor?: number;
      reason: string;
    };
  }>(
    '/admin/restaurants/:restaurantId/sales/settlements/:settlementId/adjustments',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId, settlementId } = request.params;
      const body = request.body || ({} as any);
      const staffUserId = request.staffUser?.sub || 'admin';
      try {
        const adjustment = await SalesReportsService.createPaymentAdjustment(restaurantId, settlementId, {
          amountMinor: body.amountMinor,
          tipMinor: body.tipMinor,
          reason: body.reason,
          adjustedBy: staffUserId
        });
        return reply.status(201).send(adjustment);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * GET /v1/admin/restaurants/:restaurantId/sales/export/csv
   * Exportación tabular CSV de operaciones y cobros del período. Requiere MANAGER del tenant.
   */
  fastify.get<{
    Params: { restaurantId: string };
    Querystring: {
      period?: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
      dateFrom?: string;
      dateTo?: string;
      shiftId?: string;
      paymentMethod?: string;
      responsibleStaffUserId?: string;
      hasFiscalDocument?: string;
    };
  }>(
    '/admin/restaurants/:restaurantId/sales/export/csv',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId } = request.params;
      const q = request.query || {};
      try {
        const filters = {
          period: q.period,
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
          shiftId: q.shiftId,
          paymentMethod: q.paymentMethod,
          responsibleStaffUserId: q.responsibleStaffUserId,
          hasFiscalDocument: q.hasFiscalDocument !== undefined ? q.hasFiscalDocument === 'true' : undefined
        };
        const [summary, ops] = await Promise.all([
          SalesReportsService.getSalesSummary(restaurantId, filters),
          SalesReportsService.getSalesOperations(restaurantId, filters)
        ]);

        // Generar CSV con protección contra inyección de fórmulas (=, +, -, @, \t, \r)
        const csvCell = (value: unknown) => {
          let str = String(value ?? '').replace(/"/g, '""');
          if (/^[=+\-@\t\r]/.test(str)) {
            str = `'${str}`;
          }
          return `"${str}"`;
        };
        // E16: etiquetas canónicas (consumo, cobrado neto, propina,
        // devolución, saldo, turno) con la misma semántica del resumen y el
        // detalle. El saldo es de la cuenta completa; el resto, del período.
        const headers = [
          'restaurantId',
          'currency',
          'timezone',
          'periodFrom',
          'periodTo',
          'turno',
          'tableSessionId',
          'tableLabel',
          'sector',
          'sessionStartedAt',
          'sessionClosedAt',
          'status',
          'consumoPesos',
          'cobradoNetoPesos',
          'propinaPesos',
          'devolucionPesos',
          'saldoPesos',
          'responsables',
          'tickets',
          'pagosDetalle'
        ];

        const rows = [headers.join(',')];
        for (const op of ops) {
          const pagosStr = op.settlements
            .map((s) => {
              const adjustments = (s.adjustments || []).reduce((sum, a) => sum + a.totalAdjustedMinor, 0);
              return `${s.settlementId} · ${s.method} · ${s.methodLabel}: $${(s.totalMinor / 100).toFixed(2)} · Mozo: ${s.responsibleStaffName || s.responsibleStaffUserId} · Ajustes: $${(adjustments / 100).toFixed(2)}`;
            })
            .join(' | ');
          const responsables = [...new Set(op.settlements.map((s) => s.responsibleStaffUserId))].join(' | ');
          const tickets = op.receipts.map((receipt) => `${receipt.receiptNumber} (${receipt.receiptType})`).join(' | ');
          const row = [
            csvCell(restaurantId),
            csvCell(summary.currency),
            csvCell(summary.timezone),
            csvCell(summary.dateFrom),
            csvCell(summary.dateTo),
            csvCell(summary.shiftLabel || summary.period),
            csvCell(op.tableSessionId),
            csvCell(op.tableLabel),
            csvCell(op.sector),
            csvCell(op.sessionStartedAt),
            csvCell(op.sessionClosedAt || ''),
            csvCell(op.status),
            csvCell((op.consumoTotalMinor / 100).toFixed(2)),
            csvCell((op.cobradoTotalMinor / 100).toFixed(2)),
            csvCell((op.propinaTotalMinor / 100).toFixed(2)),
            csvCell((op.devolucionTotalMinor / 100).toFixed(2)),
            csvCell((op.saldoMinor / 100).toFixed(2)),
            csvCell(responsables),
            csvCell(tickets),
            csvCell(pagosStr)
          ];
          rows.push(row.join(','));
        }

        const csvContent = `\uFEFF${rows.join('\r\n')}`;
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header(
          'Content-Disposition',
          `attachment; filename="ventas-${restaurantId}-${new Date().toISOString().slice(0, 10)}.csv"`
        );
        return reply.send(csvContent);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/admin/restaurants/:restaurantId/receipts
   * Generación o recuperación idempotente de snapshot de ticket. Requiere MANAGER.
   */
  fastify.post<{
    Params: { restaurantId: string };
    Body: {
      tableSessionId: string;
      settlementId?: string;
      receiptType: 'PRE_BILL_DETAIL' | 'PAYMENT_RECEIPT';
      idempotencyKey?: string;
    };
  }>(
    '/admin/restaurants/:restaurantId/receipts',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId } = request.params;
      const body = request.body || ({} as any);
      try {
        const receipt = await ReceiptService.getOrCreateReceipt({
          restaurantId,
          tableSessionId: body.tableSessionId,
          settlementId: body.settlementId,
          receiptType: body.receiptType || 'PAYMENT_RECEIPT',
          idempotencyKey: body.idempotencyKey
        });
        return reply.status(201).send(receipt);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * GET /v1/admin/restaurants/:restaurantId/receipts/:receiptId
   * Consulta de ticket snapshot. Requiere MANAGER.
   */
  fastify.get<{
    Params: { restaurantId: string; receiptId: string };
  }>(
    '/admin/restaurants/:restaurantId/receipts/:receiptId',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId, receiptId } = request.params;
      try {
        const receipt = await ReceiptService.getReceiptById(restaurantId, receiptId);
        return reply.send(receipt);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * GET /v1/admin/restaurants/:restaurantId/receipts/:receiptId/pdf
   * Descarga del PDF térmico de 80 mm. Requiere MANAGER.
   */
  fastify.get<{
    Params: { restaurantId: string; receiptId: string };
  }>(
    '/admin/restaurants/:restaurantId/receipts/:receiptId/pdf',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId, receiptId } = request.params;
      try {
        const receipt = await ReceiptService.getReceiptById(restaurantId, receiptId);
        const pdfBuffer = await ReceiptService.getReceiptPdfBuffer(restaurantId, receiptId);
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `inline; filename="${receipt.receiptNumber}.pdf"`);
        return reply.send(pdfBuffer);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/admin/restaurants/:restaurantId/fiscal-documents
   * Registra una asociación manual de comprobante fiscal. Requiere MANAGER.
   */
  fastify.post<{
    Params: { restaurantId: string };
    Body: {
      docType: 'FACTURA_A' | 'FACTURA_B' | 'FACTURA_C' | 'TICKET_FISCAL' | 'OTRO';
      pointOfSale: number;
      docNumber: string;
      docDate: string;
      emitter: string;
      totalMinor: number;
      notes?: string;
      fileRef?: string;
      coveredSessions: Array<{
        tableSessionId: string;
        coveredMinor: number;
      }>;
    };
  }>(
    '/admin/restaurants/:restaurantId/fiscal-documents',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId } = request.params;
      const body = request.body || ({} as any);
      try {
        const created = await FiscalService.createFiscalAssociation({
          restaurantId,
          docType: body.docType,
          pointOfSale: body.pointOfSale,
          docNumber: body.docNumber,
          docDate: body.docDate,
          emitter: body.emitter,
          totalMinor: body.totalMinor,
          notes: body.notes,
          fileRef: body.fileRef,
          coveredSessions: body.coveredSessions || []
        });
        return reply.status(201).send(created);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * GET /v1/admin/restaurants/:restaurantId/fiscal-documents
   * Lista comprobantes fiscales del restaurante. Requiere MANAGER.
   */
  fastify.get<{
    Params: { restaurantId: string };
  }>(
    '/admin/restaurants/:restaurantId/fiscal-documents',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((req) => (req.params as any).restaurantId)] },
    async (request, reply) => {
      const { restaurantId } = request.params;
      try {
        const docs = await FiscalService.listFiscalDocuments(restaurantId);
        return reply.send({ documents: docs });
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );
};
