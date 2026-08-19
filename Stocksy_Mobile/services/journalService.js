import api from "./api";

/**
 * Fetch the logged-in user's trade journal entries, newest first.
 * GET /api/journal
 *
 * @param {number} [limit=30]
 * @param {object} [filters]
 * @param {'week'|'month'|'all'} [filters.range] — omit for no date filter
 * @param {string} [filters.ruleId] — only entries where this rule fired
 *   (used by the "top keyword" chips)
 */
export async function fetchJournalEntries(limit = 30, { range, ruleId } = {}) {
  const response = await api.get("/journal", {
    params: {
      limit,
      ...(range ? { range } : {}),
      ...(ruleId ? { rule_id: ruleId } : {}),
    },
  });
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
 * often in the last 7 days, and their average P&L. Always a fixed 7-day
 * window — this backs the narrative card, not a filter control.
 * GET /api/journal/patterns
 */
export async function fetchWeeklyPatterns() {
  const response = await api.get("/journal/patterns");
  return response.data;
}

/**
 * Top 5 most-frequent rule "keywords" over a selectable range, sorted by
 * frequency. Meant to back clickable filter chips — tap one, then call
 * fetchJournalEntries(limit, { ruleId }) to see just those trades.
 * GET /api/journal/keywords
 *
 * @param {'week'|'month'|'all'} [range='month']
 */
export async function fetchTopKeywords(range = "month") {
  const response = await api.get("/journal/keywords", { params: { range } });
  return response.data;
}
