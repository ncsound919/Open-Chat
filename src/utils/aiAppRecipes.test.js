import { describe, it, expect } from "vitest";
import { AI_APPS, recipeFor, appByHandle } from "./aiAppRecipes.js";

describe("aiAppRecipes", () => {
  it("exposes recipes for the core AI apps", () => {
    for (const key of ["perplexity", "gemini", "claude", "deepseek", "notebooklm"]) {
      expect(AI_APPS[key]).toBeDefined();
      expect(AI_APPS[key].package).toBeTruthy();
    }
  });

  it("resolves a recipe by handle", () => {
    expect(recipeFor("gemini").package).toBe(AI_APPS.gemini.package);
  });

  it("resolves by package name", () => {
    expect(appByHandle("com.google.android.apps.gemini")?.name).toBe("Gemini");
  });
});
