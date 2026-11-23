/** Matches the API's KitchenTicket. Never carries prices. */
export type KitchenTicket = {
  order_id: string;
  order_type: string;
  fulfillment_type?: string | null;
  pickup_number?: number | null;
  table_number?: string | null;
  customer_name?: string | null;
  notes?: string | null;
  placed_at: string;
  lines: { quantity: number; name: string; modifiers?: string[]; note?: string | null; station: string }[];
  flags?: string[];
};
