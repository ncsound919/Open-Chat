import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { OnDeviceInsights } from "./OnDeviceInsights.jsx";

vi.mock("../utils/OnDeviceAI.js", () => ({
  isAvailable: vi.fn(() => Promise.resolve(true)),
  generateStream: vi.fn(),
  buildInsightPrompt: vi.fn(() => "test prompt"),
}));

import {
  isAvailable,
  generateStream,
  buildInsightPrompt,
} from "../utils/OnDeviceAI.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  isAvailable.mockImplementation(() => Promise.resolve(true));
  buildInsightPrompt.mockImplementation(() => "test prompt");
});

describe("OnDeviceInsights", () => {
  it("renders nothing when on-device AI is unavailable", async () => {
    isAvailable.mockImplementation(() => Promise.resolve(false));
    const { container } = render(
      <OnDeviceInsights botMessage="bot reply" userMessage="user ask" />
    );
    await act(async () => {});
    expect(container.firstChild).toBeNull();
  });

  it("shows the checking state while availability is pending and toggles the panel", async () => {
    isAvailable.mockImplementation(() => new Promise(() => {}));
    const { container } = render(
      <OnDeviceInsights
        botMessage="bot reply"
        userMessage="user ask"
        accentColor={null}
      />
    );
    const button = screen.getByRole("button");

    expect(button).toHaveTextContent("On-device insights …");
    expect(button).toHaveStyle({ color: "#818cf8" });
    expect(container.querySelector("div")).toHaveStyle({ maxWidth: "100%" });

    fireEvent.click(button);
    expect(screen.getByText(/Checking for on-device AI/)).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByText(/Checking for on-device AI/)).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByText(/Checking for on-device AI/)).toBeInTheDocument();
  });

  it("generates, streams, and completes insights when opened", async () => {
    const d = deferred();
    let onChunk;
    let capturedSignal;
    generateStream.mockImplementation((prompt, chunkCb, opts) => {
      expect(prompt).toBe("test prompt");
      onChunk = chunkCb;
      capturedSignal = opts.signal;
      return d.promise;
    });

    const { container } = render(
      <OnDeviceInsights
        botMessage="bot reply"
        userMessage="user ask"
        accentColor="#22d3ee"
        width="300px"
      />
    );
    const button = await screen.findByRole("button", {
      name: /On-device insights/,
    });
    fireEvent.click(button);

    expect(buildInsightPrompt).toHaveBeenCalledWith("bot reply", "user ask");
    expect(generateStream).toHaveBeenCalledWith(
      "test prompt",
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    expect(screen.getByText(/Thinking on-device/)).toBeInTheDocument();
    expect(screen.getByText(/generating/)).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveStyle({ color: "#22d3ee" });
    expect(container.firstChild).toHaveStyle({ maxWidth: "300px" });

    await act(async () => {
      onChunk("Hello ");
    });
    expect(screen.getByText(/Hello/)).toBeInTheDocument();
    expect(screen.getByText(/generating/)).toBeInTheDocument();

    await act(async () => {
      onChunk("world");
    });
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();

    await act(async () => {
      d.resolve("Hello world");
    });
    expect(await screen.findByText(/Gemini Nano/)).toBeInTheDocument();
    expect(screen.queryByText(/generating/)).not.toBeInTheDocument();
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    // A completed generation must NOT abort its own signal (the signal is only
    // aborted on unmount / retry / re-open).
    expect(capturedSignal.aborted).toBe(false);
  });

  it("aborts the in-flight generation when unmounted", async () => {
    const d = deferred();
    let capturedSignal;
    generateStream.mockImplementation((prompt, onChunk, opts) => {
      capturedSignal = opts.signal;
      return d.promise;
    });

    const { unmount } = render(
      <OnDeviceInsights botMessage="bot reply" userMessage="user ask" />
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /On-device insights/ })
    );

    unmount();
    expect(capturedSignal.aborted).toBe(true);
  });

  it("shows the error state and recovers via Retry", async () => {
    const d1 = deferred();
    const d2 = deferred();
    let onChunk2;
    let call = 0;
    generateStream.mockImplementation((prompt, onChunk) => {
      call += 1;
      if (call === 1) return d1.promise;
      onChunk2 = onChunk;
      return d2.promise;
    });

    render(<OnDeviceInsights botMessage="bot reply" userMessage="user ask" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /On-device insights/ })
    );

    await act(async () => {
      d1.reject(new Error("boom"));
    });

    expect(screen.getByText("boom")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeInTheDocument();

    fireEvent.click(retry);
    await waitFor(() => expect(onChunk2).toBeDefined());

    await act(async () => {
      onChunk2("recovered");
      d2.resolve("recovered");
    });
    expect(await screen.findByText(/Gemini Nano/)).toBeInTheDocument();
    expect(screen.getByText(/recovered/)).toBeInTheDocument();
  });

  it("ignores AbortError without surfacing an error state", async () => {
    const d = deferred();
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    generateStream.mockImplementation(() => d.promise);

    render(<OnDeviceInsights botMessage="bot reply" userMessage="user ask" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /On-device insights/ })
    );

    await act(async () => {
      d.reject(abortErr);
    });

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByText(/Thinking on-device/)).toBeInTheDocument();
  });

  it("falls back to a default message when the error has no message", async () => {
    const d1 = deferred();
    const d2 = deferred();
    let onChunk2;
    let call = 0;
    generateStream.mockImplementation((prompt, onChunk) => {
      call += 1;
      if (call === 1) return d1.promise;
      onChunk2 = onChunk;
      return d2.promise;
    });

    render(<OnDeviceInsights botMessage="bot reply" userMessage="user ask" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /On-device insights/ })
    );

    await act(async () => {
      d1.reject(new Error());
    });

    expect(
      screen.getByText("On-device generation failed.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onChunk2).toBeDefined());
    await act(async () => {
      onChunk2("ok");
      d2.resolve("ok");
    });
    expect(await screen.findByText(/Gemini Nano/)).toBeInTheDocument();
  });
});
