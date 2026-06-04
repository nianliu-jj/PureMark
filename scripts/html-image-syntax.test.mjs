import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("共享 HTML 图片工具存在并导出解析函数", () => {
  const source = readFileSync("src/core/utils/html-image.ts", "utf8");

  assert.match(source, /export function parseHtmlImageSource/);
  assert.match(source, /export function buildImageSourceText/);
});

test("解析器和序列化器包含 HTML 图片源码支持", () => {
  const schema = readFileSync("src/core/schema/index.ts", "utf8");
  const parser = readFileSync("src/core/parser/index.ts", "utf8");
  const serializer = readFileSync("src/core/serializer/index.ts", "utf8");

  assert.match(schema, /htmlSource:\s*\{\s*default:\s*""\s*\}/);
  assert.match(parser, /parseHtmlImageSource/);
  assert.match(parser, /htmlSource:\s*htmlImage\.htmlSource/);
  assert.match(serializer, /buildImageSourceText/);
});

test("实时转换、源码模式和图片编辑器复用 HTML 图片源码工具", () => {
  const detector = readFileSync("src/core/plugins/syntax-detector.ts", "utf8");
  const transform = readFileSync("src/core/plugins/source-view-transform.ts", "utf8");
  const imageView = readFileSync("src/core/nodeviews/image.ts", "utf8");

  assert.match(detector, /parseHtmlImageSource/);
  assert.match(detector, /htmlSource:\s*htmlImage\.htmlSource/);
  assert.match(transform, /buildImageSourceText/);
  assert.match(transform, /parseHtmlImageSource/);
  assert.match(imageView, /buildImageSourceText/);
  assert.match(imageView, /parseHtmlImageSource/);
});
