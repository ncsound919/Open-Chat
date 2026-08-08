/**
 * aiAppRecipes — package-name + prompt-entry recipe per phone AI app so the
 * Skill Pack Runtime can reliably drive each one via PhoneControl. Verify
 * package names on the actual device and extend as needed.
 */

export const AI_APPS = {
  perplexity: {
    name: "Perplexity",
    package: "com.perplexity.android",
    promptEntry: "search",
  },
  gemini: {
    name: "Gemini",
    package: "com.google.android.apps.gemini",
    promptEntry: "chat",
  },
  claude: {
    name: "Claude",
    package: "com.anthropic.claude",
    promptEntry: "message",
  },
  deepseek: {
    name: "DeepSeek",
    package: "com.deepseek.chat",
    promptEntry: "input",
  },
  notebooklm: {
    name: "NotebookLM",
    package: "com.google.notebooklm",
    promptEntry: "note",
  },
};

export function recipeFor(handle) {
  return AI_APPS[String(handle).toLowerCase()] ?? null;
}

export function appByHandle(handleOrPackage) {
  const h = String(handleOrPackage).toLowerCase();
  if (AI_APPS[h]) return AI_APPS[h];
  return Object.values(AI_APPS).find((a) => a.package === h) ?? null;
}
