import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../src/lib/errors";
import { failure, json } from "../src/lib/http";
import { diagnostic, diagnosticText, diagnosticView, errorDiagnostic, formatMessage, serializeError } from "../src/lib/diagnostics";
import { RequestError } from "../src/lib/request-error";
import { translator } from "../src/lib/i18n";
import { errorSchema } from "../src/lib/openapi/schemas";

test("API errors return English text, stable codes and parameters independently of UI locale", async () => {
  const code = "diagnostics.clientService.theUploadExceedsTheMaximumAllowedSize0Mb";
  const response = failure(new AppError(413, diagnosticText(code, { arg0: 1024 })));
  assert.equal(response.status, 413);
  const payload = await response.json();
  assert(errorSchema.safeParse(payload).success);
  assert.deepEqual(payload, { error: "The upload exceeds the maximum allowed size (1024 MB)", code, params: { arg0: 1024 } });
  const clientError = new RequestError(payload.error, 413, payload);
  assert.equal(clientError.message, payload.error);
  assert.equal(formatMessage(translator("en-US"), serializeError(clientError)), payload.error);
  assert.equal(formatMessage(translator("zh-CN"), serializeError(clientError)), "上传文件超过允许的最大大小（1024 MB）");
});

test("Worker diagnostics preserve codes in storage and API responses without matching message text", async () => {
  const detail = diagnostic("diagnostics.packageWorker.generatedAndVerified");
  const error = new AppError(409, JSON.stringify(detail));
  assert.deepEqual(errorDiagnostic(error), detail);
  const stored = { phase: serializeError(error), warnings: [JSON.stringify(detail)], description: JSON.stringify(detail), displayName: "服务器管理" };
  const dto = diagnosticView(stored);
  assert.deepEqual(dto.phase, detail); assert.deepEqual(dto.warnings, [detail]);
  assert.equal(dto.description, stored.description); assert.equal(dto.displayName, stored.displayName);
  const result = await json(dto).json(); assert.deepEqual(result, dto, "serializing an already projected diagnostic must be idempotent");
  assert.equal(formatMessage(translator("zh-CN"), result.phase), "已生成并校验");
  assert.equal(formatMessage(translator("en-US"), result.phase), "Generated and verified");
  assert.equal(formatMessage(translator("en-US"), "用户名或密码错误，或账号已停用"), "用户名或密码错误，或账号已停用", "raw sentences are not translation keys");
});

test("database failures expose an English diagnostic without database details", async () => {
  const response = failure({ code: "23505", message: "sensitive SQL details" });
  assert.equal(response.status, 409);
  const payload = await response.json(); assert(errorSchema.safeParse(payload).success);
  assert(!/[\u3400-\u9fff]/.test(payload.error)); assert(!payload.error.includes("sensitive"));
  assert.notEqual(formatMessage(translator("zh-CN"), { code: payload.code, message: payload.error, params: payload.params }), payload.error);
  const local = serializeError(new Error("clientUpload.uploadCancelled"));
  assert.equal(formatMessage(translator("zh-CN"), local), "上传已取消");
  assert.equal(formatMessage(translator("en-US"), local), "Upload cancelled");
});
