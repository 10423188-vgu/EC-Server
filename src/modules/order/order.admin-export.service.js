import { ConflictError } from "../../shared/errors/app.error.js";
import { orderPrismaRepository } from "./order.prisma.repository.js";
import {
  csvCell,
  selectedOrdersCsvHeader,
  selectedOrderCsvRow,
} from "./order.csv.js";

const ORDER_EXPORT_BATCH_SIZE = 500;
const ORDER_EXPORT_COLUMNS = [
  "Order ID",
  "Created at (UTC)",
  "Status",
  "Customer name",
  "Customer email",
  "Payment method",
  "Payment status",
  "Item count",
  "Subtotal",
  "Shipping fee",
  "Discount",
  "Total",
  "Refunded amount",
  "Shipping carrier",
  "Tracking number",
  "Tracking URL",
];

export const orderAdminExportService = {
  adminExportSelectedCsv: async function* (ids) {
    yield selectedOrdersCsvHeader;
    // why: sequential bounded batches preserve selection order and backpressure;
    // neither server nor browser needs an array containing every selected order.
    for (
      let offset = 0;
      offset < ids.length;
      offset += ORDER_EXPORT_BATCH_SIZE
    ) {
      const batch = ids.slice(offset, offset + ORDER_EXPORT_BATCH_SIZE);
      const orders = await orderPrismaRepository.findSelected(batch, {
        forExport: true,
      });
      if (orders.length !== batch.length)
        throw new ConflictError(
          "Some selected orders are unavailable. Refresh the list.",
        );
      for (const order of orders) yield selectedOrderCsvRow(order);
    }
  },

  adminExportCsv: async function* (filters) {
    yield `\uFEFF${ORDER_EXPORT_COLUMNS.map(csvCell).join(",")}\r\n`;
    let cursorId;

    while (true) {
      const orders = await orderPrismaRepository.findAdminExportBatch(
        filters,
        cursorId,
        ORDER_EXPORT_BATCH_SIZE,
      );
      for (const order of orders) {
        yield [
          order.id,
          order.createdAt.toISOString(),
          order.status,
          order.user.name,
          order.user.email,
          order.payment?.method,
          order.payment?.status,
          order._count.items,
          order.subtotal,
          order.shippingFee,
          order.discountAmount,
          order.total,
          order.payment?.refundedAmount,
          order.shippingCarrier,
          order.trackingNumber,
          order.trackingUrl,
        ]
          .map(csvCell)
          .join(",") + "\r\n";
      }

      if (orders.length < ORDER_EXPORT_BATCH_SIZE) break;
      cursorId = orders.at(-1).id;
    }
  },
};
