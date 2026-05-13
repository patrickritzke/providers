// ── API Logger ────────────────────────────────────────────────────────────────
// Persists request/response logs to chrome.storage.local.
// Each log entry: { id, timestamp, action, url, requestBody, status, responseBody, durationMs, error }

const LOG_KEY = 'api_logs';
const MAX_LOGS = 100;

const Logger = {
  async add(entry) {
    return new Promise((resolve) => {
      chrome.storage.local.get(LOG_KEY, (result) => {
        const logs = result[LOG_KEY] || [];
        logs.unshift(entry); // newest first
        if (logs.length > MAX_LOGS) logs.splice(MAX_LOGS);
        chrome.storage.local.set({ [LOG_KEY]: logs }, resolve);
      });
    });
  },

  async getAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get(LOG_KEY, (result) => {
        resolve(result[LOG_KEY] || []);
      });
    });
  },

  async clear() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(LOG_KEY, resolve);
    });
  },

  // Wraps a SOAP fetch call, logs request + response, returns response text
  async trackedSoapCall(url, action, body) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const timestamp = new Date().toISOString();
    const start = performance.now();

    // Log the outgoing request immediately
    const requestEntry = {
      id,
      timestamp,
      action,
      url,
      requestBody: body,
      status: null,
      responseBody: null,
      durationMs: null,
      error: null,
      pending: true,
    };
    await Logger.add(requestEntry);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': action,
        },
        body,
      });

      const durationMs = Math.round(performance.now() - start);
      const responseBody = await response.text();

      // Update the log entry with response details
      await Logger._updateEntry(id, {
        status: response.status,
        responseBody,
        durationMs,
        pending: false,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return responseBody;

    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      await Logger._updateEntry(id, {
        status: null,
        responseBody: null,
        durationMs,
        error: err.message,
        pending: false,
      });
      throw err;
    }
  },

  async _updateEntry(id, updates) {
    return new Promise((resolve) => {
      chrome.storage.local.get(LOG_KEY, (result) => {
        const logs = result[LOG_KEY] || [];
        const idx = logs.findIndex(l => l.id === id);
        if (idx !== -1) Object.assign(logs[idx], updates);
        chrome.storage.local.set({ [LOG_KEY]: logs }, resolve);
      });
    });
  },
};
