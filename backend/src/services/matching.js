/**
 * Shared text-matching helpers for candidate scoring and on-disk file lookup.
 *
 * The old helpers stripped everything outside [a-z0-9] which collapsed any
 * non-Latin title (CJK, Devanagari, Cyrillic, ...) to an empty string. An empty
 * needle makes every `includes()` test true, so unrelated files matched.
 * Everything here is Unicode-aware and refuses to match on an empty needle.
 */

/** Words that mark a video as *not* the studio track we asked for. */
const VARIANT_MARKERS = [
  'live', 'concert', 'tour', 'remix', 'rmx', 'cover', 'karaoke', 'instrumental',
  'sped up', 'speed up', 'slowed', 'reverb', 'nightcore', '8d audio', 'lofi',
  'lo-fi', 'mashup', 'medley', 'teaser', 'trailer', 'preview', 'snippet',
  'reaction', 'review', 'behind the scenes', 'making of', 'full album',
  'jukebox', 'nonstop', 'mix', 'compilation', 'tutorial', 'lesson', 'session',
  'unplugged', 'acoustic', 'demo', 'rehearsal', 'edit', 'mashed', 'dj ',
];

/**
 * Lowercase, drop diacritics and punctuation, keep letters/digits of ANY script.
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return (str || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')  // \p{M} keeps Indic vowel signs etc.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize and drop the trailing "(feat. ...)", "- Remastered 2011", etc. that
 * Deezer keeps in the title but YouTube usually doesn't.
 * @param {string} str
 * @returns {string}
 */
function normalizeTitle(str) {
  const stripped = (str || '')
    .replace(/\((feat|ft|with)[^)]*\)/gi, ' ')
    .replace(/\[(feat|ft|with)[^\]]*\]/gi, ' ')
    .replace(/\s+-\s+(remaster|remastered|radio edit|single version|album version)[^-]*$/gi, ' ');
  return normalize(stripped);
}

/**
 * Split a normalized string into tokens. CJK has no spaces, so a single
 * space-free run of CJK is also exploded into per-character tokens; that keeps
 * coverage() meaningful for those scripts instead of an all-or-nothing match.
 * @param {string} normalized
 * @returns {string[]}
 */
function tokens(normalized) {
  if (!normalized) return [];
  const words = normalized.split(' ').filter(Boolean);
  const out = [];
  for (const word of words) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(word) && word.length > 1) {
      out.push(...Array.from(word));
    } else {
      out.push(word);
    }
  }
  return out;
}

/**
 * Fraction of `needle`'s tokens that appear in `haystack`. Returns 0 for an
 * empty needle so a blank/unnormalizable string never counts as a match.
 * @param {string} needle
 * @param {string} haystack
 * @returns {number} 0..1
 */
function coverage(needle, haystack) {
  const needleTokens = tokens(needle);
  if (needleTokens.length === 0) return 0;
  const haystackTokens = new Set(tokens(haystack));
  if (haystackTokens.size === 0) return 0;
  let hits = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) hits++;
  }
  return hits / needleTokens.length;
}

/** Primary artist only — "Pritam, Atif Aslam" and "Pritam feat. X" both -> "pritam". */
function primaryArtist(artist) {
  return (artist || '')
    .split(/,|feat\.|ft\.|&|;| x /i)[0]
    .trim();
}

/**
 * How far a candidate's runtime may sit from the reference (Deezer) runtime.
 * Encoders and intros/outros wobble a few seconds; anything beyond this is a
 * different edit, a truncated rip, or an entirely different song.
 * @param {number} expectedSeconds
 * @returns {number} allowed absolute difference in seconds
 */
function durationTolerance(expectedSeconds) {
  return Math.max(12, Math.round(expectedSeconds * 0.05));
}

/**
 * @param {number|null} actual
 * @param {number|null} expected
 * @returns {boolean} true when actual is close enough (or we have no reference)
 */
function durationMatches(actual, expected) {
  if (!expected || !actual) return true;
  return Math.abs(actual - expected) <= durationTolerance(expected);
}

/**
 * Variant markers present in the candidate but absent from the track we want.
 * "Live Forever" legitimately contains "live", so only markers the wanted title
 * does *not* already carry count against a candidate.
 * @param {string} candidateTitle
 * @param {string} wantedTitle
 * @returns {string[]}
 */
function unwantedVariantMarkers(candidateTitle, wantedTitle) {
  const candidate = ` ${normalize(candidateTitle)} `;
  const wanted = ` ${normalize(wantedTitle)} `;
  return VARIANT_MARKERS.filter((marker) => {
    const needle = ` ${normalize(marker)} `;
    return candidate.includes(needle) && !wanted.includes(needle);
  });
}

module.exports = {
  VARIANT_MARKERS,
  normalize,
  normalizeTitle,
  tokens,
  coverage,
  primaryArtist,
  durationTolerance,
  durationMatches,
  unwantedVariantMarkers,
};
