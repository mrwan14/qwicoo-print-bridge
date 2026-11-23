import { describe, expect, it } from "vitest";

import { CupsTransport, mapCupsStatus, validCupsName, type CupsRunner } from "../src/main/transports/cups";

type Call = { cmd: string; args: string[]; input?: Uint8Array };

function fakeRunner(reply: string | Error, calls: Call[] = []): CupsRunner {
  return async (cmd, args, input) => {
    calls.push({ cmd, args, input });
    if (reply instanceof Error) throw reply;
    return reply;
  };
}

const IDLE = `printer Xprinter_XP_80C is idle.  enabled since Mon Nov 23 10:00:00 2026
\tForm mounts:
\tAlerts: none
\tDescription: Xprinter XP-80C`;

describe("macOS USB printers (CUPS)", () => {
  it("lists printers from lpstat -e", async () => {
    const calls: Call[] = [];
    const list = await CupsTransport.list(fakeRunner("Xprinter_XP_80C\nOffice_Laser\n\n", calls));
    expect(list).toEqual(["Xprinter_XP_80C", "Office_Laser"]);
    expect(calls[0]).toMatchObject({ cmd: "lpstat", args: ["-e"] });
  });

  it("no printers is an empty list, not an error", async () => {
    expect(await CupsTransport.list(fakeRunner(new Error("lpstat: No destinations added.")))).toEqual([]);
  });

  it("prints raw bytes on stdin, untouched by any driver", async () => {
    const calls: Call[] = [];
    const transport = new CupsTransport("Xprinter_XP_80C", { run: fakeRunner("request id is Xprinter_XP_80C-7 (0 file(s))", calls) });
    await transport.print(Uint8Array.of(0x1b, 0x40, 0x0a));
    expect(calls[0].cmd).toBe("lp");
    expect(calls[0].args).toEqual(["-d", "Xprinter_XP_80C", "-o", "raw", "-t", "Qwicoo kitchen ticket"]);
    expect(calls[0].input).toEqual(Uint8Array.of(0x1b, 0x40, 0x0a));
  });

  it("a print failure is an error naming the printer", async () => {
    const transport = new CupsTransport("Xprinter_XP_80C", { run: fakeRunner(new Error("lp: The printer or class does not exist.")) });
    await expect(transport.print(Uint8Array.of(1))).rejects.toThrow(/Xprinter_XP_80C/);
  });

  it("refuses names that could be read as options or paths", () => {
    expect(validCupsName("Xprinter_XP_80C")).toBe(true);
    expect(validCupsName("XP-58IIH")).toBe(true);
    expect(validCupsName("-o")).toBe(false);
    expect(validCupsName("a b")).toBe(false);
    expect(validCupsName("a/b")).toBe(false);
    expect(validCupsName("a#b")).toBe(false);
    expect(validCupsName("")).toBe(false);
    expect(() => new CupsTransport("-d evil")).toThrow(/INVALID_PRINTER/);
  });

  it("maps lpstat output to a status", () => {
    expect(mapCupsStatus(IDLE)).toBe("READY");
    expect(mapCupsStatus("printer X now printing X-3.  enabled since Mon\n\tAlerts: none")).toBe("READY");
    expect(mapCupsStatus("printer X disabled since Mon Nov 23 2026 -\n\tPaused")).toBe("OFFLINE");
    expect(mapCupsStatus("printer X is idle.  enabled since Mon\n\tAlerts: media-empty-error")).toBe("PAPER_OUT");
    expect(mapCupsStatus("printer X is idle.  enabled since Mon\n\tAlerts: media-low-report")).toBe("PAPER_LOW");
    expect(mapCupsStatus("printer X is idle.  enabled since Mon\n\tAlerts: cover-open-error")).toBe("COVER_OPEN");
    expect(mapCupsStatus("printer X is idle.  enabled since Mon\n\tAlerts: door-open-report")).toBe("COVER_OPEN");
    expect(mapCupsStatus("printer X is idle.  enabled since Mon\n\tAlerts: offline-report")).toBe("OFFLINE");
    expect(mapCupsStatus("something else")).toBe("UNKNOWN");
  });

  it("reads status with lpstat -l -p in English; a missing printer is offline", async () => {
    const calls: Call[] = [];
    expect(await new CupsTransport("Xprinter_XP_80C", { run: fakeRunner(IDLE, calls) }).status()).toBe("READY");
    expect(calls[0]).toMatchObject({ cmd: "lpstat", args: ["-l", "-p", "Xprinter_XP_80C"] });
    const gone = new CupsTransport("Gone", { run: fakeRunner(new Error("lpstat: Invalid destination name in list")) });
    expect(await gone.status()).toBe("OFFLINE");
  });

  it("describes itself as a USB printer", () => {
    expect(new CupsTransport("Xprinter_XP_80C").describe()).toBe("Xprinter_XP_80C (USB)");
  });
});
