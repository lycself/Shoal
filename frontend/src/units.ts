// Unit strings as readers expect them. No imports: the API client uses this too.
/** Unit strings from model output, written the way a reader expects: m^-2, m-2, m^2 → m⁻², /m^3 → m⁻³. */
const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export function prettyUnit(u?: string | null): string {
  if (!u) return "";
  const sup = (e: string) => [...e].map((c) => SUP[c] ?? c).join("");
  return u.trim()
    .replace(/\s*\/\s*(m|s|d|yr|day|h|kg|g|L)\^?([1-9])(?!\d)/g, (_, b, e) => ` ${b}${sup("-" + e)}`) // mg C/m^3 → mg C m⁻³
    .replace(/\b(m|s|d|yr|day|h|kg|g|L)\^?(-?[1-9])(?![\d.])/g, (_, b, e) => b + sup(e)) // m-2, m^2, yr-1
    .replace(/\s+/g, " ");
}

