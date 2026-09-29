// Atlassian Document Format -> Markdown.
// Lossy by design: good enough for prompts and reading; swap for a full converter if fidelity matters.

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
}

export function adfToMarkdown(doc: unknown): string {
  if (typeof doc === "string") return doc;
  if (!doc || typeof doc !== "object") return "";
  return blocks((doc as AdfNode).content ?? []).trim();
}

function blocks(nodes: AdfNode[], indent = ""): string {
  return nodes.map((n) => block(n, indent)).filter(Boolean).join("\n\n");
}

function block(n: AdfNode, indent: string): string {
  const kids = n.content ?? [];
  switch (n.type) {
    case "paragraph":
      return indent + inline(kids);
    case "heading":
      return `${indent}${"#".repeat(Number(n.attrs?.level ?? 1))} ${inline(kids)}`;
    case "bulletList":
      return kids.map((li) => listItem(li, `${indent}- `, indent + "  ")).join("\n");
    case "orderedList":
      return kids
        .map((li, i) => listItem(li, `${indent}${i + 1}. `, indent + "   "))
        .join("\n");
    case "codeBlock": {
      const lang = String(n.attrs?.language ?? "");
      return `${indent}\`\`\`${lang}\n${kids.map((k) => k.text ?? "").join("")}\n${indent}\`\`\``;
    }
    case "blockquote":
      return blocks(kids, indent)
        .split("\n")
        .map((l) => `${indent}> ${l.slice(indent.length)}`)
        .join("\n");
    case "rule":
      return `${indent}---`;
    case "panel":
      return `${indent}> **${String(n.attrs?.panelType ?? "note")}**\n${blocks(kids, indent)
        .split("\n")
        .map((l) => `${indent}> ${l.slice(indent.length)}`)
        .join("\n")}`;
    case "table":
      return table(kids, indent);
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return `${indent}[attachment]`;
    default:
      return kids.length ? blocks(kids, indent) : inline([n]);
  }
}

function listItem(li: AdfNode, marker: string, indent: string): string {
  const [first, ...rest] = li.content ?? [];
  const head = first ? block(first, "").trimStart() : "";
  const tail = rest.length ? "\n" + blocks(rest, indent) : "";
  return marker + head + tail;
}

function table(rows: AdfNode[], indent: string): string {
  const cells = rows.map((r) =>
    (r.content ?? []).map((c) => blocks(c.content ?? []).replace(/\n+/g, " ").trim()),
  );
  if (!cells.length) return "";
  const width = Math.max(...cells.map((r) => r.length));
  const line = (r: string[]) =>
    `${indent}| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const [head, ...body] = cells;
  return [line(head), `${indent}|${" --- |".repeat(width)}`, ...body.map(line)].join("\n");
}

function inline(nodes: AdfNode[]): string {
  return nodes.map(inlineNode).join("");
}

function inlineNode(n: AdfNode): string {
  const a = n.attrs ?? {};
  switch (n.type) {
    case "text":
      return marks(n.text ?? "", n.marks ?? []);
    case "hardBreak":
      return "\n";
    case "mention":
      return String(a.text ?? `@${a.id ?? "user"}`);
    case "emoji":
      return String(a.text ?? a.shortName ?? "");
    case "inlineCard":
      return String(a.url ?? "");
    case "status":
      return `[${String(a.text ?? "")}]`;
    case "date":
      return a.timestamp ? new Date(Number(a.timestamp)).toISOString().slice(0, 10) : "";
    default:
      return n.content ? inline(n.content) : "";
  }
}

function marks(text: string, ms: NonNullable<AdfNode["marks"]>): string {
  let out = text;
  for (const m of ms) {
    switch (m.type) {
      case "strong":
        out = `**${out}**`;
        break;
      case "em":
        out = `_${out}_`;
        break;
      case "code":
        out = `\`${out}\``;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "link":
        out = `[${out}](${String(m.attrs?.href ?? "")})`;
        break;
    }
  }
  return out;
}
