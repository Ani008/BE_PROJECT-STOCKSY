/**
 * services/journalRuleEngine.js
 *
 * Trade Journal insight rules — v1.
 *
 * Deliberately NOT AI/ML: each rule is a plain condition over the entry/exit
 * indicator snapshots, and every rule renders four fixed strings. This is a
 * lookup table with conditions, not a model — same as scoped in the PDF.
 *
 * Every rule produces:
 *   - plainText     — what happened, zero jargon, shown big/bold by default
 *   - technicalText — the actual indicator + number, shown small/collapsed
 *   - whyItHurt     — (optional) why this likely cost money — omitted for
 *                      neutral/positive rules where "hurt" doesn't apply
 *   - tryNextTime   — a process suggestion (timing/patience/sizing), never a
 *                      price prediction or a signal to buy/sell a specific
 *                      stock at a specific future time
 *
 * ctx passed to each rule's condition():
 *   {
 *     side,                 // 'BUY' | 'SELL' (BUY = long round trip, SELL = short)
 *     quantity, entryPrice, exitPrice,
 *     holdingSeconds,
 *     pnl,                  // realised P&L, signed
 *     entry: { rsi, vwap, volume_ratio, ltp } | null,
 *     exit:  { rsi, vwap, volume_ratio, ltp } | null,
 *   }
 *
 * Rules run in order; ALL matching rules fire (a trade can have several
 * tags), not just the first match — that's what makes the weekly pattern
 * view meaningful later.
 */

