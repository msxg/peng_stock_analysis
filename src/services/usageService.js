import dayjs from 'dayjs';
import { analysisRepository } from '../repositories/analysisRepository.js';

function getDateRange(period = '7d') {
  const end = dayjs();
  switch (period) {
    case '24h':
      return { start: end.subtract(1, 'day'), end };
    case '30d':
      return { start: end.subtract(30, 'day'), end };
    case '90d':
      return { start: end.subtract(90, 'day'), end };
    case '7d':
    default:
      return { start: end.subtract(7, 'day'), end };
  }
}

export const usageService = {
  getSummary(period = '7d') {
    const range = getDateRange(period);
    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      ...analysisRepository.getUsageSummary(range.start.format('YYYY-MM-DD HH:mm:ss'), range.end.format('YYYY-MM-DD HH:mm:ss')),
    };
  },
};
