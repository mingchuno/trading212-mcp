import { z } from "zod";

export const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const orderIdSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const baseOrder = {
  ticker: tickerSchema,
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive().finite(),
};
const timeValidity = z.enum(["DAY", "GOOD_TILL_CANCEL"]);
const price = z.number().positive().finite();
export const orderSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...baseOrder,
    type: z.literal("market"),
    extendedHours: z.boolean().optional(),
  }),
  z.strictObject({
    ...baseOrder,
    type: z.literal("limit"),
    limitPrice: price,
    timeValidity,
  }),
  z.strictObject({
    ...baseOrder,
    type: z.literal("stop"),
    stopPrice: price,
    timeValidity,
  }),
  z.strictObject({
    ...baseOrder,
    type: z.literal("stop_limit"),
    stopPrice: price,
    limitPrice: price,
    timeValidity,
  }),
]);
export type OrderInput = z.infer<typeof orderSchema>;
export const reportSchema = z
  .strictObject({
    timeFrom: z.iso.datetime({ offset: true }),
    timeTo: z.iso.datetime({ offset: true }),
    dataIncluded: z.strictObject({
      includeDividends: z.boolean(),
      includeInterest: z.boolean(),
      includeOrders: z.boolean(),
      includeTransactions: z.boolean(),
    }),
  })
  .refine(
    (value) => Date.parse(value.timeFrom) < Date.parse(value.timeTo),
    "timeFrom must precede timeTo",
  )
  .refine(
    (value) => Object.values(value.dataIncluded).some(Boolean),
    "Select at least one report category",
  );
export type ReportInput = z.infer<typeof reportSchema>;
export const historyKindSchema = z.enum([
  "orders",
  "dividends",
  "transactions",
]);
export type HistoryKind = z.infer<typeof historyKindSchema>;
export const historyPageSchema = z.strictObject({
  limit: z.number().int().min(1).max(50).optional(),
  ticker: tickerSchema.optional(),
  nextPagePath: z.string().min(1).max(4096).optional(),
});
export type HistoryPageOptions = z.infer<typeof historyPageSchema>;
export type RequestOptions = { signal?: AbortSignal };
