import { diagnosticSchema, type Diagnostic } from "./diagnostics";

export class RequestError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(message: string, public status: number, detail?: { code?: string; params?: Record<string, string | number> }) {
    super(message);
    const parsed = diagnosticSchema.safeParse({ code: detail?.code, message, params: detail?.params });
    this.diagnostic = parsed.success ? parsed.data : { code: "diagnostics.common.unexpectedError", message, params: {} };
  }
}
