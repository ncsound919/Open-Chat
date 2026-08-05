import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchResults } from "./SearchResults.jsx";

const bots = [
  { id: "b1", name: "Hermes Bot" },
  { id: "b2", name: "Claw Bot" },
];

const results = [
  { botId: "b1", time: "10:30 AM", message: { text: "first match" } },
  { botId: "b2", message: { text: "second match" } },
  { botId: "ghost", time: "9:00 AM", message: { text: "no bot record" } },
];

describe("SearchResults", () => {
  it("renders the query header and result count", () => {
    render(
      <SearchResults query="match" results={results} bots={bots} onSelect={vi.fn()} onBack={vi.fn()} />
    );
    expect(screen.getByText(/Messages matching “match”/)).toBeInTheDocument();
    expect(screen.getByText("3 results")).toBeInTheDocument();
  });

  it("uses the singular result label for a single match", () => {
    render(
      <SearchResults query="x" results={[results[0]]} bots={bots} onSelect={vi.fn()} onBack={vi.fn()} />
    );
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("renders bot names via the bots lookup and falls back to botId", () => {
    render(
      <SearchResults query="match" results={results} bots={bots} onSelect={vi.fn()} onBack={vi.fn()} />
    );
    expect(screen.getByText(/Hermes Bot/)).toBeInTheDocument();
    expect(screen.getByText(/Claw Bot/)).toBeInTheDocument();
    expect(screen.getByText(/ghost/)).toBeInTheDocument();
  });

  it("renders the timestamp when present and always the message text", () => {
    render(
      <SearchResults query="match" results={results} bots={bots} onSelect={vi.fn()} onBack={vi.fn()} />
    );
    expect(screen.getByText(/10:30 AM/)).toBeInTheDocument();
    expect(screen.getByText("first match")).toBeInTheDocument();
    expect(screen.getByText("second match")).toBeInTheDocument();
  });

  it("calls onSelect with the botId when a result row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <SearchResults query="match" results={results} bots={bots} onSelect={onSelect} onBack={vi.fn()} />
    );
    fireEvent.click(screen.getByText("second match").closest("button"));
    expect(onSelect).toHaveBeenCalledWith("b2");
  });

  it("calls onBack when the back button is clicked", () => {
    const onBack = vi.fn();
    const { container } = render(
      <SearchResults query="match" results={results} bots={bots} onSelect={vi.fn()} onBack={onBack} />
    );
    fireEvent.click(container.querySelector("button"));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows the empty state when there are no results", () => {
    render(
      <SearchResults query="none" results={[]} bots={bots} onSelect={vi.fn()} onBack={vi.fn()} />
    );
    expect(screen.getByText("No messages match this search.")).toBeInTheDocument();
    expect(screen.getByText("0 results")).toBeInTheDocument();
  });
});
