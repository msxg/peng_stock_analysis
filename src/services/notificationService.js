import nodemailer from 'nodemailer';
import { systemRepository } from '../repositories/systemRepository.js';

function readConfig(key, fallback = '') {
  const value = systemRepository.getConfigValue(key);
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim();
}

function readBoolean(key, fallback = false) {
  const value = readConfig(key, fallback ? 'true' : 'false').toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function buildTransportOptions() {
  return {
    host: readConfig('EMAIL_SMTP_HOST'),
    port: Number(readConfig('EMAIL_SMTP_PORT', '465')),
    secure: readBoolean('EMAIL_SMTP_SECURE', true),
    auth: {
      user: readConfig('EMAIL_SENDER'),
      pass: readConfig('EMAIL_PASSWORD'),
    },
    connectionTimeout: 8000,
    socketTimeout: 8000,
  };
}

function getReceivers() {
  return readConfig('EMAIL_RECEIVERS')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSummaryText(results = []) {
  if (!results.length) return '无分析结果';
  return results
    .map((item, index) => {
      return [
        `${index + 1}. ${item.stockCode} ${item.stockName || ''}`.trim(),
        `   结论：${item.recommendation || '-'}`,
        `   置信度：${item.confidence ?? '-'}%`,
        `   买入/止损/目标：${item.buyPrice ?? '-'} / ${item.stopLoss ?? '-'} / ${item.targetPrice ?? '-'}`,
      ].join('\n');
    })
    .join('\n\n');
}

function buildMailContent({ source, taskId, results }) {
  const date = new Date().toLocaleString('zh-CN', { hour12: false });
  const title = source === 'async'
    ? `[Stock Analysis] 任务完成 ${taskId?.slice(0, 8) || ''}`
    : '[Stock Analysis] 同步分析完成';

  const text = [
    `时间：${date}`,
    `来源：${source === 'async' ? '异步任务' : '同步分析'}`,
    taskId ? `任务ID：${taskId}` : '',
    '',
    '分析摘要：',
    buildSummaryText(results),
    '',
    '提示：本邮件仅供学习研究，不构成投资建议。',
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.6;color:#1f2937">
      <h2 style="margin-bottom:8px">股票分析通知</h2>
      <p><strong>时间：</strong>${date}</p>
      <p><strong>来源：</strong>${source === 'async' ? '异步任务' : '同步分析'}</p>
      ${taskId ? `<p><strong>任务ID：</strong>${taskId}</p>` : ''}
      <h3 style="margin-top:16px">分析摘要</h3>
      <pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap">${buildSummaryText(results)}</pre>
      <p style="margin-top:14px;color:#6b7280">提示：本邮件仅供学习研究，不构成投资建议。</p>
    </div>
  `;

  return { title, text, html };
}

export const notificationService = {
  isEmailEnabled() {
    return readBoolean('EMAIL_ENABLED', false);
  },

  async sendAnalysisEmail({ source, taskId, results }) {
    if (!this.isEmailEnabled()) {
      return { sent: false, reason: 'EMAIL_ENABLED=false' };
    }

    const sender = readConfig('EMAIL_SENDER');
    const password = readConfig('EMAIL_PASSWORD');
    const host = readConfig('EMAIL_SMTP_HOST');
    const receivers = getReceivers();

    if (!sender || !password || !host || !receivers.length) {
      return {
        sent: false,
        reason: '缺少邮件配置（EMAIL_SMTP_HOST/EMAIL_SENDER/EMAIL_PASSWORD/EMAIL_RECEIVERS）',
      };
    }

    const transporter = nodemailer.createTransport(buildTransportOptions());
    const content = buildMailContent({ source, taskId, results });

    const info = await transporter.sendMail({
      from: sender,
      to: receivers.join(','),
      subject: content.title,
      text: content.text,
      html: content.html,
    });

    return {
      sent: true,
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
    };
  },

  async sendTestEmail() {
    return this.sendAnalysisEmail({
      source: 'sync',
      taskId: null,
      results: [
        {
          stockCode: 'TEST',
          stockName: '邮件测试',
          recommendation: '测试邮件通知链路',
          confidence: 100,
          buyPrice: '-',
          stopLoss: '-',
          targetPrice: '-',
        },
      ],
    });
  },
};
