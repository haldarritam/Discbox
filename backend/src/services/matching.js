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
 * Levenshtein edit distance, two-row variant.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);

  const row = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(
        row[j] + 1,                                        // deletion
        row[j - 1] + 1,                                    // insertion
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)         // substitution
      );
      diagonal = previous;
    }
  }
  return row[b.length];
}

/**
 * Do two tokens refer to the same word?
 *
 * Exact match, or close enough to be a spelling variant. Romanized Hindi/Urdu/
 * Arabic titles have no canonical spelling — Deezer's "Nadaan Parindey" is
 * YouTube's "Nadaan Parinde", "Aasmaan" is "Asmaan" — and requiring exact
 * tokens rejected those outright.
 *
 * Fuzziness is earned by length: tokens under 6 characters must match exactly,
 * because plenty of distinct short English words sit one edit apart — love/live,
 * rain/pain, heart/heard. Longer tokens get one edit, 8+ get two.
 *
 * This leans slightly permissive on purpose. A false negative here means a track
 * silently never downloads; a false positive still has to clear the duration and
 * artist gates before anything is written to disk.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function tokensMatch(a, b) {
  if (a === b) return true;
  const shortest = Math.min(a.length, b.length);
  if (shortest < 6) return false;
  const allowed = shortest >= 8 ? 2 : 1;
  if (Math.abs(a.length - b.length) > allowed) return false;
  return editDistance(a, b) <= allowed;
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
  const haystackTokens = tokens(haystack);
  if (haystackTokens.length === 0) return 0;

  const exact = new Set(haystackTokens);
  let hits = 0;
  for (const token of needleTokens) {
    if (exact.has(token) || haystackTokens.some((other) => tokensMatch(token, other))) {
      hits++;
    }
  }
  return hits / needleTokens.length;
}

/**
 * Filesystem-safe name, byte-for-byte what the downloader has always written,
 * so paths already stored in the database still resolve.
 *
 * Note it DROPS characters rather than replacing them: "3:59 AM" is stored as
 * "359 AM", "cold/mess" as "coldmess". Anything comparing a title against a
 * filename on disk has to sanitize the title the same way first, or those
 * perfectly good files look like mismatches.
 */
const sanitizeFilename = (str) => (str || '')
  .replace(/[<>:"\/\\|?*]/g, '')
  .replace(/\//g, '-')
  .trim();

/** Primary artist only — "Pritam, Atif Aslam" and "Pritam feat. X" both -> "pritam". */
function primaryArtist(artist) {
  return (artist || '')
    .split(/,|feat\.|ft\.|&|;| x /i)[0]
    .trim();
}

/**
 * The identity of a track: primary artist + title, normalized.
 *
 * Used for BOTH "have we already got this?" during sync and "is this still
 * loved?" during reconcile — they must agree or the two fight each other.
 *
 * normalize() rather than toLowerCase() because sources rename artists:
 * Deezer's "Jason Derülo" became "Jason Derulo", which under a case-only key
 * reads as a different artist. Sync then added a second row for every one of
 * his tracks while reconcile deleted the original, forever.
 *
 * @param {string} artist
 * @param {string} title
 * @returns {string}
 */
const trackKey = (artist, title) =>
  `${normalize(primaryArtist(artist))}\u0000${normalize(title)}`;

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
  sanitizeFilename,
  tokens,
  editDistance,
  tokensMatch,
  coverage,
  primaryArtist,
  trackKey,
  durationTolerance,
  durationMatches,
  unwantedVariantMarkers,
};
