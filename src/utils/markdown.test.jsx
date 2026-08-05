import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SimpleMarkdown } from "./markdown.jsx";

describe("SimpleMarkdown", () => {
  it("renders nothing when text is absent", () => {
    const { container } = render(<SimpleMarkdown />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders plain text paragraphs", () => {
    render(<SimpleMarkdown text="hello from hermes" />);
    expect(screen.getByText(/hello from hermes/)).toBeInTheDocument();
  });

  it("renders an empty container for empty text", () => {
    const { container } = render(<SimpleMarkdown text="" />);
    expect(container.textContent).toBe("");
  });

  it("renders h1/h2/h3 headings", () => {
    render(<SimpleMarkdown text={"# Big\n## Medium\n### Small"} />);
    expect(screen.getByText("Big")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Small")).toBeInTheDocument();
  });

  it("renders bold, italic, and inline code", () => {
    render(<SimpleMarkdown text="a **bold** and *italic* with `code`" />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
  });

  it("supports inline formatting inside headings", () => {
    render(<SimpleMarkdown text="# **Title**" />);
    expect(screen.getByText("Title").tagName).toBe("STRONG");
  });

  it("renders a fenced code block with its language label", () => {
    const { container } = render(
      <SimpleMarkdown text={'```js\nconst answer = 42;\n```'} />
    );
    expect(screen.getByText("js")).toBeInTheDocument();
    expect(container.querySelector("pre code").textContent).toBe(
      "const answer = 42;"
    );
  });

  it("renders a fenced code block without a language label", () => {
    const { container } = render(
      <SimpleMarkdown text={'```\nplain code\n```'} />
    );
    expect(container.querySelector("pre code").textContent).toBe("plain code");
  });

  it("renders dashed bullet lists", () => {
    const { container } = render(
      <SimpleMarkdown text={"- item one\n- item two"} />
    );
    const items = container.querySelectorAll("ul li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("item one");
    expect(items[1]).toHaveTextContent("item two");
  });

  it("supports inline formatting within list items", () => {
    const { container } = render(<SimpleMarkdown text="- **bold item**" />);
    const li = container.querySelector("li");
    expect(within(li).getByText("bold item").tagName).toBe("STRONG");
  });

  it("renders numbered lists", () => {
    const { container } = render(
      <SimpleMarkdown text={"1. first\n2. second"} />
    );
    const items = container.querySelectorAll("ol li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("first");
    expect(items[1]).toHaveTextContent("second");
  });

  it("interleaves lists and paragraphs as separate blocks", () => {
    const { container } = render(
      <SimpleMarkdown text={"- bullet\n\nplain paragraph after"} />
    );
    expect(container.querySelectorAll("ul li")).toHaveLength(1);
    expect(screen.getByText(/plain paragraph after/)).toBeInTheDocument();
  });

  it("renders a horizontal rule from ---", () => {
    const { container } = render(<SimpleMarkdown text={"above\n---\nbelow"} />);
    expect(container.querySelector("hr")).toBeInTheDocument();
    expect(screen.getByText("above")).toBeInTheDocument();
    expect(screen.getByText("below")).toBeInTheDocument();
  });

  // The renderer has no markdown link/blockquote handlers — those tokens pass
  // through as plain text. These assertions document that actual behavior.
  it("passes markdown links through as literal text", () => {
    const { container } = render(
      <SimpleMarkdown text="See [docs](https://example.com) here" />
    );
    expect(container.textContent).toContain("[docs](https://example.com)");
  });

  it("passes blockquotes through as literal text", () => {
    render(<SimpleMarkdown text="> quoted line" />);
    expect(screen.getByText("> quoted line")).toBeInTheDocument();
  });

  it("mixes headings, code, and lists in a single message", () => {
    const { container } = render(
      <SimpleMarkdown text={"# Summary\n\n- point a\n- point b\n\n```sh\necho hi\n```"} />
    );
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelector("pre").textContent).toContain("echo hi");
  });
});
