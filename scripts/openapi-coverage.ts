import ts from "typescript";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

type Constraints = { method?: string; length?: number; values: Record<number, string> };
const methods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const empty = (): Constraints => ({ values: {} });
function merge(a: Constraints, b: Constraints): Constraints | null {
  if (a.method && b.method && a.method !== b.method || a.length !== undefined && b.length !== undefined && a.length !== b.length) return null;
  if (Object.keys(a.values).some(key => b.values[Number(key)] !== undefined && a.values[Number(key)] !== b.values[Number(key)])) return null;
  return { method: b.method ?? a.method, length: b.length ?? a.length, values: { ...a.values, ...b.values } };
}
const combine = (a: Constraints[], b: Constraints[]) => a.flatMap(left => b.map(right => merge(left, right)).filter((value): value is Constraints => !!value));
export const operationKey = (method: string, path: string) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, "{}").replace(/\/$/, "")}`;

// Symbolically enumerate the actual conditional dispatch, independently of the documentation inventory.
export function sourceOperations(path: string, source: string) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const catchAll = path.includes("[...path]"), actionRoute = path.includes("[action]");
  const pattern = path.replace(/^src\/app/, "").replace(/\/route\.ts$/, "").split("/").filter(Boolean);
  const prefix = catchAll ? pattern.slice(0, -1) : pattern;
  const aliases = new Map<string, number>();
  const exported = new Set<string>();
  const bindings = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) && methods.has(node.name?.text ?? "")) exported.add(node.name!.text);
    if (ts.isVariableStatement(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) for (const declaration of node.declarationList.declarations) if (methods.has(declaration.name.getText(file))) exported.add(declaration.name.getText(file));
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer?.getText(file) === "path") {
      node.name.elements.forEach((element, index) => { if (ts.isBindingElement(element)) aliases.set(element.name.getText(file), index); });
    }
    ts.forEachChild(node, bindings);
  };
  bindings(file);
  if (actionRoute) aliases.set("action", pattern.indexOf("[action]"));
  const atom = (expression: ts.Expression): Constraints[] => {
    if (ts.isParenthesizedExpression(expression)) return atom(expression.expression);
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return combine(atom(expression.left), atom(expression.right));
      if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) return [...atom(expression.left), ...atom(expression.right)];
      const left = expression.left.getText(file), right = expression.right;
      if (["request.method", "path.length", ...aliases.keys()].includes(left)) {
        if (![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(expression.operatorToken.kind)) throw new Error(`${path}: unsupported routing predicate ${expression.getText(file)}`);
        if (left === "request.method" && ts.isStringLiteral(right)) return [{ method: right.text, values: {} }];
        if (left === "path.length" && ts.isNumericLiteral(right)) return [{ length: Number(right.text), values: {} }];
        if (aliases.has(left) && ts.isStringLiteral(right)) return [{ values: { [aliases.get(left)!]: right.text } }];
        throw new Error(`${path}: nonliteral routing predicate ${expression.getText(file)}`);
      }
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "includes" && ts.isArrayLiteralExpression(expression.expression.expression)) {
      const alias = expression.arguments[0]?.getText(file);
      if (alias && aliases.has(alias)) return expression.expression.expression.elements.map(value => {
        if (!ts.isStringLiteral(value)) throw new Error(`${path}: routing list must be literal`);
        return { values: { [aliases.get(alias)!]: value.text } };
      });
    }
    return [empty()]; // Non-routing guards do not create operations.
  };
  const found = new Set<string>();
  const walk = (node: ts.Node, states: Constraints[]) => {
    if (ts.isFunctionDeclaration(node) && methods.has(node.name?.text ?? "")) states = states.map(value => ({ ...value, method: node.name!.text }));
    if (ts.isIfStatement(node)) {
      walk(node.thenStatement, combine(states, atom(node.expression)));
      if (node.elseStatement) throw new Error(`${path}: routing else branch needs an explicit coverage rule`);
      return;
    }
    if (ts.isReturnStatement(node)) {
      for (const state of states) {
        if (!state.method || !exported.has(state.method)) continue;
        if (catchAll) {
          if (state.length === undefined) continue;
          if (Object.keys(state.values).some(index => Number(index) >= state.length!)) throw new Error(`${path}: impossible path length`);
          found.add(operationKey(state.method, "/" + [...prefix, ...Array.from({ length: state.length }, (_, index) => state.values[index] ?? "{parameter}")].join("/")));
        } else {
          if (actionRoute && state.values[aliases.get("action")!] === undefined) continue;
          found.add(operationKey(state.method, "/" + pattern.map((segment, index) => state.values[index] ?? segment.replace(/^\[(.+)\]$/, "{$1}")).join("/")));
        }
      }
    }
    ts.forEachChild(node, child => walk(child, states));
  };
  walk(file, [empty()]);
  return found;
}

export async function actualOperations() {
  const result = new Set<string>();
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name).replace(/\\/g, "/");
      if (entry.isDirectory()) await visit(path);
      else if (entry.name === "route.ts") for (const key of sourceOperations(path, await readFile(path, "utf8"))) result.add(key);
    }
  }
  await visit("src/app/api");
  // Documentation transport is infrastructure, not one of the 66 business operations.
  result.delete("GET /api/admin/openapi");
  return result;
}

export async function verifyCoverage(expected: readonly { method: string; path: string }[]) {
  const actual = await actualOperations(), documented = new Set(expected.map(value => operationKey(value.method, value.path)));
  const missing = [...actual].filter(key => !documented.has(key)), nonexistent = [...documented].filter(key => !actual.has(key));
  if (missing.length || nonexistent.length) throw new Error(`API coverage mismatch: ${JSON.stringify({ missing, nonexistent })}`);
  return actual.size;
}
