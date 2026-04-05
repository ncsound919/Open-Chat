/**
 * Encryption utilities for securing sensitive data in localStorage
 * Uses Web Crypto API for AES-GCM encryption
 */

/**
 * Generate a cryptographic key from a passphrase
 * Uses PBKDF2 for key derivation
 */
async function deriveKey(passphrase, salt) {
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt data using AES-GCM
 * @param {string} data - Data to encrypt
 * @param {string} passphrase - Encryption passphrase
 * @returns {Promise<string>} Base64-encoded encrypted data with IV
 */
export async function encrypt(data, passphrase) {
  try {
    if (!passphrase || passphrase.length < 8) {
      throw new Error("Passphrase must be at least 8 characters");
    }

    const encoder = new TextEncoder();
    const salt = "openchat-v1"; // Static salt for key derivation
    const key = await deriveKey(passphrase, salt);

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(data)
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Return as base64
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("Encryption failed:", error);
    throw new Error("Failed to encrypt data");
  }
}

/**
 * Decrypt data using AES-GCM
 * @param {string} encryptedData - Base64-encoded encrypted data
 * @param {string} passphrase - Decryption passphrase
 * @returns {Promise<string>} Decrypted data
 */
export async function decrypt(encryptedData, passphrase) {
  try {
    if (!passphrase || passphrase.length < 8) {
      throw new Error("Passphrase must be at least 8 characters");
    }

    const salt = "openchat-v1";
    const key = await deriveKey(passphrase, salt);

    // Decode from base64
    const combined = new Uint8Array(
      atob(encryptedData)
        .split("")
        .map((c) => c.charCodeAt(0))
    );

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt data - wrong passphrase or corrupted data");
  }
}

/**
 * Check if encryption is available
 * Web Crypto API requires HTTPS or localhost
 */
export function isEncryptionAvailable() {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.subtle.encrypt === "function"
  );
}

/**
 * Generate a secure random passphrase
 * Useful for automatic encryption key generation
 */
export function generatePassphrase(length = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((x) => chars[x % chars.length])
    .join("");
}

/**
 * Encrypt bot configuration (tokens, etc.)
 * @param {Object} bot - Bot configuration
 * @param {string} passphrase - Encryption passphrase
 * @returns {Promise<Object>} Bot with encrypted sensitive fields
 */
export async function encryptBotConfig(bot, passphrase) {
  const sensitiveFields = ["token"];
  const encrypted = { ...bot };

  for (const field of sensitiveFields) {
    if (bot[field]) {
      encrypted[field] = await encrypt(bot[field], passphrase);
      encrypted[`${field}_encrypted`] = true;
    }
  }

  return encrypted;
}

/**
 * Decrypt bot configuration
 * @param {Object} bot - Bot configuration with encrypted fields
 * @param {string} passphrase - Decryption passphrase
 * @returns {Promise<Object>} Bot with decrypted sensitive fields
 */
export async function decryptBotConfig(bot, passphrase) {
  const sensitiveFields = ["token"];
  const decrypted = { ...bot };

  for (const field of sensitiveFields) {
    if (bot[`${field}_encrypted`]) {
      try {
        decrypted[field] = await decrypt(bot[field], passphrase);
        delete decrypted[`${field}_encrypted`];
      } catch (error) {
        console.error(`Failed to decrypt ${field}:`, error);
        // Keep encrypted value if decryption fails
      }
    }
  }

  return decrypted;
}

/**
 * Store encryption passphrase in sessionStorage
 * This is cleared when the browser tab/window is closed
 * More secure than keeping in memory or localStorage
 */
const PASSPHRASE_KEY = "openchat_enc_pass";

export function setSessionPassphrase(passphrase) {
  try {
    sessionStorage.setItem(PASSPHRASE_KEY, passphrase);
  } catch (error) {
    console.error("Failed to store passphrase:", error);
  }
}

export function getSessionPassphrase() {
  try {
    return sessionStorage.getItem(PASSPHRASE_KEY);
  } catch (error) {
    console.error("Failed to retrieve passphrase:", error);
    return null;
  }
}

export function clearSessionPassphrase() {
  try {
    sessionStorage.removeItem(PASSPHRASE_KEY);
  } catch (error) {
    console.error("Failed to clear passphrase:", error);
  }
}
