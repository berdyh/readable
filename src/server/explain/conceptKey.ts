import { DEFAULT_CONCEPT_DOMAIN } from "./constants";

/**
 * Concept-key normalization. Deliberately conservative — case,
 * whitespace, and trailing-plural folding only, no fuzzy matching —
 * because a wrong merge poisons the graph for every user while a missed
 * merge just makes two nodes. Keys are domain-faceted
 * ("{domain}:{key}") so homonyms from different fields ("transformer"
 * in ML vs. electrical engineering) never collide.
 */

function stripPlural(word: string): string {
  // "mechanisms" -> "mechanism", but leave "loss", "bias", "consensus",
  // "chaos", "analysis" alone: -ss/-us/-is/-as/-os endings are almost
  // always singular in technical vocabulary.
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is|as|os)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

export function normalizeConceptName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[‐-―]/g, "-") // unicode hyphens -> ascii
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) {
    return "";
  }

  // Only the final word is plural-folded ("attention mechanisms" ->
  // "attention mechanism"); folding every word would merge distinct
  // phrases.
  words[words.length - 1] = stripPlural(words[words.length - 1]);
  return words.join(" ");
}

export function normalizeDomain(domain: string | undefined): string {
  const normalized = (domain ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return normalized || DEFAULT_CONCEPT_DOMAIN;
}

/** Builds the domain-faceted graph key: "{domain}:{normalized name}". */
export function buildConceptKey(name: string, domain?: string): string | undefined {
  const normalizedName = normalizeConceptName(name);
  if (!normalizedName) {
    return undefined;
  }
  return `${normalizeDomain(domain)}:${normalizedName}`;
}

export function splitConceptKey(key: string): { domain: string; name: string } {
  const separator = key.indexOf(":");
  if (separator === -1) {
    return { domain: DEFAULT_CONCEPT_DOMAIN, name: key };
  }
  return {
    domain: key.slice(0, separator) || DEFAULT_CONCEPT_DOMAIN,
    name: key.slice(separator + 1),
  };
}
