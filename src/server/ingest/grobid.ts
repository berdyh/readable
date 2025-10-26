import { XMLParser } from 'fast-xml-parser';

import { getIngestEnvironment, type IngestEnvironmentConfig } from './config';
import type {
  ParsedTeiResult,
  PaperFigure,
  PaperReference,
  PaperSection,
  SectionParagraph,
} from './types';
import {
  ensureArray,
  fetchWithTimeout,
  flattenTeiNode,
  normalizeWhitespace,
  type XmlNode,
} from './utils';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
});

type TeiNode = Record<string, unknown>;

function resolveNodeId(node: TeiNode, fallbackPrefix: string, index: number): string {
  const id =
    (node['@_xml:id'] as string | undefined) ??
    (node['@_id'] as string | undefined) ??
    (node['@_n'] as string | undefined);

  if (id) {
    return id;
  }

  return `${fallbackPrefix}-${index + 1}`;
}

function createParagraph(
  node: unknown,
  sectionId: string,
  index: number,
): SectionParagraph | undefined {
  const { text, citations, figureIds } = flattenTeiNode(node as XmlNode);
  if (!text) {
    return undefined;
  }

  return {
    id: `${sectionId}-p${index + 1}`,
    text,
    citations,
    figureIds,
  };
}

function parseTeiSections(body: unknown): PaperSection[] {
  const sections: PaperSection[] = [];

  const visit = (node: TeiNode, level: number) => {
    const sectionIndex = sections.length;
    const sectionId = resolveNodeId(node, 'section', sectionIndex);

    const head =
      node.head && typeof node.head === 'object'
        ? flattenTeiNode(node.head as XmlNode).text
        : typeof node.head === 'string'
          ? normalizeWhitespace(node.head)
          : undefined;

    const paragraphsRaw = ensureArray(node.p as unknown);
    const paragraphs = paragraphsRaw
      .map((paragraph, index) =>
        createParagraph(paragraph, sectionId, index),
      )
      .filter(
        (paragraph): paragraph is SectionParagraph => paragraph !== undefined,
      );

    if (head && paragraphs.length > 0) {
      sections.push({
        id: sectionId,
        title: head,
        level,
        paragraphs,
      });
    }

    const children = ensureArray(node.div as unknown);
    children.forEach((child) => {
      if (child && typeof child === 'object') {
        visit(child as TeiNode, Math.min(level + 1, 6));
      }
    });
  };

  const roots = ensureArray(
    (body as { div?: unknown } | undefined)?.div as unknown,
  );
  roots.forEach((root) => {
    if (root && typeof root === 'object') {
      visit(root as TeiNode, 1);
    }
  });

  return sections;
}

function collectIdnos(node: TeiNode): Record<string, string> {
  const result: Record<string, string> = {};

  const idnoEntries = ensureArray(node.idno as unknown);
  idnoEntries.forEach((entry) => {
    if (
      entry &&
      typeof entry === 'object' &&
      '@_type' in entry &&
      typeof (entry as { '@_type'?: string })['@_type'] === 'string'
    ) {
      const type = (entry as { '@_type': string })['@_type'].toLowerCase();
      const value = flattenTeiNode(entry as XmlNode).text;
      if (value) {
        result[type] = value;
      }
    }
  });

  return result;
}

function parseTeiAuthors(node: unknown): string[] {
  return ensureArray(node as unknown)
    .map((author) => {
      if (
        author &&
        typeof author === 'object' &&
        'persName' in author &&
        typeof (author as { persName?: unknown }).persName !== 'undefined'
      ) {
        const { text } = flattenTeiNode(
          (author as { persName: unknown }).persName as XmlNode,
        );
        return text;
      }

      const { text } = flattenTeiNode(author as XmlNode);
      return text;
    })
    .filter((value): value is string => Boolean(value));
}

