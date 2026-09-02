import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KeywireVault } from "./KeywireVault.jsx";

const json = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => payload,
});

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => json([]));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const baseConfig = { baseUrl: "", token: "", projectId: "", envSlug: "" };

describe("KeywireVault", () => {
  it("renders the connection form and save control", () => {
    render(<KeywireVault config={baseConfig} onSaveConfig={vi.fn()} />);
    expect(screen.getByLabelText("Keywire vault URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Keywire vault token")).toBeInTheDocument();
    expect(screen.getByText("Test connection")).toBeInTheDocument();
    expect(screen.getByText("Keywire Vault")).toBeInTheDocument();
  });

  it("reports reachable after a successful test connection", async () => {
    fetchMock.mockResolvedValueOnce(json({})); // /api/v1/metrics
    render(<KeywireVault config={baseConfig} onSaveConfig={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Keywire vault URL"), {
      target: { value: "http://127.0.0.1:3000" },
    });
    fireEvent.change(screen.getByLabelText("Keywire vault token"), {
      target: { value: "vault-tok" },
    });
    fireEvent.click(screen.getByText("Test connection"));
    await waitFor(() => expect(screen.getByText("Keywire reachable.")).toBeInTheDocument());
  });

  it("loads projects from the vault into the selector", async () => {
    // Mount effect lists projects directly (no health call first).
    fetchMock.mockResolvedValueOnce(json([{ id: "p1", name: "Overlay365", slug: "overlay" }]));
    render(
      <KeywireVault
        config={{ baseUrl: "http://127.0.0.1:3000", token: "t", projectId: "", envSlug: "" }}
        onSaveConfig={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText("Overlay365")).toBeInTheDocument());
  });
});
