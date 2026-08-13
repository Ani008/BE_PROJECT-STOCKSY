import api from "./api";

/**
 * Fetch the logged-in user's trade journal entries, newest first.
 * GET /api/journal
 */
export async function fetchJournalEntries(limit = 30) {
  const response = await api.get("/journal", { params: { limit } });
  return response.data.entries;
}

/**
 * Fetch a single journal entry (full card detail).
 * GET /api/journal/:id
 */
export async function fetchJournalEntry(id) {
  const response = await api.get(`/journal/${id}`);
  return response.data.entry;
}

/**
 * Weekly pattern view — which mistake/success patterns showed up most
 * often in the last 7 days, and their average P&L.
 * GET /api/journal/patterns
 */
export async function fetchWeeklyPatterns() {
  const response = await api.get("/journal/patterns");
  return response.data;
}
