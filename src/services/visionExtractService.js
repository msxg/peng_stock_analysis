import fs from 'fs';
import path from 'path';
import { parseStockList } from '../utils/stockCode.js';

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  try {
    const direct = JSON.parse(raw);
    return Array.isArray(direct) ? direct : [];
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

async function callVisionModel(filePath, mimeType) {
  const baseUrl = process.env.VISION_BASE_URL || '';
  const apiKey = process.env.VISION_API_KEY || '';
  const model = process.env.VISION_MODEL || 'gpt-4o-mini';

  if (!baseUrl || !apiKey) {
    return [];
  }

  const imageBase64 = fs.readFileSync(filePath).toString('base64');
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const prompt = [
    '请从图片中提取股票代码和名称。',
    '输出 JSON 数组，元素格式：{"code":"600519","name":"贵州茅台","confidence":0.9}',
    '只输出 JSON，不要解释。',
  ].join('\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a precise stock code extractor.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision HTTP ${response.status}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content || '';
  const items = parseJsonFromText(content);

  return items
    .map((item) => ({
      code: String(item.code || '').toUpperCase().trim(),
      name: String(item.name || item.code || '').trim(),
      confidence: Number(item.confidence || 0.75),
      source: 'vision_llm',
    }))
    .filter((item) => item.code);
}

export const visionExtractService = {
  async extractStocks(file) {
    if (!file?.path) return [];

    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

    try {
      const items = await callVisionModel(file.path, mimeType);
      if (items.length) return items;
    } catch {
      // ignore and fallback
    }

    return parseStockList(file.originalname || '').map((code) => ({
      code,
      name: code,
      confidence: 0.55,
      source: 'image_filename',
    }));
  },
};
