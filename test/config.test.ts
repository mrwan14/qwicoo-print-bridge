import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigStore, type Sealer } from "../src/main/config";
import { redact } from "../src/main/log";

const reversing: Sealer = {
  available: () => true,
  seal: (t) => `sealed:${[...t].reverse().join("")}`,
  open: (s) => [...s.replace("sealed:", "")].reverse().join(""),
};

function dir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qwicoo-cfg-"));
}

describe("config store", () => {
  it("defaults to Arabic and the production API", () => {
    const store = new ConfigStore(dir(), reversing);
    expect(store.value.locale).toBe("ar");
    expect(store.value.apiBase).toMatch(/^https:\/\/.+\/api\/v1$/);
    expect(store.token()).toBeNull();
  });

  it("never writes the device token in plain text when the OS can encrypt", () => {
    const d = dir();
    const store = new ConfigStore(d, reversing);
    store.setDevice({ deviceId: "d1", token: "qpd_abc_secret", branchName: "Zamalek", width: 80 });
    const raw = fs.readFileSync(path.join(d, "config.json"), "utf8");
    expect(raw).not.toContain("qpd_abc_secret");
    expect(new ConfigStore(d, reversing).token()).toBe("qpd_abc_secret");
  });

  it("keeps printer and language across restarts", () => {
    const d = dir();
    const store = new ConfigStore(d, reversing);
    store.setPrinter({ type: "network", host: "192.168.1.50", port: 9100 });
    store.setLocale("en");
    const again = new ConfigStore(d, reversing);
    expect(again.value.printer).toEqual({ type: "network", host: "192.168.1.50", port: 9100 });
    expect(again.value.locale).toBe("en");
  });

  it("a corrupt file starts fresh instead of crashing", () => {
    const d = dir();
    fs.writeFileSync(path.join(d, "config.json"), "{not json");
    expect(new ConfigStore(d, reversing).value.locale).toBe("ar");
  });
});

describe("logs", () => {
  it("never contain a device token", () => {
    expect(redact("claim failed for qpd_9f8e_AbC-123_x token")).toBe("claim failed for qpd_*** token");
  });
});
