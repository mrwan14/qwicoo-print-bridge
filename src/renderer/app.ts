// Qwicoo Print window. Plain script (no bundler): talks to the app only through window.qwicoo.

type PrinterConfig = { type: "network"; host: string; port: number } | { type: "usb"; name: string };
type LoopState = { phase: string; printerStatus: string; printedCount: number; waiting: number; lastPrinted: { orderId: string; at: number } | null; lastError: string | null };
type AppState = { paired: boolean; branchName: string | null; printer: PrinterConfig | null; printerLabel: string | null; locale: "en" | "ar"; version: string; loop: LoopState | null };

interface QwicooBridge {
  state(): Promise<AppState>;
  pair(code: string, name: string): Promise<void>;
  usbPrinters(): Promise<string[]>;
  checkPrinter(printer: PrinterConfig): Promise<string>;
  setPrinter(printer: PrinterConfig): Promise<void>;
  testPrint(printer?: PrinterConfig): Promise<void>;
  takeOver(): Promise<void>;
  forgetPairing(): Promise<void>;
  copyDiagnostics(): Promise<void>;
  setLocale(locale: string): Promise<void>;
  onState(listener: (state: AppState) => void): void;
}

const bridge = (window as unknown as { qwicoo: QwicooBridge }).qwicoo;

