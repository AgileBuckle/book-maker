/**
 * Parses an optional batch-mode CSV (column A: book name, column B: spine
 * type) and matches it against the currently uploaded covers, using the same
 * fuzzy filename matching as cover/spine pairing (see fuzzyMatch.ts) for both
 * the book name and the spine type text.
 */

import { BookType } from "../enums.ts";
import { MATCH_THRESHOLD, NamedFile, fileNameSimilarity } from "./fuzzyMatch";

/** Alternate phrasings accepted for each spine type, matched fuzzily so
 * spacing, hyphens, and minor typos don't matter.
 *
 * Spiral bound is intentionally left out: batch mode doesn't offer it as a
 * book type (see BatchApp.tsx's bookTypeLabels), so a CSV row naming it
 * falls through to unrecognizedSpineTypes instead of silently assigning a
 * type nothing in the batch UI can produce or display. */
const bookTypeAliases = new Map<BookType, string[]>([
  [
    BookType.PerfectBound,
    [
      "Perfect Bound",
      "Perfectbound",
      "Perfect-Bound",
      "Softcover",
      "Soft Cover",
      "Paperback",
    ],
  ],
  [
    BookType.Hardcover,
    ["Hardcover", "Hard Cover", "Hard-Cover", "Case Bound", "Casebound"],
  ],
  [
    BookType.Saddlestitch,
    [
      "Saddlestitch",
      "Saddle Stitch",
      "Saddle-Stitch",
      "Stapled",
      "Staple Bound",
    ],
  ],
]);

/** Canonical text written to the "Spine Type" column when exporting a CSV. */
const bookTypeExportLabels = new Map<BookType, string>([
  [BookType.PerfectBound, "Perfect bound"],
  [BookType.Hardcover, "Hardcover"],
  [BookType.Saddlestitch, "Saddlestitch"],
]);

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Builds a CSV in the same "Book Name,Spine Type" layout matchCsvToCovers
 * reads, so a finished batch's spine-type choices can be exported and later
 * re-uploaded to redo the batch without re-picking each book's type by hand.
 */
export function buildSpineTypeCsv(
  rows: { bookName: string; bookType: BookType }[],
): string {
  const lines = ["Book Name,Spine Type"];
  for (const row of rows) {
    const label = bookTypeExportLabels.get(row.bookType) ?? "";
    lines.push(`${csvField(row.bookName)},${csvField(label)}`);
  }
  return lines.join("\r\n") + "\r\n";
}

/** Parses CSV text into rows of trimmed string cells, handling quoted
 * fields (including embedded commas/newlines and "" escapes). Blank rows
 * are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .map((r) => r.map((cell) => cell.trim()))
    .filter((r) => r.some((cell) => cell.length > 0));
}

interface BookTypeMatch {
  type: BookType;
  score: number;
}

/** Best fuzzy match between free-text spine type and the known BookType
 * aliases. Returns null if nothing scores above MATCH_THRESHOLD. */
function matchBookTypeText(text: string): BookTypeMatch | null {
  let best: BookTypeMatch | null = null;
  for (const [type, aliases] of bookTypeAliases) {
    for (const alias of aliases) {
      const score = fileNameSimilarity(text, alias);
      if (best === null || score > best.score) {
        best = { type, score };
      }
    }
  }
  if (best === null || best.score < MATCH_THRESHOLD) return null;
  return best;
}

export interface CsvSpineAssignment {
  coverId: string;
  bookType: BookType;
}

export interface CsvMatchResult {
  assignments: CsvSpineAssignment[];
  /** Row 1, if it was auto-detected as a header and skipped. */
  skippedHeader: string[] | null;
  /** Book names from the CSV that didn't fuzzy-match any uploaded cover. */
  unmatchedBookNames: string[];
  /** `<book name>: "<raw text>"` for rows whose spine type text didn't
   * fuzzy-match any known spine type. */
  unrecognizedSpineTypes: string[];
}

/**
 * Matches CSV rows (book name, spine type) to uploaded covers.
 *
 * Row 1 is auto-detected as a header and skipped if its column B doesn't
 * fuzzy-match any known spine type (e.g. "Spine Type" or "Type" won't match,
 * so it's assumed to be a header rather than a book named "Spine Type").
 *
 * Book-name-to-cover matching is a greedy best-score bipartite match, the
 * same approach matchCoversAndSpines uses for cover/spine pairing.
 */
export function matchCsvToCovers(
  csvText: string,
  covers: NamedFile[],
): CsvMatchResult {
  const parsed = parseCsv(csvText).map(
    (row) => [row[0] ?? "", row[1] ?? ""] as [string, string],
  );
  const allRows = parsed.filter(([bookName]) => bookName.length > 0);

  let dataRows = allRows;
  let skippedHeader: string[] | null = null;
  if (allRows.length > 0) {
    const [, firstSpineType] = allRows[0];
    if (matchBookTypeText(firstSpineType) === null) {
      skippedHeader = allRows[0];
      dataRows = allRows.slice(1);
    }
  }

  interface Candidate {
    rowIndex: number;
    coverId: string;
    score: number;
  }
  const candidates: Candidate[] = [];
  dataRows.forEach(([bookName], rowIndex) => {
    covers.forEach((cover) => {
      candidates.push({
        rowIndex,
        coverId: cover.id,
        score: fileNameSimilarity(bookName, cover.file.name),
      });
    });
  });
  candidates.sort((a, b) => b.score - a.score);

  const usedRows = new Set<number>();
  const usedCovers = new Set<string>();
  const coverByRow = new Map<number, string>();
  for (const candidate of candidates) {
    if (candidate.score < MATCH_THRESHOLD) break;
    if (
      usedRows.has(candidate.rowIndex) ||
      usedCovers.has(candidate.coverId)
    ) {
      continue;
    }
    usedRows.add(candidate.rowIndex);
    usedCovers.add(candidate.coverId);
    coverByRow.set(candidate.rowIndex, candidate.coverId);
  }

  const assignments: CsvSpineAssignment[] = [];
  const unmatchedBookNames: string[] = [];
  const unrecognizedSpineTypes: string[] = [];

  dataRows.forEach(([bookName, spineTypeText], rowIndex) => {
    const coverId = coverByRow.get(rowIndex);
    if (coverId === undefined) {
      unmatchedBookNames.push(bookName);
      return;
    }
    const typeMatch = matchBookTypeText(spineTypeText);
    if (typeMatch === null) {
      unrecognizedSpineTypes.push(`${bookName}: "${spineTypeText}"`);
      return;
    }
    assignments.push({ coverId, bookType: typeMatch.type });
  });

  return {
    assignments,
    skippedHeader,
    unmatchedBookNames,
    unrecognizedSpineTypes,
  };
}
