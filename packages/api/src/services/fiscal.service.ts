import { prisma } from '../lib/prisma';
import { FiscalDocumentDTO, OrderStatus } from '@mesaya/shared';

export interface CreateFiscalDocInput {
  restaurantId: string;
  docType: 'FACTURA_A' | 'FACTURA_B' | 'FACTURA_C' | 'TICKET_FISCAL' | 'OTRO';
  pointOfSale: number;
  docNumber: string;
  docDate: string;
  emitter: string;
  totalMinor: number;
  notes?: string | null;
  fileRef?: string | null;
  coveredSessions: Array<{
    tableSessionId: string;
    coveredMinor: number;
  }>;
}

export class FiscalService {
  /**
   * Registra una asociación manual de comprobante fiscal externo a sesiones de mesa.
   * Valida que los montos cubiertos no excedan el total del comprobante ni el consumo de la sesión.
  */
  static async createFiscalAssociation(input: CreateFiscalDocInput): Promise<FiscalDocumentDTO> {
    const validDocTypes = new Set(['FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'TICKET_FISCAL', 'OTRO']);
    const docDate = new Date(input.docDate);
    const coverages = Array.isArray(input.coveredSessions) ? input.coveredSessions : [];
    const sessionIds = coverages.map((coverage) => coverage.tableSessionId);
    const hasDuplicateSession = new Set(sessionIds).size !== sessionIds.length;

    if (
      !input.restaurantId ||
      !validDocTypes.has(input.docType) ||
      typeof input.docNumber !== 'string' ||
      !input.docNumber.trim() ||
      !Number.isSafeInteger(input.pointOfSale) ||
      input.pointOfSale <= 0 ||
      !Number.isSafeInteger(input.totalMinor) ||
      input.totalMinor <= 0 ||
      Number.isNaN(docDate.getTime()) ||
      typeof input.emitter !== 'string' ||
      !input.emitter.trim() ||
      coverages.length === 0 ||
      hasDuplicateSession
    ) {
      const err: any = new Error('Datos de comprobante fiscal inválidos');
      err.statusCode = 400;
      err.code = 'INVALID_FISCAL_DOC';
      throw err;
    }

    if (
      coverages.some(
        (coverage) =>
          typeof coverage.tableSessionId !== 'string' ||
          !coverage.tableSessionId ||
          !Number.isSafeInteger(coverage.coveredMinor) ||
          coverage.coveredMinor <= 0
      )
    ) {
      const err: any = new Error('Cada cobertura requiere una sesión y un importe entero positivo');
      err.statusCode = 400;
      err.code = 'INVALID_FISCAL_COVERAGE';
      throw err;
    }

    const coveredSum = coverages.reduce((sum, s) => sum + s.coveredMinor, 0);
    if (!Number.isSafeInteger(coveredSum) || coveredSum > input.totalMinor) {
      const err: any = new Error('La suma de coberturas supera el total del comprobante');
      err.statusCode = 422;
      err.code = 'COVERAGE_EXCEEDS_TOTAL';
      throw err;
    }

    const acceptedStatuses = [
      OrderStatus.CONFIRMED,
      OrderStatus.IN_KITCHEN,
      OrderStatus.READY_TO_SERVE,
      OrderStatus.SERVED,
      OrderStatus.PAID
    ];
    const sessions = await prisma.tableSession.findMany({
      where: {
        id: { in: sessionIds },
        table: { restaurantId: input.restaurantId }
      },
      select: {
        id: true,
        orders: {
          where: { status: { in: acceptedStatuses } },
          select: { totalAmountMinor: true, totalAmount: true }
        }
      }
    });
    if (sessions.length !== sessionIds.length) {
      const err: any = new Error('Una o más sesiones no pertenecen al restaurante');
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    const consumptionBySession = new Map(
      sessions.map((session) => [
        session.id,
        session.orders.reduce(
          (sum, order) => sum + (order.totalAmountMinor ?? Math.round(Number(order.totalAmount || 0) * 100)),
          0
        )
      ])
    );
    const previousCoverages = await prisma.fiscalDocumentCoverage.findMany({
      where: { tableSessionId: { in: sessionIds } },
      select: { tableSessionId: true, coveredMinor: true }
    });
    const previousBySession = new Map<string, number>();
    for (const coverage of previousCoverages) {
      previousBySession.set(
        coverage.tableSessionId,
        (previousBySession.get(coverage.tableSessionId) || 0) + coverage.coveredMinor
      );
    }
    for (const coverage of coverages) {
      const alreadyCovered = previousBySession.get(coverage.tableSessionId) || 0;
      const sessionConsumption = consumptionBySession.get(coverage.tableSessionId) || 0;
      if (alreadyCovered + coverage.coveredMinor > sessionConsumption) {
        const err: any = new Error('La cobertura supera el consumo disponible de la sesión');
        err.statusCode = 422;
        err.code = 'COVERAGE_EXCEEDS_SESSION_CONSUMPTION';
        throw err;
      }
    }

    // Verificar unicidad de comprobante para este restaurante
    const existing = await prisma.fiscalDocumentAssociation.findUnique({
      where: {
        restaurantId_pointOfSale_docNumber_docType: {
          restaurantId: input.restaurantId,
          pointOfSale: input.pointOfSale,
          docNumber: input.docNumber,
          docType: input.docType
        }
      }
    });

    if (existing) {
      const err: any = new Error('Ya existe un comprobante con ese punto de venta, número y tipo');
      err.statusCode = 409;
      err.code = 'FISCAL_DOC_ALREADY_EXISTS';
      throw err;
    }

    const created = await prisma.fiscalDocumentAssociation.create({
      data: {
        restaurantId: input.restaurantId,
        docType: input.docType,
        pointOfSale: input.pointOfSale,
        docNumber: input.docNumber.trim(),
        docDate,
        emitter: input.emitter.trim(),
        totalMinor: input.totalMinor,
        notes: input.notes,
        fileRef: input.fileRef,
        source: 'MANUAL',
        coverages: {
          create: coverages.map((c) => ({
            tableSessionId: c.tableSessionId,
            coveredMinor: c.coveredMinor
          }))
        }
      },
      include: {
        coverages: true
      }
    });

    return {
      id: created.id,
      restaurantId: created.restaurantId,
      docType: created.docType as any,
      pointOfSale: created.pointOfSale,
      docNumber: created.docNumber,
      docDate: created.docDate.toISOString(),
      emitter: created.emitter,
      totalMinor: created.totalMinor,
      notes: created.notes,
      fileRef: created.fileRef,
      source: 'MANUAL',
      coveredSessions: created.coverages.map((c) => ({
        tableSessionId: c.tableSessionId,
        coveredMinor: c.coveredMinor
      })),
      createdAt: created.createdAt.toISOString()
    };
  }

  /**
   * Lista comprobantes fiscales asociados al restaurante.
   */
  static async listFiscalDocuments(restaurantId: string): Promise<FiscalDocumentDTO[]> {
    const docs = await prisma.fiscalDocumentAssociation.findMany({
      where: { restaurantId },
      include: { coverages: true },
      orderBy: { docDate: 'desc' }
    });

    return docs.map((d) => ({
      id: d.id,
      restaurantId: d.restaurantId,
      docType: d.docType as any,
      pointOfSale: d.pointOfSale,
      docNumber: d.docNumber,
      docDate: d.docDate.toISOString(),
      emitter: d.emitter,
      totalMinor: d.totalMinor,
      notes: d.notes,
      fileRef: d.fileRef,
      source: 'MANUAL',
      coveredSessions: d.coverages.map((c) => ({
        tableSessionId: c.tableSessionId,
        coveredMinor: c.coveredMinor
      })),
      createdAt: d.createdAt.toISOString()
    }));
  }
}
