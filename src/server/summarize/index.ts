import { loadPaperSummaryContext } from './context';
import { fetchKontextSystemPrompt } from './kontext';
import { generateJson } from '@/server/llm';
import type {
  PageSpan,
  SummaryFigure,
  SummaryKeyFinding,
  SummaryResult,
  SummarySection,
} from './types';

import { getSystemPrompt, getPaperSummaryRequirements, getPromptLimits } from '@/server/llm-config';

const PROMPT_LIMITS = getPromptLimits();
const PROMPT_SECTION_LIMIT = PROMPT_LIMITS.section;
const PROMPT_PARAGRAPH_LIMIT = PROMPT_LIMITS.paragraph;
const PROMPT_FIGURE_LIMIT = PROMPT_LIMITS.figure;

const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['sections', 'key_findings', 'figures'],
  properties: {
    sections: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_id', 'title', 'summary', 'reasoning', 'key_points'],
        properties: {
          section_id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          reasoning: { type: 'string' },
          key_points: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
            maxItems: 4,
          },
        },
      },
    },
    key_findings: {
      type: 'array',
      minItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'statement',
          'evidence',
          'supporting_sections',
          'related_figures',
        ],
        properties: {
          statement: { type: 'string' },
          evidence: { type: 'string' },
          supporting_sections: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: { type: 'string' },
          },
          related_figures: {
            type: 'array',
            maxItems: 3,
            items: { type: 'string' },
          },
        },
      },
    },
    figures: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['figure_id', 'caption_summary', 'insight'],
        properties: {
          figure_id: { type: 'string' },
          caption_summary: { type: 'string' },
          insight: { type: 'string' },
        },
      },
    },
  },
};

interface LlmSection {
  section_id: string;
  title: string;
  summary: string;
  reasoning: string;
  key_points: string[];
}

interface LlmKeyFinding {
  statement: string;
  evidence: string;
  supporting_sections: string[];
  related_figures: string[];
}

interface LlmFigure {
  figure_id: string;
  caption_summary: string;
  insight: string;
}

interface LlmSummaryPayload {
  sections: LlmSection[];
  key_findings: LlmKeyFinding[];
  figures: LlmFigure[];
}

interface SummarizeOptions {
  userId?: string;
  personaId?: string;
}

function truncateText(text: string, maxLength = PROMPT_LIMITS.text_truncate): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function formatPageSpan(span: PageSpan | undefined): string {
  if (!span?.start && !span?.end) {
    return 'page ?';
  }

  const start = span?.start;
  const end = span?.end;

  if (typeof start === 'number' && typeof end === 'number') {
    if (start === end) {
      return `page ${start}`;
    }
    return `pages ${start}-${end}`;
  }

  if (typeof start === 'number') {
    return `page ${start}`;
  }

  if (typeof end === 'number') {
    return `page ${end}`;
  }

  return 'page ?';
}

function formatPageAnchorFromSpan(span: PageSpan | undefined): string | undefined {
  const page = span?.start ?? span?.end;
  if (typeof page === 'number' && Number.isFinite(page) && page > 0) {
    return `(page ${page})`;
  }
  return undefined;
}

function formatPageAnchor(page?: number): string | undefined {
  if (typeof page === 'number' && Number.isFinite(page) && page > 0) {
    return `(page ${page})`;
  }
  return undefined;
}

