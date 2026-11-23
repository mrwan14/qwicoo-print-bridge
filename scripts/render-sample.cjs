// Dev check: `npx electron scripts/render-sample.cjs` writes sample ticket PNGs and the ESC/POS
// bytes' monochrome preview to ./samples, to eyeball Arabic and layout without a printer.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const { ticketPreviewPng, ticketToBytes } = require("../dist/main/render.js");
  const out = path.join(__dirname, "..", "samples");
  fs.mkdirSync(out, { recursive: true });
  const ticket = (locale) => ({
    order_id: "4b1c2d3e-0000-4000-8000-000000000001",
    order_type: "DINE_IN",
    table_number: "12",
    placed_at: new Date().toISOString(),
    notes: locale === "ar" ? "حساسية من المكسرات" : "Allergy: nuts",
    flags: ["ADDITION"],
    lines:
      locale === "ar"
        ? [
            { quantity: 2, name: "برجر لحم", modifiers: ["بدون بصل", "جبنة إضافية"], note: "مستوي جيدًا", station: "الشواية" },
            { quantity: 1, name: "ليمون بالنعناع", modifiers: [], note: null, station: "المشروبات" },
          ]
        : [
            { quantity: 2, name: "Beef burger", modifiers: ["No onion", "Extra cheese"], note: "well done", station: "Grill" },
            { quantity: 1, name: "Mint lemonade", modifiers: [], note: null, station: "Bar" },
          ],
  });
  for (const locale of ["en", "ar"]) {
    for (const width of [80, 58]) {
      fs.writeFileSync(path.join(out, `ticket-${locale}-${width}.png`), await ticketPreviewPng(ticket(locale), locale, width));
      const bytes = await ticketToBytes(ticket(locale), locale, width);
      fs.writeFileSync(path.join(out, `ticket-${locale}-${width}.bin`), Buffer.from(bytes));
    }
  }
  console.log("samples written to", out);
  app.quit();
});
