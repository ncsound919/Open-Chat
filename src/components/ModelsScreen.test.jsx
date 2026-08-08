import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelsScreen } from "./ModelsScreen.jsx";

vi.mock("../utils/modelRegistry.js", () => {
  const detect = vi.fn(async () => ({
    sources: [
      {
        id: "ondevice",
        name: "On-device (MediaPipe)",
        models: [
          {
            id: "gemma-e4b",
            name: "Gemma 3n E4B",
            fileName: "gemma-3n-E4B-it-int4.task",
            url: "https://x",
            sizeBytes: 1000,
            kind: "ondevice",
            provider: "mediapipe",
            loaded: true,
            tagline: "Flagship",
          },
        ],
      },
    ],
  }));
  return {
    detectLocalModels: detect,
    MEDIAPIPE_DEFAULT_MODELS: [
      {
        id: "gemma-e4b",
        name: "Gemma 3n E4B",
        fileName: "gemma-3n-E4B-it-int4.task",
        url: "https://x",
        sizeBytes: 4405655031,
        kind: "ondevice",
        tagline: "Flagship",
      },
    ],
    formatBytes: vi.fn((b) => (b ? "1 MB" : "—")),
    loadMediaPipe: vi.fn(async () => null),
    loadPhoneControl: vi.fn(async () => null),
  };
});

vi.mock("../utils/localChat.js", () => ({
  resolveProvider: vi.fn(async () => "mediapipe"),
  PROVIDER: {
    MEDIAPIPE: "mediapipe",
    NANO: "nano",
    WEBLLM: "webllm",
    NONE: "none",
  },
}));

describe("ModelsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the catalog, engine status, and chat action", async () => {
    render(<ModelsScreen onChatLocal={() => {}} />);
    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(await screen.findByText("Gemma 3n E4B")).toBeInTheDocument();
    const chat = screen.getByText("Chat privately");
    fireEvent.click(chat);
  });

  it("calls onChatLocal when Chat privately is clicked", async () => {
    const onChatLocal = vi.fn();
    render(<ModelsScreen onChatLocal={onChatLocal} />);
    fireEvent.click(await screen.findByText("Chat privately"));
    expect(onChatLocal).toHaveBeenCalled();
  });

  it("shows the accessibility enablement card when disabled", async () => {
    render(<ModelsScreen onChatLocal={() => {}} />);
    expect(await screen.findByText(/Enable the accessibility service/i)).toBeInTheDocument();
  });
});
