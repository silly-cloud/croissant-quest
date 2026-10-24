import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";

/** 22021 invalid byte sequence (NUL), 22P05 unsupported unicode escape, 22P02 invalid json input. */
const INVALID_TEXT = new Set(["22021", "22P05", "22P02"]);
const pgCode = (err: unknown): unknown =>
  (err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } } | null)?.meta?.driverAdapterError?.cause
    ?.originalCode;

/**
 * One error shape for everything: HttpExceptions keep their body, body-parser errors (bad JSON,
 * too large) become a plain 4xx, anything else is a 500 with no detail. Stack traces and error
 * messages of unexpected errors go to the log only (messages are scrubbed of anything key-like).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger("Http");

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (err instanceof HttpException) {
      const body = err.getResponse();
      res.status(err.getStatus()).json(typeof body === "string" ? { statusCode: err.getStatus(), message: body } : body);
      return;
    }

    const e = err as { status?: unknown; statusCode?: unknown; type?: unknown };
    const status = Number(e?.status ?? e?.statusCode);
    if (status >= 400 && status < 500 && typeof e.type === "string") {
      // body-parser: entity.too.large, entity.parse.failed, ...
      const message = status === 413 ? "Payload too large" : "Malformed request body";
      res.status(status).json({ statusCode: status, error: message, message });
      return;
    }

    // Postgres refused text in the request (NUL, invalid unicode, bad json): the client's fault, not ours
    if (INVALID_TEXT.has(String(pgCode(err)))) {
      res.status(400).json({ statusCode: 400, error: "Bad Request", message: "Invalid text in request" });
      return;
    }

    const msg = err instanceof Error ? err.message : String(err);
    this.log.error(msg.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]"));
    res.status(500).json({ statusCode: 500, error: "Internal Server Error", message: "Internal server error" });
  }
}
