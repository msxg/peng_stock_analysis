import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { parseStockList, normalizeStockCode } from '../utils/stockCode.js';
import { nameResolverService } from './nameResolverService.js';
import { visionExtractService } from './visionExtractService.js';

function normalizeLine(line) {
  return String(line || '').trim().replace(/[\t ]+/g, ' ');
}

function isLikelyCode(text) {
  return /^(hk\d{5}|\d{5,6}|[a-z]{2,10})$/i.test(String(text || '').trim());
}

function uniqueByCode(items) {
  const map = new Map();
  items.forEach((item) => {
    const code = normalizeStockCode(item.code);
    if (!code) return;

    const existing = map.get(code);
    if (!existing || Number(item.confidence || 0) > Number(existing.confidence || 0)) {
      map.set(code, {
        ...item,
        code,
        confidence: Number(item.confidence || 0.5),
        confidenceLevel: item.confidenceLevel || nameResolverService.confidenceLevel(Number(item.confidence || 0.5)),
      });
    }
  });
  return Array.from(map.values());
}

async function resolveLine(line, source) {
  const normalized = normalizeLine(line);
  if (!normalized) return null;

  const chunks = normalized.split(/[\s,，;；|]+/).filter(Boolean);
  const directToken = chunks.find((chunk) => isLikelyCode(chunk));

  if (directToken) {
    const code = normalizeStockCode(directToken);
    const name = normalized.replace(directToken, '').trim() || code;
    const confidence = name && name !== code ? 0.92 : 0.84;
    return {
      code,
      name,
      confidence,
      confidenceLevel: nameResolverService.confidenceLevel(confidence),
      source,
    };
  }

  const nameKeyword = chunks.join(' ').trim();
  if (!nameKeyword) return null;

  const resolved = await nameResolverService.resolveNameToCode(nameKeyword);
  if (!resolved) {
    return {
      code: '',
      name: nameKeyword,
      confidence: 0.35,
      confidenceLevel: 'low',
      source: `${source}_unresolved`,
    };
  }

  return {
    code: normalizeStockCode(resolved.code),
    name: resolved.name || nameKeyword,
    confidence: resolved.confidence,
    confidenceLevel: resolved.confidenceLevel,
    source: `${source}+${resolved.source}`,
  };
}

async function parseTextLines(text, source = 'text') {
  const lines = String(text || '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const results = [];

  for (const line of lines) {
    const resolved = await resolveLine(line, source);
    if (resolved) results.push(resolved);
  }

  return results;
}

function parseWorkbookRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const lines = [];

  workbook.SheetNames.forEach((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
    rows.forEach((row) => {
      const joined = row.filter(Boolean).join(' ').trim();
      if (joined) lines.push(joined);
    });
  });

  return lines;
}

async function parseWithNameFallback(text, source = 'text') {
  const direct = await parseTextLines(text, source);
  const valid = direct.filter((item) => item.code);
  if (valid.length) return uniqueByCode(valid);

  const fromCodes = parseStockList(text).map((code) => ({
    code,
    name: code,
    confidence: 0.75,
    confidenceLevel: nameResolverService.confidenceLevel(0.75),
    source: `${source}_code_fallback`,
  }));

  return uniqueByCode(fromCodes);
}

export const importService = {
  async parseFromText(text) {
    return parseWithNameFallback(text, 'text');
  },

  async parseFromFile(file) {
    if (!file) return [];
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (ext === '.csv' || ext === '.txt') {
      const text = fs.readFileSync(file.path, 'utf8');
      return parseWithNameFallback(text, 'file_csv');
    }

    if (ext === '.xlsx' || ext === '.xls') {
      const lines = parseWorkbookRows(file.path);
      const merged = lines.join('\n');
      return parseWithNameFallback(merged, 'file_excel');
    }

    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      return this.extractFromImage(file);
    }

    return [];
  },

  async extractFromImage(file) {
    const visionItems = await visionExtractService.extractStocks(file);

    if (!visionItems.length) {
      return [];
    }

    const normalized = [];
    for (const item of visionItems) {
      if (item.code && isLikelyCode(item.code)) {
        const confidence = Number(item.confidence || 0.7);
        normalized.push({
          code: normalizeStockCode(item.code),
          name: item.name || normalizeStockCode(item.code),
          confidence,
          confidenceLevel: nameResolverService.confidenceLevel(confidence),
          source: item.source || 'image_vision',
        });
        continue;
      }

      const resolved = await nameResolverService.resolveNameToCode(item.name);
      if (resolved) {
        normalized.push({
          code: normalizeStockCode(resolved.code),
          name: resolved.name || item.name,
          confidence: resolved.confidence,
          confidenceLevel: resolved.confidenceLevel,
          source: `image_name+${resolved.source}`,
        });
      }
    }

    return uniqueByCode(normalized);
  },
};
