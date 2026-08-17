/**
 * Fuzzy matching between cover and spine files for batch mode, based on how
 * similar their filenames are once common bookmaking suffixes are stripped.
 *
 * e.g. "My Great Novel - Cover.png" and "My Great Novel_Spine.psd" should
 * match even though the two names aren't identical.
 */

export interface NamedFile {
  id: string;
  file: File;
  url: string;
}

const STOP_WORDS = new Set([
  "cover",
  "covers",
  "spine",
  "spines",
  "front",
  "back",
  "final",
  "draft",
  "copy",
  "v1",
  "v2",
  "v3",
]);

function normalizeTokens(filename: string): string[] {
  const withoutExt = filename.replace(/\.[^./\\]+$/, "");
  const cleaned = withoutExt
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array<number>(n + 1);
  let currRow = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,
        currRow[j - 1] + 1,
        prevRow[j - 1] + cost,
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n];
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Order-independent, typo-tolerant similarity between two token lists.
 * Returns a value from 0 (nothing alike) to 1 (identical word sets).
 */
function nameSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const remaining = [...longer];
  let totalScore = 0;

  for (const tokenA of shorter) {
    let bestIdx = -1;
    let bestScore = 0;
    remaining.forEach((tokenB, idx) => {
      const score = tokenSimilarity(tokenA, tokenB);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    if (bestIdx !== -1 && bestScore >= 0.55) {
      totalScore += bestScore;
      remaining.splice(bestIdx, 1);
    }
  }

  return totalScore / Math.max(tokensA.length, tokensB.length);
}

export function fileNameSimilarity(nameA: string, nameB: string): number {
  return nameSimilarity(normalizeTokens(nameA), normalizeTokens(nameB));
}

export interface MatchPair {
  coverId: string;
  spineId: string;
  score: number;
}

export interface MatchResult {
  pairs: MatchPair[];
  unmatchedCoverIds: string[];
  unmatchedSpineIds: string[];
}

/** Below this similarity, two filenames are treated as not a match at all. */
export const MATCH_THRESHOLD = 0.5;

/**
 * Greedy best-score matching: score every cover/spine pair, then assign
 * matches highest-score-first, skipping any cover or spine already claimed.
 * This is an approximation of optimal bipartite matching, good enough for
 * filename pairing where the highest-scoring candidate is almost always the
 * right one.
 */
export function matchCoversAndSpines(
  covers: NamedFile[],
  spines: NamedFile[],
): MatchResult {
  const candidates: MatchPair[] = [];
  for (const cover of covers) {
    for (const spine of spines) {
      const score = fileNameSimilarity(cover.file.name, spine.file.name);
      candidates.push({ coverId: cover.id, spineId: spine.id, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedCovers = new Set<string>();
  const usedSpines = new Set<string>();
  const pairs: MatchPair[] = [];

  for (const candidate of candidates) {
    if (candidate.score < MATCH_THRESHOLD) break;
    if (usedCovers.has(candidate.coverId) || usedSpines.has(candidate.spineId)) {
      continue;
    }
    usedCovers.add(candidate.coverId);
    usedSpines.add(candidate.spineId);
    pairs.push(candidate);
  }

  const unmatchedCoverIds = covers
    .map((c) => c.id)
    .filter((id) => !usedCovers.has(id));
  const unmatchedSpineIds = spines
    .map((s) => s.id)
    .filter((id) => !usedSpines.has(id));

  return { pairs, unmatchedCoverIds, unmatchedSpineIds };
}
