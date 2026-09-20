#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const isFix = process.argv.includes('--fix');
const prisma = new PrismaClient();

async function main() {
  console.log(`▶ Iniciando auditoría monetaria de órdenes (${isFix ? 'MODO FIX' : 'MODO AUDIT READ-ONLY'})...`);

  let orders = [];
  try {
    orders = await prisma.order.findMany({
      include: {
        items: true
      }
    });
  } catch (err) {
    if (err?.code === 'P2022' || err?.message?.includes('does not exist')) {
      console.warn('⚠️ La base de datos actual no tiene las columnas migradas (schema histórico detectado).');
      const result = {
        auditedAt: new Date().toISOString(),
        totalOrdersAudited: 0,
        discrepanciesCount: 0,
        fixedCount: 0,
        status: 'LEGACY_SCHEMA_DETECTED',
        note: 'La base actual no tiene totalAmountMinor; requiere migración o base efímera canónica.',
        discrepancies: []
      };
      const outputPath = path.resolve(process.cwd(), 'docs', 'produccion', 'DATA-AUDIT.json');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
      console.log(`📄 Estado guardado en: ${outputPath}`);
      return;
    }
    throw err;
  }

  const discrepancies = [];
  let fixedCount = 0;

  for (const order of orders) {
    let computedItemsMinor = 0;
    for (const item of order.items) {
      const unitMinor = item.unitPriceMinor ?? Math.round(Number(item.unitPrice || 0) * 100);
      computedItemsMinor += item.quantity * unitMinor;
    }

    const currentHeaderMinor = order.totalAmountMinor ?? Math.round(Number(order.totalAmount || 0) * 100);

    if (order.items.length > 0 && currentHeaderMinor !== computedItemsMinor) {
      discrepancies.push({
        orderId: order.id,
        status: order.status,
        currentHeaderMinor,
        computedItemsMinor,
        deltaMinor: computedItemsMinor - currentHeaderMinor
      });

      if (isFix) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            totalAmountMinor: computedItemsMinor,
            totalAmount: computedItemsMinor / 100
          }
        });
        fixedCount++;
      }
    }
  }

  const result = {
    auditedAt: new Date().toISOString(),
    totalOrdersAudited: orders.length,
    discrepanciesCount: discrepancies.length,
    fixedCount,
    mode: isFix ? 'FIX' : 'AUDIT',
    discrepancies
  };

  const outputPath = path.resolve(process.cwd(), 'docs', 'produccion', 'DATA-AUDIT.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`✅ Auditoría completada: ${orders.length} órdenes auditadas, ${discrepancies.length} discrepancias encontradas.`);
  if (isFix) {
    console.log(`🔧 ${fixedCount} órdenes reparadas.`);
  }
  console.log(`📄 Resultados guardados en: ${outputPath}`);
}

main()
  .catch((err) => {
    console.error('Error en auditoría monetaria:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
