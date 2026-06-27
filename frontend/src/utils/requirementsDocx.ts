import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ShadingType,
} from 'docx';
import { saveAs } from 'file-saver';
import type { ExtractedRequirement } from '../types';

const FONT = 'Times New Roman';
const HEADER_FILL = 'E6E6E6';

const cellBorder = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: '000000',
};

const ALL_BORDERS = {
  top: cellBorder,
  bottom: cellBorder,
  left: cellBorder,
  right: cellBorder,
};

function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: HEADER_FILL },
    borders: ALL_BORDERS,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, font: FONT, size: 24 })],
      }),
    ],
  });
}

function bodyCell(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): TableCell {
  return new TableCell({
    borders: ALL_BORDERS,
    children: [
      new Paragraph({
        alignment: opts.align,
        children: [new TextRun({ text, bold: opts.bold, font: FONT, size: 24 })],
      }),
    ],
  });
}

function buildSection(number: number, title: string, items: ExtractedRequirement[]): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text: `${number}. ${title}`, bold: true, font: FONT, size: 32, color: '000000' })],
    }),
  ];

  if (items.length === 0) {
    blocks.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Требований этого типа в документе не выявлено.',
            italics: true,
            font: FONT,
            size: 24,
          }),
        ],
      }),
    );
    return blocks;
  }

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('№', 6),
      headerCell('Наименование', 22),
      headerCell('Описание', 34),
      headerCell('Риск', 26),
      headerCell('Критичность', 12),
    ],
  });

  const rows = items.map(
    (r, i) =>
      new TableRow({
        children: [
          bodyCell(`${number}.${i + 1}`, { bold: true, align: AlignmentType.CENTER }),
          bodyCell(r.title || '-'),
          bodyCell(r.statement, { align: AlignmentType.JUSTIFIED }),
          bodyCell(r.risk || '-', { align: AlignmentType.JUSTIFIED }),
          bodyCell(r.criticality || '-', { align: AlignmentType.CENTER }),
        ],
      }),
  );

  blocks.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows],
    }),
  );

  return blocks;
}

function safeFileName(name: string): string {
  const base = (name || 'requirements').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return `${base || 'requirements'}.docx`;
}

export async function downloadRequirementsDocx(
  ft: ExtractedRequirement[],
  nft: ExtractedRequirement[],
  docTitle: string,
): Promise<void> {
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 24 } },
      },
    },
    sections: [
      {
        properties: {},
        children: [
          ...buildSection(1, 'Функциональные требования', ft),
          ...buildSection(2, 'Нефункциональные требования', nft),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, safeFileName(docTitle ? `Реестр требований - ${docTitle}` : 'Реестр требований'));
}
