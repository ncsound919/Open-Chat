/**
 * IndexedDB utilities for Open-Chat
 * Provides scalable storage for messages, search indexing, and context management
 */

const DB_NAME = "OpenChatDB";
const DB_VERSION = 1;

// Object store names
const STORES = {
  MESSAGES: "messages",
  SEARCH_INDEX: "searchIndex",
  CONTEXT: "context",
  MEMORY: "memory",
};

// Cached database connection promise – reused across all operations
let dbPromise = null;

/**
 * Open or create the IndexedDB database.
 * The connection is cached so subsequent calls reuse the same handle.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null; // Allow retry after error
      reject(request.error);
    };
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => {
      console.warn("OpenChatDB: upgrade blocked by another open connection");
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Messages store: indexed by channel/bot ID and timestamp
      if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
        const msgStore = db.createObjectStore(STORES.MESSAGES, {
          keyPath: "id",
          autoIncrement: false,
        });
        msgStore.createIndex("channelId", "channelId", { unique: false });
        msgStore.createIndex("timestamp", "timestamp", { unique: false });
        msgStore.createIndex("role", "role", { unique: false });
        msgStore.createIndex("channelTimestamp", ["channelId", "timestamp"], {
          unique: false,
        });
      }

      // Search index store: for full-text search
      if (!db.objectStoreNames.contains(STORES.SEARCH_INDEX)) {
        const searchStore = db.createObjectStore(STORES.SEARCH_INDEX, {
          keyPath: "id",
          autoIncrement: true,
        });
        searchStore.createIndex("messageId", "messageId", { unique: false });
        searchStore.createIndex("term", "term", { unique: false });
        searchStore.createIndex("channelId", "channelId", { unique: false });
      }

      // Context store: for context injection and management
      if (!db.objectStoreNames.contains(STORES.CONTEXT)) {
        const contextStore = db.createObjectStore(STORES.CONTEXT, {
          keyPath: "id",
        });
        contextStore.createIndex("channelId", "channelId", { unique: false });
        contextStore.createIndex("type", "type", { unique: false });
      }

      // Memory store: for agent memory and summaries
      if (!db.objectStoreNames.contains(STORES.MEMORY)) {
        const memoryStore = db.createObjectStore(STORES.MEMORY, {
          keyPath: "id",
        });
        memoryStore.createIndex("channelId", "channelId", { unique: false });
        memoryStore.createIndex("agentId", "agentId", { unique: false });
        memoryStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
}

/**
 * Save a message to IndexedDB
 * @param {Object} message - Message object with id, channelId, role, text, timestamp
 * @returns {Promise<void>}
 */
export async function saveMessage(message) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MESSAGES], "readwrite");
    const store = transaction.objectStore(STORES.MESSAGES);

    const request = store.put(message);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all messages for a channel/bot
 * @param {string} channelId - Channel or bot ID
 * @param {number} limit - Maximum number of messages to retrieve
 * @returns {Promise<Array>}
 */
export async function getMessages(channelId, limit = 1000) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MESSAGES], "readonly");
    const store = transaction.objectStore(STORES.MESSAGES);
    const index = store.index("channelTimestamp");

    // Get messages for this channel, ordered by timestamp
    const range = IDBKeyRange.bound([channelId, 0], [channelId, Date.now()]);
    const request = index.getAll(range, limit);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a message from IndexedDB
 * @param {string} messageId - Message ID to delete
 * @returns {Promise<void>}
 */
export async function deleteMessage(messageId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MESSAGES], "readwrite");
    const store = transaction.objectStore(STORES.MESSAGES);

    const request = store.delete(messageId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all messages for a channel/bot
 * @param {string} channelId - Channel or bot ID
 * @returns {Promise<number>} Number of messages deleted
 */
export async function clearChannelMessages(channelId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MESSAGES], "readwrite");
    const store = transaction.objectStore(STORES.MESSAGES);
    const index = store.index("channelId");

    let count = 0;

    transaction.oncomplete = () => resolve(count);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);

    const request = index.openCursor(IDBKeyRange.only(channelId));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        count++;
        cursor.continue();
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Index a message for full-text search
 * Tokenizes the message text and creates search index entries
 * @param {Object} message - Message object
 * @returns {Promise<void>}
 */
export async function indexMessage(message) {
  if (!message.text || message.role !== "assistant") {
    return; // Only index assistant messages
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.SEARCH_INDEX], "readwrite");
    const store = transaction.objectStore(STORES.SEARCH_INDEX);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);

    // De-duplicate terms within the current message text.
    const terms = [...new Set(tokenize(message.text).map((term) => term.toLowerCase()))];

    // Remove any existing index entries for this message so re-indexing does not
    // accumulate duplicate rows when the store uses an auto-increment primary key.
    const deleteExistingRequest = store.openCursor();

    deleteExistingRequest.onerror = () => reject(deleteExistingRequest.error);
    deleteExistingRequest.onsuccess = (event) => {
      const cursor = event.target.result;

      if (cursor) {
        if (cursor.value.messageId === message.id) {
          const deleteRequest = cursor.delete();
          deleteRequest.onerror = () => reject(deleteRequest.error);
        }
        cursor.continue();
        return;
      }

      // Re-create index entries for the current set of terms.
      terms.forEach((term) => {
        const entry = {
          messageId: message.id,
          channelId: message.channelId,
          term,
          timestamp: message.timestamp,
        };

        const addRequest = store.add(entry);
        addRequest.onerror = () => reject(addRequest.error);
      });
    };
  });
}

