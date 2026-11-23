import type { LocaleCode, TicketLabels } from "./ticket-document";

/** Ticket wording, same as the frontend's printerCopy.ticket. */
export const TICKET_LABELS: Record<LocaleCode, TicketLabels> = {
  en: {
    ticket: "Kitchen ticket",
    table: "Table {number}",
    pickup: "Pickup {number}",
    takeaway: "Takeaway",
    dineIn: "Dine in",
    orderNote: "Order note",
    note: "Note",
    flags: { ADDITION: "Added items", LATE: "Late", REPRINT: "Reprint", CANCELLED: "Cancelled" },
  },
  ar: {
    ticket: "تذكرة المطبخ",
    table: "طاولة {number}",
    pickup: "استلام {number}",
    takeaway: "تيك أواي",
    dineIn: "في المطعم",
    orderNote: "ملاحظة الطلب",
    note: "ملاحظة",
    flags: { ADDITION: "أصناف مضافة", LATE: "متأخر", REPRINT: "إعادة طباعة", CANCELLED: "ملغي" },
  },
};
