/**
 * Kitchen ticket layout, copied from the Qwicoo frontend (frontend-qwicoo
 * src/features/staff/kitchen-printer/ticket-document.ts) so bridge tickets look exactly like web
 * tickets. Keep the two in step; test/ticket-document.test.ts mirrors the frontend's tests.
 */
export type LocaleCode = "en" | "ar";

/** Africa/Cairo time with Western digits, like the frontend's formatCairoDateTime. */
export function formatCairoDateTime(value: string, locale: LocaleCode): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo",
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: "latn",
  }).format(date);
}

import type { KitchenTicket } from "./ticket";

export type { KitchenTicket };

export type TicketFlag = "ADDITION" | "LATE" | "REPRINT" | "CANCELLED";

export type TicketLabels = {
  ticket: string;
  table: string;
  pickup: string;
  takeaway: string;
  dineIn: string;
  orderNote: string;
  note: string;
  flags: Record<TicketFlag, string>;
};

/** Printable width inside the paper's margins: 80mm rolls print about 72mm, 58mm rolls about 50mm. */
const SHEET_WIDTH: Record<58 | 80, string> = { 80: "72mm", 58: "50mm" };

function css(width: 58 | 80): string {
  return `
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.ticket {
  box-sizing: border-box;
  width: ${SHEET_WIDTH[width]};
  max-width: ${SHEET_WIDTH[width]};
  margin: 0 auto;
  padding: 3mm 2mm 6mm;
  color: #000;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: ${width === 58 ? 13 : 15}px;
  line-height: 1.3;
}
.ticket[dir="rtl"] { font-family: "IBM Plex Sans Arabic", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif; }
.ticket .ltr { unicode-bidi: isolate; direction: ltr; }
.ticket .place { font-size: 1.9em; font-weight: 800; margin: 0; }
.ticket .meta { display: flex; justify-content: space-between; gap: 8px; font-size: 0.85em; }
.ticket .banner { border: 2px solid #000; text-align: center; font-weight: 800; padding: 1mm; margin: 2mm 0; text-transform: uppercase; }
.ticket .banner.cancel { background: #000; color: #fff; font-size: 1.3em; }
.ticket .rule { border-top: 1px dashed #000; margin: 2mm 0; }
.ticket .station { font-weight: 700; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; margin: 2mm 0 1mm; }
.ticket .line { display: flex; gap: 2mm; align-items: baseline; }
.ticket .qty { font-weight: 800; font-size: 1.25em; min-width: 2.2em; }
.ticket .name { font-weight: 700; font-size: 1.15em; }
.ticket .mods, .ticket .note { margin-inline-start: 2.6em; font-size: 0.95em; }
.ticket .note, .ticket .order-note { font-style: italic; }
.ticket .order-note { border: 1px solid #000; padding: 1mm; margin-top: 2mm; }
`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function fillNumber(template: string, value: string | number): string {
  return template.replace("{number}", String(value));
}

const FLAG_ORDER: readonly TicketFlag[] = ["CANCELLED", "REPRINT", "ADDITION", "LATE"];

function isFlag(value: string): value is TicketFlag {
  return (FLAG_ORDER as readonly string[]).includes(value);
}

/** A kitchen ticket as a full HTML document for silent iframe printing on a thermal printer. */
export function kitchenTicketHtml(ticket: KitchenTicket, locale: LocaleCode, labels: TicketLabels, width: 58 | 80): string {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const takeaway = ticket.order_type !== "DINE_IN";
  const place =
    ticket.pickup_number != null
      ? fillNumber(labels.pickup, ticket.pickup_number)
      : ticket.table_number
        ? fillNumber(labels.table, ticket.table_number)
        : takeaway
          ? labels.takeaway
          : labels.dineIn;
  const flags = (ticket.flags ?? []).filter(isFlag).sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b));
  const cancelled = flags.includes("CANCELLED");
  const banner = flags.length
    ? `<div class="banner${cancelled ? " cancel" : ""}">${escapeHtml(flags.map((flag) => labels.flags[flag]).join(" · "))}</div>`
    : "";

  const stations: { name: string; lines: KitchenTicket["lines"] }[] = [];
  for (const line of ticket.lines) {
    const group = stations.find((entry) => entry.name === line.station);
    if (group) group.lines.push(line);
    else stations.push({ name: line.station, lines: [line] });
  }
  const body = stations
    .map(
      (group) => `
    <div class="station">${escapeHtml(group.name)}</div>
    ${group.lines
      .map((line) => {
        const mods = (line.modifiers ?? []).filter((m) => m.trim());
        const note = line.note?.trim();
        return `<div class="line"><span class="qty ltr">${line.quantity}×</span><span class="name">${escapeHtml(line.name)}</span></div>
    ${mods.length ? `<div class="mods">${mods.map(escapeHtml).join(" · ")}</div>` : ""}
    ${note ? `<div class="note">${escapeHtml(labels.note)}: ${escapeHtml(note)}</div>` : ""}`;
      })
      .join("")}`,
    )
    .join("");
  const orderNote = ticket.notes?.trim();
  const shortRef = ticket.order_id.slice(0, 8).toUpperCase();

  return `<!DOCTYPE html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"/><title>${escapeHtml(labels.ticket)}</title><style>${css(width)}</style></head><body>
  <div class="ticket" dir="${dir}">
    ${banner}
    <p class="place">${escapeHtml(place)}</p>
    <div class="meta"><span>${escapeHtml(takeaway ? labels.takeaway : labels.dineIn)}${ticket.customer_name ? ` · ${escapeHtml(ticket.customer_name)}` : ""}</span><span class="date" dir="${dir}">${escapeHtml(formatCairoDateTime(ticket.placed_at, locale))}</span></div>
    <div class="meta"><span class="ltr">#${escapeHtml(shortRef)}</span></div>
    <div class="rule"></div>
    ${body}
    ${orderNote ? `<div class="order-note">${escapeHtml(labels.orderNote)}: ${escapeHtml(orderNote)}</div>` : ""}
    ${banner && cancelled ? banner : ""}
  </div>
  </body></html>`;
}
