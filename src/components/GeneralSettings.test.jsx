import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GeneralSettings } from "./GeneralSettings.jsx";

vi.mock("../utils/modelRegistry.js", () => ({
  detectLocalModels: vi.fn(),
  formatBytes: vi.fn((b) => `${b} B`),
  loadMediaPipe: vi.fn(),
  getPreferredBackend: vi.fn(() => "cpu"),
  setPreferredBackend: vi.fn(),
  reloadMediaPipeWithBackend: vi.fn(async () => true),
}));

vi.mock("../utils/localModels.js", () => ({
  modelServerToBot: vi.fn(() => ({ id: "server-bot", name: "llama3.2", protocol: "hermes" })),
}));

import { detectLocalModels, loadMediaPipe } from "../utils/modelRegistry.js";

const ON_DEVICE = {
  id: "gemma-e4b",
  name: "Gemma 3n E4B",
  fileName: "gemma.task",
  kind: "ondevice",
  sizeBytes: 1000,
  loaded: false,
  path: "/m/gemma.task",
};

const SERVER = {
  id: "ollama-llama3.2",
  name: "llama3.2",
  kind: "server",
  path: "http://127.0.0.1:11434",
};

beforeEach(() => {
  vi.clearAllMocks();
  detectLocalModels.mockResolvedValue({ sources: [] });
});

describe("GeneralSettings", () => {
  it("renders the Settings header and scans for models on mount", async () => {
    render(<GeneralSettings onBack={() => {}} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    await waitFor(() => expect(detectLocalModels).toHaveBeenCalled());
  });

  it("lists on-device and server models from the scan", async () => {
    detectLocalModels.mockResolvedValue({
      sources: [
        { id: "ondevice", name: "On-device (MediaPipe)", models: [ON_DEVICE] },
        { id: "servers", name: "Local servers", models: [SERVER] },
      ],
    });
    render(<GeneralSettings onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Gemma 3n E4B")).toBeInTheDocument());
    expect(screen.getByText("llama3.2")).toBeInTheDocument();
    expect(screen.getByText("Load")).toBeInTheDocument();
    expect(screen.getByText("Add bot")).toBeInTheDocument();
  });

  it("loads an on-device model and calls onSelectLocalModel", async () => {
    detectLocalModels.mockResolvedValue({
      sources: [{ id: "ondevice", name: "On-device", models: [ON_DEVICE] }],
    });
    loadMediaPipe.mockResolvedValue({ loadModel: vi.fn(async () => ({ ok: true })) });
    const onSelect = vi.fn();
    render(<GeneralSettings onBack={() => {}} onSelectLocalModel={onSelect} />);
    await waitFor(() => expect(screen.getByText("Load")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Load"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(ON_DEVICE));
  });

  it("adds a server model as a bot", async () => {
    detectLocalModels.mockResolvedValue({
      sources: [{ id: "servers", name: "Local servers", models: [SERVER] }],
    });
    const onAdd = vi.fn();
    render(<GeneralSettings onBack={() => {}} onAddServerBot={onAdd} />);
    await waitFor(() => expect(screen.getByText("Add bot")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Add bot"));
    expect(onAdd).toHaveBeenCalledWith(SERVER, SERVER.path);
  });

  it("opens Private Local chat", async () => {
    const onChat = vi.fn();
    render(<GeneralSettings onBack={() => {}} onChatLocal={onChat} />);
    fireEvent.click(screen.getByText("Private Local"));
    expect(onChat).toHaveBeenCalled();
  });

  it("shows an empty-state error when nothing is found", async () => {
    detectLocalModels.mockResolvedValue({ sources: [] });
    render(<GeneralSettings onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/No local models found/)).toBeInTheDocument()
    );
  });
});
