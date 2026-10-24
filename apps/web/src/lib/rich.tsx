import { createElement, Fragment, type ReactNode } from "react";

/**
 * The rule cards in @cq/content are small HTML strings (<b>, <code>, <i>, <p>, <h5>, <br>,
 * <div class="tip">). This renders them through an allow-list instead of innerHTML: any other
 * tag is dropped (its text stays), attributes are ignored except class="tip" on a div, and
 * text is always escaped by React.
 */
const INLINE = new Set(["b", "i", "code", "em", "strong"]);
const BLOCK = new Set(["p", "h5"]);

interface Node_ {
  tag: string | null; // null = root
  cls?: string;
  kids: (Node_ | string)[];
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);

export function parseRich(html: string): Node_ {
  const root: Node_ = { tag: null, kids: [] };
  const stack: Node_[] = [root];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const top = () => stack[stack.length - 1]!;
  const text = (t: string) => {
    if (t) top().kids.push(decode(t));
  };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? "";
    const ok = INLINE.has(tag) || BLOCK.has(tag) || tag === "div" || tag === "br";
    if (!ok) continue;
    if (tag === "br") {
      if (!closing) top().kids.push({ tag: "br", kids: [] });
      continue;
    }
    if (closing) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const cls = tag === "div" && /class\s*=\s*["']?tip["']?/.test(attrs) ? "tip" : undefined;
    const node: Node_ = { tag, cls, kids: [] };
    top().kids.push(node);
    stack.push(node);
  }
  text(html.slice(last));
  return root;
}

function toReact(n: Node_ | string, key: number): ReactNode {
  if (typeof n === "string") return n;
  if (n.tag === "br") return <br key={key} />;
  const kids = n.kids.map(toReact);
  if (n.tag === null) return <Fragment key={key}>{kids}</Fragment>;
  return createElement(n.tag, { key, ...(n.cls ? { className: n.cls } : {}) }, ...kids);
}

export function Rich({ html, className }: { html: string; className?: string }) {
  const tree = parseRich(html);
  const kids = tree.kids.map(toReact);
  return className ? <div className={className}>{kids}</div> : <>{kids}</>;
}

/** Plain text of a rich string (for prompts and aria labels). */
export function stripRich(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ""));
}
