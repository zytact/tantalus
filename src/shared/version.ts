export const validVersion = (version: string): boolean => /^\d+\.\d+\.\d+$/.test(version);

export function isNewer(candidate: string, current: string): boolean {
  const [a, b] = [candidate, current].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}
