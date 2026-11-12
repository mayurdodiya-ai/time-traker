// Shared color constants for stat-card icons and chart series, kept in one place so
// Dashboard / Reports / TeamAnalytics don't each carry their own copy of the same palette.
// Flat, solid colors only — no gradients.

export const STAT_GRADIENTS = {
  indigo: ['#5468ff', 'rgba(84,104,255,.8)'],
  teal: ['#1e9b7a', 'rgba(30,155,122,.8)'],
  amber: ['#e08a2b', 'rgba(224,138,43,.8)'],
  rose: ['#c44a8f', 'rgba(196,74,143,.8)'],
  sky: ['#0a5f8c', 'rgba(10,95,140,.8)'],
};

// Flat hex for Recharts stroke/fill/stopColor props, which don't accept CSS custom properties reliably.
export const CHART_PALETTE = ['#5468ff', '#8f7bff', '#d874c6', '#8ecdff', '#7fdba0', '#f4c86a'];