function parseTeiReferences(back: unknown): PaperReference[] {
  const references: PaperReference[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }

    if ('biblStruct' in node) {
      const entries = ensureArray(
        (node as { biblStruct?: unknown }).biblStruct as unknown,
      );

      entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }

        const entryNode = entry as TeiNode;
        const id = resolveNodeId(entryNode, 'ref', index);

        const analytic = entryNode.analytic as TeiNode | undefined;
        const monogr = entryNode.monogr as TeiNode | undefined;

        const titleNode =
          analytic?.title ??
          analytic?.['title'] ??
          monogr?.title ??
          (entryNode.title as unknown);
        const title = titleNode
          ? flattenTeiNode(titleNode as XmlNode).text
          : undefined;

        const authors =
          (analytic && parseTeiAuthors(analytic.author)) ??
          (monogr && parseTeiAuthors(monogr.author)) ??
          [];

        let year: number | undefined;

        const analyticImprint = (analytic?.imprint ?? undefined) as
          | TeiNode
          | undefined;
        const monogrImprint = (monogr?.imprint ?? undefined) as
          | TeiNode
          | undefined;

        const dateNode =
          analyticImprint?.['date'] ??
          monogrImprint?.['date'] ??
          (entryNode.date as unknown);

        if (dateNode) {
          const dateText = flattenTeiNode(dateNode as XmlNode).text;
          const yearMatch = dateText.match(/(\d{4})/);
          if (yearMatch) {
            year = Number(yearMatch[1]);
          }
        }

        const idnos = collectIdnos(entryNode);

        const source =
          monogr && monogr.title
            ? flattenTeiNode(monogr.title as XmlNode).text
            : undefined;

        references.push({
          id,
          title,
          authors,
          year,
          source,
          doi: idnos.doi,
          url: idnos.url ?? idnos.uri ?? idnos.link,
        });
      });
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        walk(value);
      }
    }
  };

  walk(back);

  return references;
}

function parseTeiFigures(body: unknown): PaperFigure[] {
  const figures: PaperFigure[] = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }

    if ('figure' in node) {
      const entries = ensureArray(
        (node as { figure?: unknown }).figure as unknown,
      );

      entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }

        const entryNode = entry as TeiNode;
        const id = resolveNodeId(entryNode, 'figure', index);

        const captionNode =
          entryNode.figDesc ??
          entryNode.caption ??
          entryNode.head ??
          entryNode['figDesc'];
        const caption = captionNode
          ? flattenTeiNode(captionNode as XmlNode).text
          : undefined;

        if (!caption) {
          return;
        }

        let imageUrl: string | undefined;

        if (
          entryNode.graphic &&
          typeof entryNode.graphic === 'object' &&
          '@_url' in entryNode.graphic &&
          typeof (entryNode.graphic as { '@_url'?: string })['@_url'] ===
            'string'
        ) {
          imageUrl = (entryNode.graphic as { '@_url': string })['@_url'];
        }

        figures.push({
          id,
          caption,
          label:
            typeof entryNode.head === 'string'
              ? normalizeWhitespace(entryNode.head)
              : undefined,
          imageUrl,
        });
      });
    }

    const values = Object.values(node);
    values.forEach((value) => {
      if (value && typeof value === 'object') {
        visit(value);
      }
    });
  };

  visit(body);

  return figures;
}

export async function fetchGrobidTei(
  pdfPayload: ArrayBuffer,
  environment: IngestEnvironmentConfig = getIngestEnvironment(),
): Promise<string | undefined> {
  if (!environment.grobidUrl) {
    return undefined;
  }

  const url = `${environment.grobidUrl}/api/processFulltextDocument`;
  const formData = new FormData();
  formData.append(
    'input',
    new Blob([pdfPayload], { type: 'application/pdf' }),
    'paper.pdf',
  );
  formData.append('consolidateHeader', '1');
  formData.append('consolidateCitations', '1');
  formData.append('includeRawCitations', '1');

  const response = await fetchWithTimeout(url, environment.grobidTimeoutMs, {
    method: 'POST',
    body: formData,
    headers: {
      Accept: 'application/xml',
    },
  });

  if (!response.ok) {
    throw new Error(
      `GROBID request failed (${response.status} ${response.statusText})`,
    );
  }

  return response.text();
}

export function parseGrobidTei(teiXml: string): ParsedTeiResult | undefined {
  if (!teiXml.trim()) {
    return undefined;
  }

  const parsed = xmlParser.parse(teiXml) as Record<string, unknown>;
  const tei = parsed.TEI as {
    text?: Record<string, unknown>;
  } | undefined;

  if (!tei?.text) {
    return undefined;
  }

  const body = tei.text.body;
  const back = tei.text.back;

  const sections = body ? parseTeiSections(body) : [];
  const references = back ? parseTeiReferences(back) : [];
  const figures = body ? parseTeiFigures(body) : [];

  let pageCount: number | undefined;

  if (
    tei.text.front &&
    typeof tei.text.front === 'object' &&
    'docTitle' in tei.text.front
  ) {
    const front = tei.text.front as Record<string, unknown>;
    if (
      'extent' in front &&
      typeof front.extent === 'object' &&
      front.extent !== null &&
      'unit' in front.extent &&
      (front.extent as { unit?: string }).unit === 'pages'
    ) {
        const { text } = flattenTeiNode(front.extent as XmlNode);
      const numeric = parseInt(text, 10);
      if (Number.isFinite(numeric)) {
        pageCount = numeric;
      }
    }
  }

  return {
    sections,
    references,
    figures,
    pageCount,
  };
}
