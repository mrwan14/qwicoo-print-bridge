import type { PrinterStatus } from "./escpos";
import type { KitchenTicket } from "./ticket";

/**
 * The Qwicoo kitchen-printer API with a paired device token. Plain fetch, so it runs in Electron's
 * main process today and in React Native later. API refusals come back as codes; network failures throw.
 */

export type QueueJob = { job_id: string; kind: string; late: boolean; ticket: KitchenTicket };
export type ApiResult<T> = ({ ok: true } & T) | { ok: false; code: string };

export interface BridgeApi {
  claim(deviceId: string, takeOver: boolean): Promise<ApiResult<{ width: 58 | 80 }>>;
  queue(deviceId: string): Promise<ApiResult<{ jobs: QueueJob[] }>>;
  ack(deviceId: string, jobId: string): Promise<ApiResult<object>>;
  status(deviceId: string, status: PrinterStatus, appVersion: string): Promise<ApiResult<object>>;
}

export type DeviceSession = { deviceId: string; token: string; branchName: string; width: 58 | 80 };

async function codeOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; detail?: unknown };
    if (typeof body.code === "string") return body.code;
    if (typeof body.detail === "string" && /^[A-Z_]{3,64}$/.test(body.detail)) return body.detail;
  } catch {
    // not JSON
  }
  return `HTTP_${response.status}`;
}

export class HttpBridgeApi implements BridgeApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult<{ data: T }>> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-printer-device-token": this.token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, code: await codeOf(response) };
    return { ok: true, data: (await response.json()) as T };
  }

  async claim(deviceId: string, takeOver: boolean): Promise<ApiResult<{ width: 58 | 80 }>> {
    const r = await this.call<{ ticket_width_mm: number }>("POST", "/kitchen-printer/claim", { device_id: deviceId, take_over: takeOver });
    return r.ok ? { ok: true, width: r.data.ticket_width_mm === 58 ? 58 : 80 } : r;
  }

  async queue(deviceId: string): Promise<ApiResult<{ jobs: QueueJob[] }>> {
    const r = await this.call<{ jobs: QueueJob[] }>("GET", `/kitchen-printer/queue?device_id=${encodeURIComponent(deviceId)}`);
    return r.ok ? { ok: true, jobs: r.data.jobs } : r;
  }

  async ack(deviceId: string, jobId: string): Promise<ApiResult<object>> {
    const r = await this.call("POST", `/kitchen-printer/jobs/${encodeURIComponent(jobId)}/printed`, { device_id: deviceId });
    return r.ok ? { ok: true } : r;
  }

  async status(deviceId: string, status: PrinterStatus, appVersion: string): Promise<ApiResult<object>> {
    const r = await this.call("POST", "/kitchen-printer/status", { device_id: deviceId, printer_status: status, app_version: appVersion });
    return r.ok ? { ok: true } : r;
  }
}

/** What the device list in Qwicoo shows this app as. */
export type DeviceKind = "WINDOWS" | "MACOS" | "ANDROID";

/** Exchange a one-time pairing code for this device's token. Throws with the API code on failure. */
export async function pairDevice(baseUrl: string, code: string, name: string, kind: DeviceKind, fetcher: typeof fetch = fetch): Promise<DeviceSession> {
  const response = await fetcher(`${baseUrl}/kitchen-printer/pair`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ code, name, kind }),
  });
  if (!response.ok) throw new Error(await codeOf(response));
  const body = (await response.json()) as { device_id: string; token: string; branch_name: string; ticket_width_mm: number };
  return { deviceId: body.device_id, token: body.token, branchName: body.branch_name, width: body.ticket_width_mm === 58 ? 58 : 80 };
}
