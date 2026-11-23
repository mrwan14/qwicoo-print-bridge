import { describe, expect, it } from "vitest";

import { WindowsSpoolerTransport, mapWin32Printer, psQuote, type Runner } from "../src/main/transports/windows-spooler";

function fakeRunner(output: string, seen: string[] = []): Runner {
  return async (script: string) => {
    seen.push(script);
    return output;
  };
}

describe("Windows spooler (USB printers)", () => {
  it("quotes printer names for PowerShell safely", () => {
    expect(psQuote("XP-80C")).toBe("'XP-80C'");
    expect(psQuote("Kitchen's printer")).toBe("'Kitchen''s printer'");
    expect(psQuote("a`$(calc)")).toBe("'a`$(calc)'");
  });

  it("sends raw bytes through a temp file with RAW datatype", async () => {
    const seen: string[] = [];
    const writes: { path: string; bytes: Uint8Array }[] = [];
    const transport = new WindowsSpoolerTransport("XP-80C", {
      run: fakeRunner("OK", seen),
      writeTemp: async (bytes) => {
        writes.push({ path: "C:\\Temp\\qwicoo-1.bin", bytes });
        return "C:\\Temp\\qwicoo-1.bin";
      },
      removeTemp: async () => undefined,
    });
    await transport.print(Uint8Array.of(1, 2, 3));
    expect(writes[0].bytes).toEqual(Uint8Array.of(1, 2, 3));
    expect(seen[0]).toContain('"RAW"');
    expect(seen[0]).toContain("'XP-80C'");
    expect(seen[0]).toContain("'C:\\Temp\\qwicoo-1.bin'");
  });

  it("a spooler failure is an error with the printer name", async () => {
    const transport = new WindowsSpoolerTransport("XP-80C", {
      run: fakeRunner("ERR:1801"),
      writeTemp: async () => "x",
      removeTemp: async () => undefined,
    });
    await expect(transport.print(Uint8Array.of(1))).rejects.toThrow(/XP-80C/);
  });

  it("maps Win32_Printer to a status", () => {
    expect(mapWin32Printer({ WorkOffline: true })).toBe("OFFLINE");
    expect(mapWin32Printer({ DetectedErrorState: 4 })).toBe("PAPER_OUT");
    expect(mapWin32Printer({ DetectedErrorState: 7 })).toBe("COVER_OPEN");
    expect(mapWin32Printer({ DetectedErrorState: 9 })).toBe("OFFLINE");
    expect(mapWin32Printer({ DetectedErrorState: 3 })).toBe("PAPER_LOW");
    expect(mapWin32Printer({ PrinterStatus: 3, DetectedErrorState: 2 })).toBe("READY");
    expect(mapWin32Printer({ PrinterStatus: 4 })).toBe("READY");
    expect(mapWin32Printer({ PrinterStatus: 7 })).toBe("OFFLINE");
    expect(mapWin32Printer({})).toBe("UNKNOWN");
    expect(mapWin32Printer(null)).toBe("OFFLINE");
  });

  it("reads status through WMI and lists printers", async () => {
    const status = new WindowsSpoolerTransport("XP-80C", { run: fakeRunner('{"WorkOffline":false,"PrinterStatus":3,"DetectedErrorState":0}') });
    expect(await status.status()).toBe("READY");
    const missing = new WindowsSpoolerTransport("Gone", { run: fakeRunner("") });
    expect(await missing.status()).toBe("OFFLINE");
    const list = await WindowsSpoolerTransport.list(fakeRunner('[{"Name":"XP-80C"},{"Name":"Microsoft Print to PDF"}]'));
    expect(list).toEqual(["XP-80C", "Microsoft Print to PDF"]);
    expect(await WindowsSpoolerTransport.list(fakeRunner('{"Name":"Only one"}'))).toEqual(["Only one"]);
  });
});

describe("printer names with quotes", () => {
  it("escapes the WMI filter for names with an apostrophe", async () => {
    const seen: string[] = [];
    const transport = new WindowsSpoolerTransport("Kitchen's XP-80", { run: fakeRunner('{"PrinterStatus":3}', seen) });
    expect(await transport.status()).toBe("READY");
    expect(seen[0]).toContain("-Filter 'Name=''Kitchen\\''s XP-80'''");
  });
});
