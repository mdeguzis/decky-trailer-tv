// Single source of truth for displaying plugin version labels.
//
// The backend hands us three kinds of "version" string:
//   1. Real semver, eg. "0.4.0"  -> display as "v0.4.0"
//   2. Developer-channel labels, eg. "Developer build (93ae260)"
//      -> display verbatim, no leading "v"
//   3. Anything else (future channels, edge cases)
//      -> safe default: leading "v" only if it starts with a digit
//
// Always call formatVersion() instead of inlining the regex or hardcoding
// `v${...}`, otherwise dev labels render as "vDeveloper build (sha)".

export function formatVersion(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return /^\d/.test(v) ? `v${v}` : v;
}
