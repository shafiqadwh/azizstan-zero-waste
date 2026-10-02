/**
 * FR-D5 (T32): every current PDF of a round merged into one file, in document-number order, for printing or
 * filing. Built from the stored PDFs (the same documents people already received), not re-rendered.
 * Only approved evaluations are included; a PDF missing on disk is skipped and listed on a cover page.
 */
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Db } from '../../../db/client.ts';
import { notFound } from '../errors.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as pdfRepo from '../repositories/pdf.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';
import { dataDir, resolveData } from '../storage.ts';

export interface MergedRoundPdf {
  filename: string;
  bytes: Uint8Array;
  documents: number;
  missing: string[];
}

export async function mergeRoundPdfs(
  db: Db,
  actor: SessionUser,
  roundId: string,
  opts: { root?: string } = {},
): Promise<MergedRoundPdf> {
  assertCan(actor, 'staff.read');
  const round = await termsRepo.findRound(db, roundId);
  const term = round ? await termsRepo.findTerm(db, round.termId) : null;
  if (!round || !term || term.purgedAt) throw notFound();
  const root = opts.root ?? dataDir();
  const rows = (await pdfRepo.listCurrentPdfFilesInRound(db, roundId)).filter((r) => r.evaluationStatus === 'approved');

  const out = await PDFDocument.create();
  out.setTitle(`ZERO WASTE ${term.termNo}/${term.academicYear} รอบที่ ${round.roundNo}`);
  out.setProducer('AZIZSTAN ZERO WASTE');
  const missing: string[] = [];
  let documents = 0;
  for (const r of rows) {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(await readFile(resolveData(r.filePath, root)));
    } catch {
      missing.push(`${r.docNumber} v${r.version}`);
      continue;
    }
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    documents++;
  }
  if (missing.length || documents === 0) {
    // Latin-only font: the cover lists document numbers, which are ASCII
    const font = await out.embedFont(StandardFonts.Helvetica);
    const cover = out.insertPage(0, [595.28, 841.89]);
    const lines = [
      `ZERO WASTE ${term.termNo}/${term.academicYear} - round ${round.roundNo}`,
      `${documents} document(s) merged.`,
      ...(missing.length ? ['Missing files (not included):', ...missing.map((m) => `  ${m}`)] : []),
    ];
    lines
      .slice(0, 60)
      .forEach((text, i) =>
        cover.drawText(text, { x: 50, y: 790 - i * 18, size: i === 0 ? 14 : 11, font, color: rgb(0.09, 0.13, 0.11) }),
      );
  }
  return {
    filename: `round-${term.academicYear}-${term.termNo}-r${round.roundNo}.pdf`,
    bytes: await out.save(),
    documents,
    missing,
  };
}
