const rules: [RegExp, string][] = [
  [/insufficient[_ ]quota|credit|billing|payment|out of funds/i, "Model provider is out of credit"],
  [/429|rate.?limit|too many requests/i, "Model provider rate limited the request"],
  [
    /401|403|unauthori[sz]ed|forbidden|invalid.*api.?key|authentication/i,
    "Model provider authentication failed",
  ],
  [
    /50[234]|unavailable|overloaded|econn|enotfound|etimedout|fetch failed|network|timed? ?out/i,
    "Model provider unavailable",
  ],
  [/\b5\d\d\b|\b4\d\d\b/, "Model provider API error"],
];

export function describeFailure(message: string | undefined): string {
  const text = message?.trim();
  if (!text) return "Execution ended with an unrecoverable error";
  const summary = Array.from(text).slice(0, 200).join("");
  const known = rules.find(([pattern]) => pattern.test(text));
  return known ? `${known[1]}: ${summary}` : `Execution failed: ${summary}`;
}