const TEXT = {
  en: {
    lang: "العربية",
    step: "Step {n} of 2",
    pairTitle: "Connect to your restaurant",
    pairBody: "In Qwicoo, a branch admin opens Settings → Branch → Service → Kitchen & printing → Paired printers → Pair a device, and reads you the code.",
    code: "Pairing code",
    name: "Name for this PC",
    nameDefault: "Kitchen PC",
    pair: "Connect",
    pairing: "Connecting…",
    pairFailed: "That code didn't work. Codes work once and expire after 10 minutes. Ask for a new one.",
    netFailed: "Can't reach Qwicoo. Check this PC's internet and try again.",
    printerTitle: "Choose the kitchen printer",
    network: "Network printer",
    usb: "USB printer",
    ip: "Printer IP address",
    ipHint: "Print the printer's self-test page (hold FEED while switching it on) to see its IP address.",
    port: "Port",
    usbPick: "Printer",
    usbNone: "No printers found. Add the printer in your computer's printer settings first.",
    check: "Check printer",
    checking: "Checking…",
    found: "Printer found: {status}",
    notFound: "Printer not found at {where}.",
    testPrint: "Test print",
    printing: "Printing…",
    printed: "Test ticket sent. Did it come out?",
    printFailed: "The printer didn't take the test ticket: {error}",
    save: "Use this printer",
    connected: "Connected to {branch}",
    statusTitle: "Kitchen printer",
    phase: {
      running: "Printing new orders",
      starting: "Starting…",
      blocked: "Another device is printing for this branch",
      lost: "Another device took over printing",
      off: "This branch uses the kitchen screen",
      offline: "Can't reach Qwicoo",
      "printer-error": "Can't reach the printer",
      unpaired: "This PC was unpaired",
    } as Record<string, string>,
    hint: {
      running: "Leave this PC on. Tickets print as soon as orders reach the kitchen. You can close this window: printing continues in the tray.",
      blocked: "Only one device prints per branch, so tickets never print twice.",
      lost: "Tickets now print on the other device.",
      off: "A branch admin can switch to a printer in Kitchen & printing.",
      offline: "Check the internet. Missed tickets print, marked LATE, when it's back.",
      "printer-error": "Check the printer is on, connected and has paper. Tickets wait and print when it's back.",
      unpaired: "A branch admin removed this PC. Connect again with a new code to keep printing here.",
    } as Record<string, string>,
    statusHint: {
      PAPER_OUT: "Put a new paper roll in the printer. Waiting tickets print as soon as it's back.",
      COVER_OPEN: "Close the printer cover. Waiting tickets print as soon as it's closed.",
      OFFLINE: "Check the printer is switched on and its cable is connected. Waiting tickets print when it's back.",
    } as Record<string, string>,
    printerStatus: { READY: "Ready", PAPER_LOW: "Paper low", PAPER_OUT: "Out of paper", COVER_OPEN: "Cover open", OFFLINE: "Offline", UNKNOWN: "Can't report status" } as Record<string, string>,
    printer: "Printer",
    printerState: "Printer status",
    printedCount: "Printed since start",
    waiting: "Waiting",
    last: "Last ticket",
    takeOver: "Print from this PC",
    reconnect: "Connect again",
    changePrinter: "Change printer",
    diagnostics: "Copy diagnostics",
    copied: "Copied. Paste it in a message to Qwicoo support.",
    forget: "Disconnect this PC",
    forgetConfirm: "Disconnect this PC? It will stop printing until it's connected again with a new code.",
    version: "Version {v}",
  },
  ar: {
    lang: "English",
    step: "الخطوة {n} من 2",
    pairTitle: "اربط البرنامج بمطعمك",
    pairBody: "في كويكو، يفتح مدير الفرع الإعدادات ← الفرع ← الخدمة ← المطبخ والطباعة ← الطابعات المرتبطة ← اربط جهازًا، ويعطيك الرمز.",
    code: "رمز الربط",
    name: "اسم هذا الكمبيوتر",
    nameDefault: "كمبيوتر المطبخ",
    pair: "اربط",
    pairing: "جارٍ الربط…",
    pairFailed: "هذا الرمز لم ينجح. الرمز يعمل مرة واحدة وينتهي بعد 10 دقائق. اطلب رمزًا جديدًا.",
    netFailed: "تعذّر الاتصال بكويكو. تحقق من الإنترنت وحاول مجددًا.",
    printerTitle: "اختر طابعة المطبخ",
    network: "طابعة شبكة",
    usb: "طابعة USB",
    ip: "عنوان IP للطابعة",
    ipHint: "اطبع صفحة الاختبار الذاتي للطابعة (اضغط FEED أثناء تشغيلها) لمعرفة عنوان IP.",
    port: "المنفذ",
    usbPick: "الطابعة",
    usbNone: "لم يتم العثور على طابعات. أضف الطابعة من إعدادات الطابعات في الكمبيوتر أولًا.",
    check: "افحص الطابعة",
    checking: "جارٍ الفحص…",
    found: "تم العثور على الطابعة: {status}",
    notFound: "لم يتم العثور على طابعة على {where}.",
    testPrint: "طباعة تجريبية",
    printing: "جارٍ الطباعة…",
    printed: "أُرسلت التذكرة التجريبية. هل خرجت؟",
    printFailed: "لم تستقبل الطابعة التذكرة التجريبية: {error}",
    save: "استخدم هذه الطابعة",
    connected: "مرتبط بفرع {branch}",
    statusTitle: "طابعة المطبخ",
    phase: {
      running: "تُطبع الطلبات الجديدة",
      starting: "جارٍ التشغيل…",
      blocked: "جهاز آخر يطبع لهذا الفرع",
      lost: "تولّى جهاز آخر الطباعة",
      off: "هذا الفرع يستخدم شاشة المطبخ",
      offline: "تعذّر الاتصال بكويكو",
      "printer-error": "تعذّر الوصول إلى الطابعة",
      unpaired: "تم فصل هذا الكمبيوتر",
    } as Record<string, string>,
    hint: {
      running: "اترك الكمبيوتر يعمل. تُطبع التذاكر فور وصول الطلبات. يمكنك إغلاق هذه النافذة: الطباعة تستمر في شريط المهام.",
      blocked: "جهاز واحد فقط يطبع لكل فرع حتى لا تُطبع التذكرة مرتين.",
      lost: "التذاكر تُطبع الآن على الجهاز الآخر.",
      off: "يمكن لمدير الفرع التحويل إلى الطابعة من إعدادات المطبخ والطباعة.",
      offline: "تحقق من الإنترنت. تُطبع التذاكر الفائتة بعلامة «متأخر» عند عودته.",
      "printer-error": "تأكد أن الطابعة تعمل ومتصلة وبها ورق. التذاكر تنتظر وتُطبع عند عودتها.",
      unpaired: "أزال مدير الفرع هذا الكمبيوتر. اربطه من جديد برمز جديد لمواصلة الطباعة.",
    } as Record<string, string>,
    statusHint: {
      PAPER_OUT: "ضع رول ورق جديد في الطابعة. تُطبع التذاكر المنتظرة فور عودتها.",
      COVER_OPEN: "أغلق غطاء الطابعة. تُطبع التذاكر المنتظرة فور إغلاقه.",
      OFFLINE: "تأكد أن الطابعة تعمل وأن الكابل متصل. تُطبع التذاكر المنتظرة عند عودتها.",
    } as Record<string, string>,
    printerStatus: { READY: "جاهزة", PAPER_LOW: "الورق قارب على النفاد", PAPER_OUT: "نفد الورق", COVER_OPEN: "الغطاء مفتوح", OFFLINE: "غير متصلة", UNKNOWN: "لا تُبلغ عن حالتها" } as Record<string, string>,
    printer: "الطابعة",
    printerState: "حالة الطابعة",
    printedCount: "طُبع منذ التشغيل",
    waiting: "في الانتظار",
    last: "آخر تذكرة",
    takeOver: "اطبع من هذا الكمبيوتر",
    reconnect: "اربط من جديد",
    changePrinter: "غيّر الطابعة",
    diagnostics: "انسخ معلومات الدعم",
    copied: "تم النسخ. الصقها في رسالة لدعم كويكو.",
    forget: "افصل هذا الكمبيوتر",
    forgetConfirm: "فصل هذا الكمبيوتر؟ سيتوقف عن الطباعة حتى يُربط من جديد برمز جديد.",
    version: "الإصدار {v}",
  },
};