/**
 * Tokenize text for search indexing
 * Splits on whitespace and punctuation, filters stop words
 */
function tokenize(text) {
  // Remove markdown/code blocks for cleaner indexing
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .toLowerCase();

  // Split on non-word characters
  const words = cleaned.split(/\W+/).filter((w) => w.length > 2);

  // Remove common stop words
  const stopWords = new Set([
    "the",
    "is",
    "at",
    "which",
    "on",
    "and",
    "or",
    "but",
    "in",
    "with",
    "for",
    "to",
    "of",
    "a",
    "an",
  ]);

  return words.filter((w) => !stopWords.has(w));
}

/**
 * Search messages by keyword(s)
 * @param {string} query - Search query
 * @param {string} channelId - Optional channel ID to filter
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of message IDs matching the search
 */
export async function searchMessages(query, channelId = null, limit = 100) {
  const db = await openDatabase();

  // Tokenize search query
  const searchTerms = tokenize(query);
  if (searchTerms.length === 0) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.SEARCH_INDEX, STORES.MESSAGES], "readonly");
    const indexStore = transaction.objectStore(STORES.SEARCH_INDEX);
    const msgStore = transaction.objectStore(STORES.MESSAGES);

    // Find message IDs matching any search term
    const messageIds = new Set();
    let pending = searchTerms.length;

    searchTerms.forEach((term) => {
      const index = indexStore.index("term");
      const request = index.openCursor(IDBKeyRange.only(term.toLowerCase()));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          // Filter by channel if specified
          if (!channelId || cursor.value.channelId === channelId) {
            messageIds.add(cursor.value.messageId);
          }
          cursor.continue();
        } else {
          pending--;
          if (pending === 0) {
            // Fetch the actual messages
            fetchMessages(Array.from(messageIds).slice(0, limit));
          }
        }
      };

      request.onerror = () => reject(request.error);
    });

    function fetchMessages(ids) {
      const messages = [];
      let fetched = 0;

      ids.forEach((id) => {
        const request = msgStore.get(id);
        request.onsuccess = () => {
          if (request.result) {
            messages.push(request.result);
          }
          fetched++;
          if (fetched === ids.length) {
            // Sort by timestamp descending (most recent first)
            messages.sort((a, b) => b.timestamp - a.timestamp);
            resolve(messages);
          }
        };
        request.onerror = () => reject(request.error);
      });

      if (ids.length === 0) {
        resolve([]);
      }
    }
  });
}

/**
 * Save context data
 * @param {Object} context - Context object with id, channelId, type, data
 * @returns {Promise<void>}
 */
export async function saveContext(context) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.CONTEXT], "readwrite");
    const store = transaction.objectStore(STORES.CONTEXT);

    const request = store.put(context);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get context for a channel
 * @param {string} channelId - Channel ID
 * @returns {Promise<Array>}
 */
export async function getContext(channelId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.CONTEXT], "readonly");
    const store = transaction.objectStore(STORES.CONTEXT);
    const index = store.index("channelId");

    const request = index.getAll(IDBKeyRange.only(channelId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Export all messages as JSON
 * @returns {Promise<Object>} All messages grouped by channel
 */
export async function exportMessages() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MESSAGES], "readonly");
    const store = transaction.objectStore(STORES.MESSAGES);

    const request = store.getAll();
    request.onsuccess = () => {
      const messages = request.result || [];

      // Group by channel
      const grouped = {};
      messages.forEach((msg) => {
        if (!grouped[msg.channelId]) {
          grouped[msg.channelId] = [];
        }
        grouped[msg.channelId].push(msg);
      });

      resolve(grouped);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Import messages from JSON
 * @param {Object} data - Messages grouped by channel
 * @returns {Promise<number>} Number of messages imported
 */
export async function importMessages(data) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MESSAGES], "readwrite");
    const store = transaction.objectStore(STORES.MESSAGES);

    let count = 0;
    const channels = Object.values(data);

    channels.forEach((messages) => {
      messages.forEach((msg) => {
        store.put(msg);
        count++;
      });
    });

    transaction.oncomplete = () => resolve(count);
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Check if IndexedDB is supported
 */
export function isIndexedDBSupported() {
  return typeof indexedDB !== "undefined";
}

/**
 * Get database storage usage estimate
 * @returns {Promise<Object>} Storage quota and usage
 */
export async function getStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate();
  }
  return { quota: 0, usage: 0 };
}
