import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  SendIcon,
  BackIcon,
  SettingsIcon,
  SearchIcon,
  PlusIcon,
  CopyIcon,
  TrashIcon,
  MicIcon,
  SpeakerIcon,
  PinIcon,
  StarIcon,
  DoubleCheck,
  StatusDot,
  TypingDots,
  KebabMenuIcon,
} from "./Icons.jsx";

describe("Icons", () => {
  const svgIcons = [
    ["SendIcon", SendIcon],
    ["BackIcon", BackIcon],
    ["SettingsIcon", SettingsIcon],
    ["SearchIcon", SearchIcon],
    ["PlusIcon", PlusIcon],
    ["CopyIcon", CopyIcon],
    ["TrashIcon", TrashIcon],
    ["MicIcon", MicIcon],
    ["SpeakerIcon", SpeakerIcon],
    ["PinIcon", PinIcon],
    ["StarIcon", StarIcon],
    ["KebabMenuIcon", KebabMenuIcon],
  ];

  it.each(svgIcons)("%s renders an <svg>", (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("DoubleCheck renders an <svg> using the provided color", () => {
    const { container } = render(<DoubleCheck color="#22d3ee" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("stroke", "#22d3ee");
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("StatusDot renders a status-colored circle", () => {
    const { container } = render(
      <StatusDot status="connected" border="#ffffff" />
    );
    const dot = container.firstChild;
    expect(dot).toBeInTheDocument();
    expect(dot.style.backgroundColor).toBe("rgb(34, 197, 94)");
    expect(dot.style.border).toContain("rgb(255, 255, 255)");
  });

  it("StatusDot maps each known status to its color", () => {
    const cases = [
      ["connecting", "rgb(245, 158, 11)"],
      ["disconnected", "rgb(85, 85, 104)"],
      ["error", "rgb(239, 68, 68)"],
    ];
    for (const [status, color] of cases) {
      const { container, unmount } = render(<StatusDot status={status} />);
      expect(container.firstChild.style.backgroundColor).toBe(color);
      unmount();
    }
  });

  it("StatusDot falls back to gray for unknown statuses", () => {
    const { container } = render(<StatusDot status="weird" />);
    expect(container.firstChild.style.backgroundColor).toBe("rgb(85, 85, 104)");
  });

  it("TypingDots renders three animated dot spans", () => {
    const { container } = render(<TypingDots color="#818cf8" />);
    const outer = container.firstChild;
    expect(outer).toBeInTheDocument();
    expect(outer.querySelectorAll("span")).toHaveLength(3);
    expect(container.querySelectorAll("span")).toHaveLength(4);
  });
});
