export { csvCell } from "../../shared/utils/csv.util.js";
import { csvCell } from "../../shared/utils/csv.util.js";

const SELECTED_ORDER_COLUMNS = [
  ["Order ID", (order) => order.id],
  ["Customer", (order) => order.user?.name],
  ["Email", (order) => order.user?.email],
  ["Payment", (order) => order.payment?.method],
  ["Payment status", (order) => order.payment?.status],
  ["Status", (order) => order.status],
  ["Items", (order) => order.itemsCount],
  ["Total", (order) => order.total],
  ["Created at", (order) => order.createdAt?.toISOString()],
];

export const selectedOrdersCsvHeader = `\uFEFF${SELECTED_ORDER_COLUMNS.map(([label]) => csvCell(label)).join(",")}\r\n`;

export const selectedOrderCsvRow = (order) =>
  `${SELECTED_ORDER_COLUMNS.map(([, read]) => csvCell(read(order))).join(",")}\r\n`;