type Copy = (typeof TEXT)["en"];
let state: AppState | null = null;
let editingPrinter = false;
let draft: { type: "network" | "usb"; host: string; port: number; name: string } = { type: "network", host: "", port: 9100, name: "" };
let usbList: string[] = [];
let message: { text: string; kind: "ok" | "error" } | null = null;
let busy = false;
let pairDraft = { code: "", name: "" };

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
const t = (): Copy => TEXT[state?.locale ?? "ar"] as Copy;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

function button(label: string, onClick: () => void, cls = "btn", disabled = false): HTMLButtonElement {
  const b = el("button", { type: "button", class: cls, text: label });
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

async function run(action: () => Promise<void>): Promise<void> {
  busy = true;
  render();
  try {
    await action();
  } finally {
    busy = false;
    render();
  }
}

function currentPrinter(): PrinterConfig {
  return draft.type === "network" ? { type: "network", host: draft.host.trim(), port: draft.port || 9100 } : { type: "usb", name: draft.name };
}

function pairView(): HTMLElement {
  const c = t();
  const code = el("input", { class: "code", maxlength: "9", placeholder: "ABCD-EFGH", autocomplete: "off", spellcheck: "false", "aria-label": c.code, value: pairDraft.code });
  const name = el("input", { maxlength: "80", value: pairDraft.name || c.nameDefault, "aria-label": c.name });
  code.addEventListener("input", () => (pairDraft.code = code.value));
  name.addEventListener("input", () => (pairDraft.name = name.value));
  const submit = button(busy ? c.pairing : c.pair, () => void run(async () => {
    message = null;
    try {
      await bridge.pair(code.value, name.value);
    } catch (error) {
      message = { text: /PAIRING_CODE_INVALID|HTTP_4/.test(errorText(error)) ? c.pairFailed : c.netFailed, kind: "error" };
    }
  }), "btn", busy);
  return el("section", { class: "card" },
    el("p", { class: "steps", text: fill(c.step, { n: 1 }) }),
    el("h1", { text: c.pairTitle }),
    el("p", { class: "muted", text: c.pairBody }),
    el("label", {}, c.code, code),
    el("label", {}, c.name, name),
    message ? el("p", { class: message.kind === "error" ? "error" : "muted", role: "alert", text: message.text }) : null,
    el("div", { class: "row" }, submit),
  );
}

function printerView(): HTMLElement {
  const c = t();
  const seg = el("div", { class: "seg", role: "radiogroup", "aria-label": c.printerTitle });
  for (const kind of ["network", "usb"] as const) {
    const b = button(kind === "network" ? c.network : c.usb, async () => {
      draft.type = kind;
      message = null;
      if (kind === "usb") {
        usbList = await bridge.usbPrinters().catch(() => []);
        if (!draft.name && usbList[0]) draft.name = usbList[0];
      }
      render();
    }, "");
    b.setAttribute("aria-pressed", String(draft.type === kind));
    seg.append(b);
  }
  const fields = el("div", { class: "card", style: "padding:0;border:0;gap:14px" });
  if (draft.type === "network") {
    const host = el("input", { class: "ltr", inputmode: "decimal", placeholder: "192.168.1.50", value: draft.host, "aria-label": c.ip });
    host.addEventListener("input", () => (draft.host = host.value));
    const port = el("input", { class: "ltr", inputmode: "numeric", value: String(draft.port), "aria-label": c.port, style: "max-width:120px" });
    port.addEventListener("input", () => (draft.port = Number(port.value) || 9100));
    fields.append(el("label", {}, c.ip, host), el("p", { class: "muted", text: c.ipHint }), el("label", {}, c.port, port));
  } else if (usbList.length === 0) {
    fields.append(el("p", { class: "muted", text: c.usbNone }));
  } else {
    const select = el("select", { "aria-label": c.usbPick });
    for (const name of usbList) {
      const option = el("option", { value: name, text: name });
      if (name === draft.name) option.selected = true;
      select.append(option);
    }
    select.addEventListener("change", () => (draft.name = select.value));
    fields.append(el("label", {}, c.usbPick, select));
  }
  const where = () => (draft.type === "network" ? `${draft.host}:${draft.port}` : draft.name);
  const isReady = () => (draft.type === "network" ? /^[A-Za-z0-9.-]+$/.test(draft.host.trim()) : Boolean(draft.name));
  const ready = isReady();
  const actions = el("div", { class: "row" },
    button(busy ? c.checking : c.check, () => void run(async () => {
      try {
        const status = await bridge.checkPrinter(currentPrinter());
        message = status === "OFFLINE" ? { text: fill(c.notFound, { where: where() }), kind: "error" } : { text: fill(c.found, { status: c.printerStatus[status] ?? status }), kind: "ok" };
      } catch (error) {
        message = { text: errorText(error), kind: "error" };
      }
    }), "btn secondary", busy || !ready),
    button(busy ? c.printing : c.testPrint, () => void run(async () => {
      try {
        await bridge.testPrint(currentPrinter());
        message = { text: c.printed, kind: "ok" };
      } catch (error) {
        message = { text: fill(c.printFailed, { error: errorText(error) }), kind: "error" };
      }
    }), "btn secondary", busy || !ready),
  );
  const saveButton = button(c.save, () => void run(async () => {
      await bridge.setPrinter(currentPrinter());
      editingPrinter = false;
      message = null;
    }), "btn", busy || !ready);
  const gated = [...actions.querySelectorAll("button"), saveButton];
  const refresh = () => gated.forEach((b) => (b.disabled = busy || !isReady()));
  fields.addEventListener("input", refresh);
  fields.addEventListener("change", refresh);
  return el("section", { class: "card" },
    el("p", { class: "steps", text: fill(c.step, { n: 2 }) }),
    el("h1", { text: c.printerTitle }),
    state?.branchName ? el("p", { class: "muted", text: fill(c.connected, { branch: state.branchName }) }) : null,
    seg,
    fields,
    actions,
    message ? el("p", { class: message.kind === "error" ? "error" : "muted", role: "alert", text: message.text }) : null,
    el("div", { class: "row" }, saveButton),
  );
}

function statusView(s: AppState): HTMLElement {
  const c = t();
  const loop = s.loop;
  const phase = loop?.phase ?? "starting";
  const printerStatus = loop?.printerStatus ?? "UNKNOWN";
  const problem = ["PAPER_OUT", "COVER_OPEN", "OFFLINE"].includes(printerStatus);
  const tone = phase === "running" && !problem ? (printerStatus === "PAPER_LOW" ? "warn" : "ok") : phase === "starting" ? "" : "bad";
  const title = phase === "running" && problem ? c.printerStatus[printerStatus] : (c.phase[phase] ?? phase);
  const actions = el("div", { class: "row" });
  if (phase === "blocked" || phase === "lost") actions.append(button(c.takeOver, () => void run(() => bridge.takeOver())));
  if (phase === "unpaired") actions.append(button(c.reconnect, () => void run(() => bridge.forgetPairing())));
  actions.append(
    button(c.testPrint, () => void run(async () => {
      try {
        await bridge.testPrint();
        message = { text: c.printed, kind: "ok" };
      } catch (error) {
        message = { text: fill(c.printFailed, { error: errorText(error) }), kind: "error" };
      }
    }), "btn secondary", busy),
    button(c.changePrinter, () => {
      editingPrinter = true;
      if (s.printer?.type === "network") draft = { type: "network", host: s.printer.host, port: s.printer.port, name: "" };
      if (s.printer?.type === "usb") draft = { type: "usb", host: "", port: 9100, name: s.printer.name };
      message = null;
      render();
    }, "btn secondary"),
  );
  const facts = el("dl", { class: "facts" },
    el("dt", { text: c.printer }), el("dd", { class: "ltr", text: s.printerLabel ?? "-" }),
    el("dt", { text: c.printerState }), el("dd", { text: c.printerStatus[printerStatus] ?? printerStatus }),
    el("dt", { text: c.printedCount }), el("dd", { text: String(loop?.printedCount ?? 0) }),
    el("dt", { text: c.waiting }), el("dd", { text: String(loop?.waiting ?? 0) }),
    el("dt", { text: c.last }), el("dd", { class: "ltr", text: loop?.lastPrinted ? new Date(loop.lastPrinted.at).toLocaleTimeString() : "-" }),
  );
  return el("div", { style: "display:grid;gap:16px" },
    el("section", { class: "card" },
      el("p", { class: "muted", text: s.branchName ? fill(c.connected, { branch: s.branchName }) : "" }),
      el("div", { class: "status" }, el("span", { class: `dot ${tone}`, "aria-hidden": "true" }), el("span", { text: title })),
      el("p", { class: "muted", text: phase === "running" && problem ? c.statusHint[printerStatus] : (c.hint[phase] ?? "") }),
      facts,
      actions,
      message ? el("p", { class: message.kind === "error" ? "error" : "muted", role: "alert", text: message.text }) : null,
    ),
    el("div", { class: "row spread" },
      button(c.diagnostics, () => void bridge.copyDiagnostics().then(() => { message = { text: c.copied, kind: "ok" }; render(); }), "link"),
      button(c.forget, () => {
        if (window.confirm(c.forgetConfirm)) void run(() => bridge.forgetPairing());
      }, "link"),
    ),
  );
}

function render(): void {
  if (!state) return;
  const c = t();
  document.documentElement.lang = state.locale;
  document.documentElement.dir = state.locale === "ar" ? "rtl" : "ltr";
  (document.getElementById("lang") as HTMLButtonElement).textContent = c.lang;
  (document.getElementById("version") as HTMLElement).textContent = fill(c.version, { v: state.version });
  const view = document.getElementById("view") as HTMLElement;
  const focused = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  if (focused) return; // don't wipe what someone is typing; the next render happens after they act
  view.replaceChildren(!state.paired ? pairView() : !state.printer || editingPrinter ? printerView() : statusView(state));
}

document.getElementById("lang")?.addEventListener("click", () => {
  if (!state) return;
  void bridge.setLocale(state.locale === "ar" ? "en" : "ar");
});

bridge.onState((next) => {
  const wasPaired = state?.paired;
  state = next;
  if (next.paired && !wasPaired) message = null;
  render();
});

void bridge.state().then((s) => {
  state = s;
  render();
});
