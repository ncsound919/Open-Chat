import React from "react";

/**
 * Simple markdown renderer for chat messages
 * Supports: code blocks, headings, bold, italic, inline code, lists, hr
 */
export function SimpleMarkdown({ text }) {
  if (!text) return null;

  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  // Render inline formatting: `code`, **bold**, *italic*
  const renderInline = (str, key) => {
    const parts = [];
    const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match;
    let idx = 0;

    while ((match = regex.exec(str)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(str.slice(lastIndex, match.index));
      }

      const token = match[0];
      if (token[0] === "`") {
        // Inline code
        parts.push(
          <code
            key={idx++}
            style={{
              background: "#ffffff18",
              borderRadius: 4,
              padding: "1px 5px",
              fontFamily: "monospace",
              fontSize: "0.88em",
            }}
          >
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith("**")) {
        // Bold
        parts.push(<strong key={idx++}>{token.slice(2, -2)}</strong>);
      } else {
        // Italic
        parts.push(<em key={idx++}>{token.slice(1, -1)}</em>);
      }

      lastIndex = match.index + token.length;
    }

    // Add remaining text
    if (lastIndex < str.length) {
      parts.push(str.slice(lastIndex));
    }

    return <span key={key}>{parts}</span>;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <div
          key={i}
          style={{
            margin: "8px 0",
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid #ffffff15",
          }}
        >
          {lang && (
            <div
              style={{
                background: "#ffffff0c",
                padding: "2px 10px",
                fontSize: 11,
                color: "#777",
                fontFamily: "monospace",
              }}
            >
              {lang}
            </div>
          )}
          <pre
            style={{
              background: "#0a0a10",
              padding: "10px 12px",
              margin: 0,
              overflowX: "auto",
              fontSize: 13,
              fontFamily: "monospace",
              lineHeight: 1.6,
              color: "#e2e2f0",
            }}
          >
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>
      );
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const size = [17, 15, 14][headingMatch[1].length - 1];
      elements.push(
        <div
          key={i}
          style={{
            fontWeight: 700,
            fontSize: size,
            margin: "10px 0 3px",
            color: "#f0f0f5",
          }}
        >
          {renderInline(headingMatch[2], i)}
        </div>
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(
          <li key={i} style={{ marginBottom: 2 }}>
            {renderInline(lines[i].slice(2), i)}
          </li>
        );
        i++;
      }
      elements.push(
        <ul key={`ul${i}`} style={{ paddingLeft: 18, margin: "5px 0" }}>
          {items}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(
          <li key={i} style={{ marginBottom: 2 }}>
            {renderInline(lines[i].replace(/^\d+\.\s/, ""), i)}
          </li>
        );
        i++;
      }
      elements.push(
        <ol key={`ol${i}`} style={{ paddingLeft: 18, margin: "5px 0" }}>
          {items}
        </ol>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line)) {
      elements.push(
        <hr
          key={i}
          style={{
            border: "none",
            borderTop: "1px solid #ffffff12",
            margin: "8px 0",
          }}
        />
      );
      i++;
      continue;
    }

    // Empty line
    if (!line.trim()) {
      if (elements.length) {
        elements.push(<div key={i} style={{ height: 5 }} />);
      }
      i++;
      continue;
    }

    // Paragraph
    elements.push(
      <div key={i} style={{ lineHeight: 1.6 }}>
        {renderInline(line, i)}
      </div>
    );
    i++;
  }

  return <div style={{ fontSize: 15 }}>{elements}</div>;
}
