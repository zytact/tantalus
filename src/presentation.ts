export function usagePercent(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(value)}% used`;
}
