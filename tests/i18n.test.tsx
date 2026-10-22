import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { createTranslator, NextIntlClientProvider, useTranslations } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { hasMessage, messages, type Translate } from "../src/lib/i18n";
import { uploadProcessingLabel } from "../src/lib/client-contract";

function flatten(value: object, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => typeof child === "string" ? [[prefix + key, child]] : Object.entries(flatten(child, prefix + key + "."))));
}
function argumentsIn(elements: MessageFormatElement[], names = new Set<string>()) {
  for (const element of elements) {
    if (element.type !== TYPE.literal && element.type !== TYPE.pound) names.add(element.value);
    if (element.type === TYPE.select || element.type === TYPE.plural) for (const option of Object.values(element.options)) argumentsIn(option.value, names);
    if (element.type === TYPE.tag) argumentsIn(element.children, names);
  }
  return [...names].sort();
}

test("independent catalogs have matching semantic IDs and valid ICU arguments in both languages", () => {
  const zh = flatten(messages["zh-CN"]), en = flatten(messages["en-US"]);
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const formats = Object.fromEntries(Object.entries(messages).map(([locale, dictionary]) => [locale, createTranslator({ locale: locale as "zh-CN" | "en-US", messages: dictionary, onError: error => { throw error; } }) as Translate]));
  for (const [key, value] of Object.entries(zh)) {
    assert.match(key, /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/);
    assert(value.trim()); assert(en[key].trim()); assert(!/[\u3400-\u9fff]/.test(en[key]), key);
    const args = argumentsIn(parse(value));
    assert.deepEqual(argumentsIn(parse(en[key])), args, key);
    for (const locale of ["zh-CN", "en-US"]) assert.equal(typeof formats[locale](key, Object.fromEntries(args.map(name => [name, 42]))), "string");
  }
});

test("editing Chinese copy preserves the semantic ID and leaves English independent", () => {
  function SkinSiteButton() { const t = useTranslations("auth.login"); return <button>{t("skinSite")}</button>; }
  const dictionary = structuredClone(messages["zh-CN"]);
  dictionary.auth.login.skinSite = "通过皮肤站继续";
  const html = renderToStaticMarkup(<NextIntlClientProvider locale="zh-CN" messages={dictionary} timeZone="Asia/Shanghai"><SkinSiteButton /></NextIntlClientProvider>);
  assert(html.includes("通过皮肤站继续"));
  assert.equal(messages["en-US"].auth.login.skinSite, "Sign in with a skin site");
  const t = createTranslator({ locale: "en-US", messages: messages["en-US"] }) as Translate;
  assert.equal(uploadProcessingLabel({ status: "PROCESSING", processingPhase: "CAS", progress: 25 }, t), "Client detected · Checking files 25%");
});

test("presentation code uses catalog IDs rather than source sentences", async () => {
  async function files(directory: string): Promise<string[]> {
    return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${directory}/${entry.name}`] : []))).flat();
  }
  for (const file of [...await files("src/components"), ...await files("src/lib/openapi"), "src/lib/server-probe-contract.ts", "src/lib/client-contract.ts"]) {
    const text = await readFile(file, "utf8"), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "t" && ts.isStringLiteral(node.arguments[0])) assert(hasMessage(node.arguments[0].text), `${file}: ${node.arguments[0].text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
