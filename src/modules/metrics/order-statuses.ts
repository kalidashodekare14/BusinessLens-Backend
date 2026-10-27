/**
 * Order statuses that are stored but excluded from every metric
 * (PROJECT_ARCHITECTURE.md §7). Kept lowercase because comparisons are
 * case-insensitive: imports store the status exactly as the CSV supplied it.
 */
export const EXCLUDED_ORDER_STATUSES = ['cancelled', 'refunded', 'voided'] as const;
