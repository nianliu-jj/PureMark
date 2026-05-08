import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function extractRegex(source, anchor) {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `未找到锚点: ${anchor}`);

  const snippet = source.slice(start);
  const literalMatch = snippet.match(/\/(.+)\/([gimsuy]*)/);
  assert.ok(literalMatch, `未找到正则字面量: ${anchor}`);

  return new RegExp(literalMatch[1], literalMatch[2]);
}

function assertStrongPatternWorks(regex) {
  regex.lastIndex = 0;
  assert.equal(regex.exec("**bold**")?.[2], "bold");

  regex.lastIndex = 0;
  assert.equal(regex.exec("__bold__")?.[4], "bold");
}

test("解析器粗体正则同时支持星号和下划线语法", () => {
  const source = readFileSync("src/core/parser/index.ts", "utf8");
  const regex = extractRegex(source, 'type: "strong"');

  assertStrongPatternWorks(regex);
});

test("语法检测器粗体正则同时支持星号和下划线语法", () => {
  const source = readFileSync("src/core/plugins/syntax-detector.ts", "utf8");
  const regex = extractRegex(source, 'type: "strong"');

  assertStrongPatternWorks(regex);
});

test("输入规则粗体正则同时支持星号和下划线语法", () => {
  const source = readFileSync("src/core/plugins/input-rules.ts", "utf8");
  const regex = extractRegex(source, "function strongRule");

  assertStrongPatternWorks(regex);
});