const RULES = [
  // ── Entry quality ──────────────────────────────────────────────────────
  {
    id: 'overbought_entry_long',
    patternLabel: 'entries chasing a fast price spike (overbought)',
    condition: (ctx) => ctx.side === 'BUY' && ctx.entry?.rsi != null && ctx.entry.rsi > 70,
    plainText: 'You bought right after a fast price spike — the stock may have already run too far, too fast.',
    technicalText: (ctx) => `RSI was ${ctx.entry.rsi} at entry (above the 70 "overbought" line)`,
    whyItHurt: 'You bought at the "excited" price, not the average price. Stocks that spike this fast often cool off a bit before continuing.',
    tryNextTime: 'When a stock has already jumped over 1.5% in a few minutes, wait 5-10 minutes for it to settle before entering.',
  },
  {
    id: 'oversold_entry_short',
    patternLabel: 'short entries chasing a fast drop (oversold)',
    condition: (ctx) => ctx.side === 'SELL' && ctx.entry?.rsi != null && ctx.entry.rsi < 30,
    plainText: 'You sold short right after a fast drop — the stock may have already fallen too far, too fast.',
    technicalText: (ctx) => `RSI was ${ctx.entry.rsi} at entry (below the 30 "oversold" line)`,
    whyItHurt: 'Stocks that drop this fast often bounce back a little before falling further, which can squeeze a fresh short.',
    tryNextTime: 'When a stock has already dropped sharply in a few minutes, wait for it to settle before shorting.',
  },
  {
    id: 'above_vwap_entry',
    patternLabel: 'entries above the average price for the day (late entries)',
    condition: (ctx) => ctx.side === 'BUY' && ctx.entry?.vwap != null && ctx.entry?.ltp != null && ctx.entry.ltp > ctx.entry.vwap,
    plainText: 'You bought at a price higher than what most people paid for this stock today — you may have entered late.',
    technicalText: (ctx) => `Entry ₹${ctx.entry.ltp} was above VWAP ₹${ctx.entry.vwap}`,
    whyItHurt: null,
    tryNextTime: "Compare your entry price to today's average price (VWAP) before buying — entering near or below it gives you more room.",
  },
  {
    id: 'high_volume_entry',
    patternLabel: 'entries during unusually busy minutes',
    condition: (ctx) => ctx.entry?.volume_ratio != null && ctx.entry.volume_ratio >= 3,
    plainText: 'You entered during an unusually busy minute for this stock — a lot more trading than normal was happening.',
    technicalText: (ctx) => `Volume was ${ctx.entry.volume_ratio}x the recent average at entry`,
    whyItHurt: null,
    tryNextTime: "A sudden burst of volume can be real news or a short-lived spike — give it a few minutes to show which one it is.",
  },

  // ── Exit quality ────────────────────────────────────────────────────────
  {
    id: 'quick_panic_exit',
    patternLabel: 'quick exits (under 5 min) on a loss',
    condition: (ctx) => ctx.pnl < 0 && ctx.holdingSeconds != null && ctx.holdingSeconds < 5 * 60,
    plainText: 'You exited in under 5 minutes on a loss — this can be a sign of a rushed, panicked exit rather than a planned one.',
    technicalText: (ctx) => `Held for ${Math.round(ctx.holdingSeconds / 60)} min before exiting at a loss`,
    whyItHurt: 'Very short holds on a loss often mean the exit was driven by the price move itself, not a plan made before entering.',
    tryNextTime: 'Before entering, decide your exit price for both a win and a loss — that way a dip does not have to be a decision made in the moment.',
  },
  {
    id: 'premature_exit_normal_pullback',
    patternLabel: 'exits on a normal dip, not a real reversal',
    condition: (ctx) => ctx.side === 'BUY' && ctx.pnl < 0 && ctx.exit?.rsi != null && ctx.exit.rsi > 40 && ctx.exit.rsi < 60,
    plainText: 'You sold during a normal, small dip — not a real reversal. The stock was not actually falling hard, it just paused.',
    technicalText: (ctx) => `RSI was ${ctx.exit.rsi} at exit — nowhere near the "oversold" zone`,
    whyItHurt: 'Exiting on ordinary movement, rather than a genuine reversal signal, can turn a normal pause into a locked-in loss.',
    tryNextTime: "Before reacting to a dip, check whether it's a sharp reversal or just normal movement — a few minutes of patience can tell the difference.",
  },
  {
    id: 'below_vwap_exit_loss',
    patternLabel: 'exits below the average price for the day',
    condition: (ctx) => ctx.side === 'BUY' && ctx.pnl < 0 && ctx.exit?.vwap != null && ctx.exit?.ltp != null && ctx.exit.ltp < ctx.exit.vwap,
    plainText: "You exited below today's average price for this stock.",
    technicalText: (ctx) => `Exit ₹${ctx.exit.ltp} was below VWAP ₹${ctx.exit.vwap}`,
    whyItHurt: null,
    tryNextTime: null,
  },

  // ── Positive reinforcement (rules aren't only about mistakes) ───────────
  {
    id: 'patient_entry_profit',
    patternLabel: 'calm, unhurried entries (neutral RSI)',
    condition: (ctx) => ctx.pnl > 0 && ctx.entry?.rsi != null && ctx.entry.rsi >= 40 && ctx.entry.rsi <= 60,
    plainText: 'You entered at a calm, unhurried price — not chasing a spike — and it paid off.',
    technicalText: (ctx) => `RSI was ${ctx.entry.rsi} at entry — a neutral zone, not overbought or oversold`,
    whyItHurt: null,
    tryNextTime: null,
  },
  {
    id: 'held_through_profit',
    patternLabel: 'trades held 20+ min through a profit',
    condition: (ctx) => ctx.pnl > 0 && ctx.holdingSeconds != null && ctx.holdingSeconds >= 20 * 60,
    plainText: 'You gave this trade time to work instead of closing it early — that patience showed up in the result.',
    technicalText: (ctx) => `Held for ${Math.round(ctx.holdingSeconds / 60)} min before exiting at a profit`,
    whyItHurt: null,
    tryNextTime: null,
  },
];

/**
 * Evaluate all rules against a trade context. Returns the list of matching
 * rules, each rendered into plain strings (functions resolved to values).
 */
function evaluateTrade(ctx) {
  const matched = [];

  for (const rule of RULES) {
    let fires = false;
    try {
      fires = !!rule.condition(ctx);
    } catch {
      fires = false; // missing/malformed snapshot data → rule simply doesn't fire
    }
    if (!fires) continue;

    matched.push({
      ruleId: rule.id,
      plainText: rule.plainText,
      technicalText: typeof rule.technicalText === 'function' ? safeCall(rule.technicalText, ctx) : rule.technicalText ?? null,
      whyItHurt: rule.whyItHurt ?? null,
      tryNextTime: rule.tryNextTime ?? null,
    });
  }

  return matched;
}

function safeCall(fn, ctx) {
  try {
    return fn(ctx);
  } catch {
    return null;
  }
}

// ruleId -> short human-readable label, used by the weekly pattern view
// ("4 of your 6 losing trades were {label}") so the frontend doesn't need
// its own copy of rule text.
const RULE_LABELS = Object.fromEntries(RULES.map((r) => [r.id, r.patternLabel]));

module.exports = { evaluateTrade, RULES, RULE_LABELS };