function buildSectionOutlinePrompt(
  sections: Array<{
    id: string;
    title: string;
    pageSpan?: PageSpan;
    paragraphs: string[];
    referencedFigureIds: string[];
  }>,
): string {
  return sections
    .slice(0, PROMPT_SECTION_LIMIT)
    .map((section) => {
      const header = `- [${section.id}] ${section.title} (${formatPageSpan(section.pageSpan)})`;
      const figuresLine = section.referencedFigureIds.length
        ? `    Figures: ${section.referencedFigureIds.join(', ')}`
        : undefined;

      const highlights = section.paragraphs
        .slice(0, PROMPT_PARAGRAPH_LIMIT)
        .map(
          (paragraph, index) =>
            `    Key ${index + 1}: ${truncateText(paragraph, PROMPT_LIMITS.paragraph_truncate)}`,
        );

      return [header, figuresLine, ...highlights]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

function buildFigureContextPrompt(
  figures: Array<{
    id: string;
    caption?: string;
    pageNumber?: number;
    referencedSectionIds: string[];
    supportingParagraphs: string[];
  }>,
): string {
  if (!figures.length) {
    return 'No figures were extracted for this paper.';
  }

  return figures
    .slice(0, PROMPT_FIGURE_LIMIT)
    .map((figure) => {
      const header = `- [${figure.id}] ${truncateText(
        figure.caption ?? 'No caption available',
        PROMPT_LIMITS.figure_caption_truncate,
      )} (${formatPageAnchor(figure.pageNumber) ?? 'page ?'})`;
      const sectionsLine = figure.referencedSectionIds.length
        ? `    Sections: ${figure.referencedSectionIds.join(', ')}`
        : undefined;

      const contextLines = figure.supportingParagraphs.map(
        (paragraph, index) =>
          `    Context ${index + 1}: ${truncateText(paragraph, PROMPT_LIMITS.figure_context_truncate)}`,
      );

      return [header, sectionsLine, ...contextLines]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

function buildMetadataPrompt(metadata?: {
  title?: string;
  authors?: string[];
  abstract?: string;
  primaryCategory?: string;
  publishedAt?: string;
  updatedAt?: string;
}): string {
  if (!metadata) {
    return 'Paper metadata unavailable (fallback to section content).';
  }

  const parts: string[] = [];

  if (metadata.title) {
    parts.push(`Title: ${metadata.title}`);
  }
  if (metadata.authors?.length) {
    parts.push(`Authors: ${metadata.authors.join(', ')}`);
  }
  if (metadata.primaryCategory) {
    parts.push(`Primary field: ${metadata.primaryCategory}`);
  }
  if (metadata.publishedAt) {
    parts.push(`Published: ${metadata.publishedAt}`);
  }
  if (metadata.updatedAt && metadata.updatedAt !== metadata.publishedAt) {
    parts.push(`Updated: ${metadata.updatedAt}`);
  }
  if (metadata.abstract) {
    parts.push(`Abstract: ${truncateText(metadata.abstract, PROMPT_LIMITS.abstract_truncate)}`);
  }

  return parts.join('\n');
}

function buildUserPrompt(context: Awaited<ReturnType<typeof loadPaperSummaryContext>>): string {
  const metadataBlock = buildMetadataPrompt(context.metadata);
  const sectionOutline = buildSectionOutlinePrompt(context.sections);
  const figureOutline = buildFigureContextPrompt(context.figures);

  const requirements = getPaperSummaryRequirements();

  return [
    `Paper ID: ${context.paperId}`,
    '',
    '# Metadata',
    metadataBlock,
    '',
    '# Section Outline',
    sectionOutline,
    '',
    '# Figure Context',
    figureOutline,
    '',
    '# Task Requirements',
    requirements.map((line) => `- ${line}`).join('\n'),
  ].join('\n');
}

function mergeSystemPrompt(personaPrompt?: string): string {
  return getSystemPrompt('paper_summary', personaPrompt);
}

function extractJsonPayload(content: string): unknown {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1] : trimmed;
  return JSON.parse(jsonText);
}

function coerceSections(input: unknown): LlmSection[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const sections: LlmSection[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;

    const sectionId =
      typeof record.section_id === 'string'
        ? record.section_id.trim()
        : undefined;

    const summary =
      typeof record.summary === 'string'
        ? record.summary.trim()
        : undefined;

    const reasoning =
      typeof record.reasoning === 'string'
        ? record.reasoning.trim()
        : undefined;

    if (!sectionId || !summary || !reasoning) {
      continue;
    }

    const title =
      typeof record.title === 'string'
        ? record.title.trim()
        : sectionId;

    const keyPointsRaw = record.key_points;
    const keyPoints = Array.isArray(keyPointsRaw)
      ? keyPointsRaw
          .map((item) =>
            typeof item === 'string' ? item.trim() : undefined,
          )
          .filter((item): item is string => Boolean(item))
          .slice(0, 4)
      : [];

    sections.push({
      section_id: sectionId,
      title,
      summary,
      reasoning,
      key_points: keyPoints,
    });
  }

  return sections;
}

function coerceKeyFindings(input: unknown): LlmKeyFinding[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const findings: LlmKeyFinding[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;

    const statement =
      typeof record.statement === 'string'
        ? record.statement.trim()
        : undefined;

    const evidence =
      typeof record.evidence === 'string'
        ? record.evidence.trim()
        : undefined;

    const supportingSectionsRaw = record.supporting_sections;
    const supportingSections = Array.isArray(supportingSectionsRaw)
      ? supportingSectionsRaw
          .map((item) =>
            typeof item === 'string' ? item.trim() : undefined,
          )
          .filter((item): item is string => Boolean(item))
          .slice(0, 4)
      : [];

    if (!statement || !evidence || !supportingSections.length) {
      continue;
    }

    const relatedFiguresRaw = record.related_figures;
    const relatedFigures = Array.isArray(relatedFiguresRaw)
      ? relatedFiguresRaw
          .map((item) =>
            typeof item === 'string' ? item.trim() : undefined,
          )
          .filter((item): item is string => Boolean(item))
          .slice(0, 3)
      : [];

    findings.push({
      statement,
      evidence,
      supporting_sections: supportingSections,
      related_figures: relatedFigures,
    });
  }

  return findings;
}

function coerceFigures(input: unknown): LlmFigure[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const figures: LlmFigure[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;

    const figureId =
      typeof record.figure_id === 'string'
        ? record.figure_id.trim()
        : undefined;

    const insight =
      typeof record.insight === 'string'
        ? record.insight.trim()
        : undefined;

    if (!figureId || !insight) {
      continue;
    }

    const caption =
      typeof record.caption_summary === 'string'
        ? record.caption_summary.trim()
        : '';

    figures.push({
      figure_id: figureId,
      caption_summary: caption,
      insight,
    });
  }

  return figures;
}

function parseModelSummary(rawContent: string): LlmSummaryPayload {
  const payload = extractJsonPayload(rawContent) as Record<string, unknown>;
  const sections = coerceSections(payload.sections);
  const keyFindings = coerceKeyFindings(payload.key_findings);
  const figures = coerceFigures(payload.figures);

  if (sections.length < 1) {
    throw new Error('Model response did not include any sections.');
  }

  return {
    sections,
    key_findings: keyFindings,
    figures,
  };
}

function postProcessSummary(
  llmSummary: LlmSummaryPayload,
  context: Awaited<ReturnType<typeof loadPaperSummaryContext>>,
): SummaryResult {
  const sectionOrder = new Map<string, number>();
  const sectionContext = new Map(
    context.sections.map((section, index) => {
      sectionOrder.set(section.id, index);
      return [section.id, section];
    }),
  );

  const figureContext = new Map(
    context.figures.map((figure) => [figure.id, figure]),
  );

  const sections: SummarySection[] = llmSummary.sections
    .map((section) => {
      const source = sectionContext.get(section.section_id);
      const pageSpan = source?.pageSpan;
      return {
        section_id: section.section_id,
        title: section.title || source?.title || section.section_id,
        summary: section.summary,
        reasoning: section.reasoning,
        key_points: section.key_points,
        page_span: pageSpan,
        page_anchor: formatPageAnchorFromSpan(pageSpan),
      };
    })
    .sort((a, b) => {
      const indexA = sectionOrder.get(a.section_id) ?? Number.MAX_SAFE_INTEGER;
      const indexB = sectionOrder.get(b.section_id) ?? Number.MAX_SAFE_INTEGER;
      return indexA - indexB;
    });

  if (sections.length < 3 && context.sections.length >= 3) {
    throw new Error('Model response returned fewer than three sections.');
  }

  const keyFindings: SummaryKeyFinding[] = llmSummary.key_findings.map(
    (finding) => {
      const anchorSet = new Set<string>();

      finding.supporting_sections.forEach((sectionId) => {
        const span = sectionContext.get(sectionId)?.pageSpan;
        const anchor = formatPageAnchorFromSpan(span);
        if (anchor) {
          anchorSet.add(anchor);
        }
      });

      (finding.related_figures ?? []).forEach((figureId) => {
        const pageAnchor = formatPageAnchor(
          figureContext.get(figureId)?.pageNumber,
        );
        if (pageAnchor) {
          anchorSet.add(pageAnchor);
        }
      });

      return {
        statement: finding.statement,
        evidence: finding.evidence,
        supporting_sections: finding.supporting_sections,
        related_figures: finding.related_figures,
        page_anchors: Array.from(anchorSet),
      };
    },
  );

  const mappedFigures: SummaryFigure[] = [];

  llmSummary.figures.forEach((figure) => {
    const source = figureContext.get(figure.figure_id);
    const pageAnchor = formatPageAnchor(source?.pageNumber);

    if (!source || !pageAnchor) {
      return;
    }

    mappedFigures.push({
      figure_id: figure.figure_id,
      caption: figure.caption_summary || source.caption,
      insight: figure.insight,
      page_anchor: pageAnchor,
    });
  });

  let figures: SummaryFigure[] = mappedFigures;

  if (!figures.length) {
    const fallback = context.figures.find((figure) =>
      formatPageAnchor(figure.pageNumber),
    );
    const fallbackAnchor = formatPageAnchor(fallback?.pageNumber);

    if (fallback && fallbackAnchor) {
      figures = [
        {
          figure_id: fallback.id,
          caption: fallback.caption,
          insight:
            'Figure referenced in the paper; review the caption for context.',
          page_anchor: fallbackAnchor,
        },
      ];
    }
  }

  return {
    sections,
    key_findings: keyFindings,
    figures,
  };
}

export async function summarizePaper(
  paperId: string,
  options: SummarizeOptions = {},
): Promise<SummaryResult> {
  const context = await loadPaperSummaryContext(paperId);

  const personaPrompt = await fetchKontextSystemPrompt({
    taskId: 'summarize_research_paper',
    paperId,
    userId: options.userId,
    personaId: options.personaId,
  }).catch(() => undefined);

  const systemPrompt = mergeSystemPrompt(personaPrompt);
  const userPrompt = buildUserPrompt(context);
  const rawContent = await generateJson({
    systemPrompt,
    userPrompt,
    schema: SUMMARY_SCHEMA,
  }, {
    taskName: 'summary',
  });

  const llmSummary = parseModelSummary(rawContent);

  return postProcessSummary(llmSummary, context);
}

export type {
  SummaryResult,
  SummarySection,
  SummaryKeyFinding,
  SummaryFigure,
} from './types';
export type { SummarizeOptions };
