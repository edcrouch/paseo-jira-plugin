// Run: node --experimental-strip-types server/adf.test.mjs  (or: npm test)
import assert from "node:assert/strict";
import { adfToMarkdown } from "./adf.ts";

const doc = {
  type: "doc",
  version: 1,
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Bug" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "bold", marks: [{ type: "strong" }] },
        { type: "text", text: " and " },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://x.test" } }] },
        { type: "hardBreak" },
        { type: "mention", attrs: { id: "1", text: "@Ed" } },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "two" }] },
            {
              type: "orderedList",
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }] },
              ],
            },
          ],
        },
      ],
    },
    { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "x = 1" }] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] }] },
      ],
    },
    { type: "mediaSingle", content: [{ type: "media", attrs: {} }] },
  ],
};

assert.equal(
  adfToMarkdown(doc),
  [
    "## Bug",
    "",
    "Hello **bold** and [link](https://x.test)\n@Ed",
    "",
    "- one\n- two\n  1. nested",
    "",
    "```js\nx = 1\n```",
    "",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
    "",
    "[attachment]",
  ].join("\n"),
);
assert.equal(adfToMarkdown(null), "");
assert.equal(adfToMarkdown("plain v2 text"), "plain v2 text");
console.log("adf ok");
