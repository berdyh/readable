import { NextRequest, NextResponse } from 'next/server';

import { getIngestEnvironment } from '@/server/ingest/config';
import { runDeepSeekOcr } from '@/server/ingest/ocr';
import { extractPdfText, shouldUseOcr } from '@/server/ingest/pdf';

const TEXT_THRESHOLD =
  Number(process.env.INGEST_PDF_TEXT_THRESHOLD ?? 1_000);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const environment = getIngestEnvironment();

    const pdfExtraction = await extractPdfText(bytes);

    const hasOcrEndpoint =
      Boolean(environment.deepSeekOcrUrl) ||
      (Boolean(environment.runpodApiKey) &&
        Boolean(environment.runpodEndpointId));

    const allowOcr =
      environment.enableOcrFallback &&
      hasOcrEndpoint &&
      shouldUseOcr(
        pdfExtraction.analysis,
        pdfExtraction.combinedText.length,
        TEXT_THRESHOLD,
      );

    let method: 'pdfjs-dist' | 'deepseek-ocr' = 'pdfjs-dist';
    let extraction = pdfExtraction;
    let ocrAttempted = false;

    if (allowOcr) {
      ocrAttempted = true;
      try {
        const ocrResult = await runDeepSeekOcr(bytes, environment);
        if (ocrResult) {
          method = 'deepseek-ocr';
          extraction = ocrResult;
        }
      } catch (error) {
        console.warn('[extract-research-paper] DeepSeek OCR fallback failed', error);
      }
    }

    return NextResponse.json({
      method,
      analysis: pdfExtraction.analysis,
      text: extraction.pages.map((page) => page.text),
      figures: extraction.figures.map((figure) => ({
        id: figure.id,
        page: figure.pageNumber,
        label: figure.label,
        number: figure.number,
        caption: figure.caption,
      })),
      tables: extraction.tables.map((table) => ({
        id: table.id,
        page: table.pageNumber,
        label: table.label,
        number: table.number,
        caption: table.caption,
      })),
      images: extraction.images,
      stats: {
        pages: extraction.pages.length,
        combinedTextLength: extraction.combinedText.length,
        ocrAttempted,
      },
    });
  } catch (error) {
    console.error('PDF extraction error:', error);
    return NextResponse.json(
      { error: 'Failed to extract PDF content' },
      { status: 500 },
    );
  }
}
