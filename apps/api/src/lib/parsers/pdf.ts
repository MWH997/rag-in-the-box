import { extractText, getDocumentProxy } from "unpdf";

export interface PdfTextExtraction {
  text: string;
  totalPages: number;
  charsPerPage: number[];
}

export async function extractPdfText(buf: ArrayBuffer): Promise<PdfTextExtraction> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(pdf, { mergePages: false });

  return {
    text: text.join("\n"),
    totalPages,
    charsPerPage: text.map((pageText) => pageText.length),
  };
}
