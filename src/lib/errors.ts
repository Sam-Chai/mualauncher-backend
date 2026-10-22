import { errorDiagnostic, parseDiagnostic, type Diagnostic } from "./diagnostics";
export class AppError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(public status: number, message: string) {
    const detail = parseDiagnostic(message) ?? errorDiagnostic(message);
    super(detail.message);
    this.diagnostic = detail;
  }
}

export function invariant(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new AppError(status, message);
}
