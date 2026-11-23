import { describe, expect, it } from "vitest";

import { HttpBridgeApi, pairDevice } from "../src/core/api";

function fakeFetch(responses: Record<string, { status: number; body: unknown }>, seen: { url: string; init: RequestInit }[]) {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const r = responses[key] ?? { status: 404, body: { code: "NOT_FOUND" } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("backend client", () => {
  it("sends the device token header, never a bearer token", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const api = new HttpBridgeApi("https://api.qwicoo.test/api/v1", "qpd_abc_def", fakeFetch({ "POST /api/v1/kitchen-printer/claim": { status: 200, body: { active: true, ticket_width_mm: 58, kitchen_mode: "PRINTER" } } }, seen));
    expect(await api.claim("d1", false)).toEqual({ ok: true, width: 58 });
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get("x-printer-device-token")).toBe("qpd_abc_def");
    expect(headers.get("authorization")).toBeNull();
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ device_id: "d1", take_over: false });
  });

  it("returns API error codes instead of throwing", async () => {
    const api = new HttpBridgeApi("https://x/api/v1", "qpd_a_b", fakeFetch({ "GET /api/v1/kitchen-printer/queue": { status: 401, body: { code: "PRINTER_DEVICE_UNPAIRED", detail: "x" } } }, []));
    expect(await api.queue("d1")).toEqual({ ok: false, code: "PRINTER_DEVICE_UNPAIRED" });
  });

  it("network failures throw (the loop treats them as offline)", async () => {
    const api = new HttpBridgeApi("https://x/api/v1", "qpd_a_b", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(api.queue("d1")).rejects.toThrow("fetch failed");
  });

  it("pairs with a code and returns the device session", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const session = await pairDevice(
      "https://x/api/v1",
      "kq7m-3xpa",
      "Kitchen PC",
      fakeFetch({ "POST /api/v1/kitchen-printer/pair": { status: 201, body: { device_id: "d9", token: "qpd_d9_s", branch_id: "b", branch_name: "Zamalek", ticket_width_mm: 80 } } }, seen),
    );
    expect(session).toEqual({ deviceId: "d9", token: "qpd_d9_s", branchName: "Zamalek", width: 80 });
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ code: "kq7m-3xpa", name: "Kitchen PC", kind: "WINDOWS" });
  });

  it("a wrong code is a readable error", async () => {
    await expect(
      pairDevice("https://x/api/v1", "nope", "PC", fakeFetch({ "POST /api/v1/kitchen-printer/pair": { status: 400, body: { code: "PAIRING_CODE_INVALID" } } }, [])),
    ).rejects.toThrow("PAIRING_CODE_INVALID");
  });
});
