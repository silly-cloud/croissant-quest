import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BANK, RULES, TAG } from "@cq/content";
import { fullOf } from "@cq/shared";
import { answerParts, joinParts } from "@/lib/answer-line";
import { parseRich, Rich, stripRich } from "@/lib/rich";

describe("answer line", () => {
  it("never doubles the sentence: the parts always read as fullOf(q), for every question in the bank", () => {
    for (const q of BANK) {
      const parts = answerParts(q);
      expect(joinParts(parts), q.s ?? q.en).toBe(fullOf(q));
      if (q.k !== "choice") expect(parts).toHaveLength(1);
    }
  });

  it("underlines only the supplied word for a choice, and closes elisions", () => {
    const q = BANK.find((x) => x.k === "choice" && x.a === "de l'")!;
    const parts = answerParts(q);
    expect(parts.filter((p) => p.em).map((p) => p.text)).toEqual(["de l'"]);
    expect(joinParts(parts)).not.toMatch(/'\s/);
  });
});

describe("Rich (allow-list renderer)", () => {
  it("renders the formatting the rule cards use", () => {
    const { container } = render(<Rich html={'<h5>Forms</h5><p><code>du</code> m · <b>de la</b> f<br>next</p><div class="tip">tip <i>x</i></div>'} />);
    expect(container.querySelector("h5")?.textContent).toBe("Forms");
    expect(container.querySelector("p code")?.textContent).toBe("du");
    expect(container.querySelector("p b")?.textContent).toBe("de la");
    expect(container.querySelector("p br")).not.toBeNull();
    expect(container.querySelector("div.tip i")?.textContent).toBe("x");
  });

  it("drops scripts, images, handlers and unknown attributes but keeps their text", () => {
    const { container } = render(
      <Rich html={'<img src=x onerror="alert(1)">a<script>alert(2)</script><b onclick="x()" style="color:red">b</b><a href="javascript:x">c</a><div class="evil" onmouseover="y">d</div>'} />,
    );
    expect(container.querySelector("img,script,a")).toBeNull();
    const b = container.querySelector("b")!;
    expect(b.getAttributeNames()).toEqual([]);
    const div = container.querySelector("div")!;
    expect(div.getAttributeNames()).toEqual([]);
    expect(container.textContent).toContain("alert(2)"); // text is kept, as text
  });

  it("escapes angle brackets that are text", () => {
    const { container } = render(<Rich html={"1 &lt; 2 <b>&amp;</b>"} />);
    expect(container.textContent).toBe("1 < 2 &");
    expect(container.querySelector("b")?.textContent).toBe("&");
  });

  it("parses every rule card and tag text without leftover markup", () => {
    for (const html of [...Object.values(RULES), ...Object.values(TAG).flat()]) {
      const { container } = render(<Rich html={html} />);
      expect(container.textContent).not.toMatch(/<\/?(b|code|p|h5|i|div|br)\b/);
      expect(container.textContent).toBe(stripRich(html));
    }
  });

  it("unbalanced tags do not throw", () => {
    expect(() => parseRich("<b>open <i>nested </b> stray </i></p>")).not.toThrow();
  });
});
