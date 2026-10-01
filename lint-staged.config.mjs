// Arrays run in order; --concurrent false also orders overlapping patterns.
export default {
  "*.{ts,tsx,js,mjs,cjs,json,jsonc,yml,yaml,md}": "prettier --write",
  "*.{ts,tsx,js,mjs,cjs}": "node scripts/lint-staged-code.mjs",
};
