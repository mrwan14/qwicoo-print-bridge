import { expect, test } from "vitest";

import { kitchenTicketHtml, type KitchenTicket, type TicketLabels } from "../src/core/ticket-document";

const labels: TicketLabels = {
  ticket: "Kitchen ticket",
  table: "Table {number}",
  pickup: "Pickup {number}",
  takeaway: "Takeaway",
  dineIn: "Dine in",
  orderNote: "Order note",
  note: "Note",
  flags: { ADDITION: "Added items", LATE: "Late", REPRINT: "Reprint", CANCELLED: "Cancelled" },
};

function ticket(overrides: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    order_id: "11111111-2222-3333-4444-555555555555",
    order_type: "DINE_IN",
    fulfillment_type: null,
    pickup_number: null,
    table_number: "12",
    customer_name: null,
    notes: null,
    placed_at: "2026-11-23T10:05:00+00:00",
    lines: [
      { quantity: 2, name: "Burger", modifiers: ["No onion", "Extra cheese"], note: "well done", station: "Grill" },
      { quantity: 1, name: "Lemonade", modifiers: [], note: null, station: "Bar" },
    ],
    flags: [],
    ...overrides,
  };
}

test("shows table, items, quantities, modifiers, notes and stations", () => {
  const html = kitchenTicketHtml(ticket({ notes: "Allergy: nuts" }), "en", labels, 80);
  expect(html).toMatch(/Table 12/);
  expect(html).toMatch(/2×/);
  expect(html).toMatch(/Burger/);
  expect(html).toMatch(/No onion/);
  expect(html).toMatch(/Extra cheese/);
  expect(html).toMatch(/well done/);
  expect(html).toMatch(/Grill/);
  expect(html).toMatch(/Bar/);
  expect(html).toMatch(/Allergy: nuts/);
});

test("never prints money", () => {
  const html = kitchenTicketHtml(ticket(), "en", labels, 80);
  expect(html).not.toMatch(/EGP|total|price|subtotal/i);
});

test("leaves out empty notes and modifier lines", () => {
  const html = kitchenTicketHtml(ticket({ lines: [{ quantity: 1, name: "Tea", modifiers: [], note: null, station: "Bar" }] }), "en", labels, 80);
  expect(html).not.toMatch(/Note/);
  expect(html).not.toMatch(/Order note/);
  expect(html).not.toMatch(/class="mods"/);
});

test("takeaway shows the pickup number instead of a table", () => {
  const html = kitchenTicketHtml(ticket({ order_type: "TAKEAWAY", table_number: null, pickup_number: 214 }), "en", labels, 80);
  expect(html).toMatch(/Pickup 214/);
  expect(html).toMatch(/Takeaway/);
  expect(html).not.toMatch(/Table/);
});

test("flags print as a banner in order", () => {
  const html = kitchenTicketHtml(ticket({ flags: ["ADDITION", "LATE"] }), "en", labels, 80);
  expect(html).toMatch(/Added items · Late/);
  const reprint = kitchenTicketHtml(ticket({ flags: ["REPRINT"] }), "en", labels, 80);
  expect(reprint).toMatch(/Reprint/);
  const cancelled = kitchenTicketHtml(ticket({ flags: ["CANCELLED"] }), "en", labels, 80);
  expect(cancelled).toMatch(/class="banner cancel"/);
});

test("paper width sets the sheet width", () => {
  expect(kitchenTicketHtml(ticket(), "en", labels, 80)).toMatch(/width: 72mm/);
  expect(kitchenTicketHtml(ticket(), "en", labels, 58)).toMatch(/width: 50mm/);
});

test("Arabic tickets are right to left", () => {
  const html = kitchenTicketHtml(ticket({ lines: [{ quantity: 1, name: "برجر", modifiers: [], note: null, station: "الشواية" }] }), "ar", labels, 80);
  expect(html).toMatch(/dir="rtl"/);
  expect(html).toMatch(/برجر/);
});

test("escapes text from guests and staff", () => {
  const html = kitchenTicketHtml(ticket({ notes: "<script>alert(1)</script>" }), "en", labels, 80);
  expect(html).not.toMatch(/<script>/);
  expect(html).toMatch(/&lt;script&gt;/);
});

test("groups lines by station with a station heading once", () => {
  const html = kitchenTicketHtml(
    ticket({
      lines: [
        { quantity: 1, name: "Burger", modifiers: [], note: null, station: "Grill" },
        { quantity: 1, name: "Steak", modifiers: [], note: null, station: "Grill" },
        { quantity: 1, name: "Cola", modifiers: [], note: null, station: "Bar" },
      ],
    }),
    "en",
    labels,
    80,
  );
  expect(html.match(/class="station"/g)?.length).toBe(2);
});

test("an Arabic date keeps right-to-left order (it contains Arabic letters)", () => {
  const html = kitchenTicketHtml(ticket(), "ar", labels, 80);
  expect(html).toMatch(/<span class="date" dir="rtl">/);
  expect(kitchenTicketHtml(ticket(), "en", labels, 80)).toMatch(/<span class="date" dir="ltr">/);
});
