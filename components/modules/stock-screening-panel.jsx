'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { clientApi } from '@/lib/client-api';

const SUB_MARKET_OPTIONS = [
  { value: 'SH', label: '上证 (SH)' },
  { value: 'SZ', label: '深证 (SZ)' },
  { value: 'BJ', label: '北交所 (BJ)' },
];

const BOARD_SEGMENT_OPTIONS = [
  { value: 'MAIN', label: '主板 (MAIN)' },
  { value: 'GEM', label: '创业板 (GEM)' },
  { value: 'STAR', label: '科创板 (STAR)' },
];

const CALCULATION_MODE_OPTIONS = [
  { value: 'range', label: '区间口径 (range)' },
  { value: 'latest', label: '末日口径 (latest)' },
];

const LATEST_FIELD_OPTIONS = [
  { value: 'close', label: '收盘价 (close)' },
  { value: 'open', label: '开盘价 (open)' },
  { value: 'high', label: '最高价 (high)' },
  { value: 'low', label: '最低价 (low)' },
  { value: 'pctChg', label: '涨跌幅 (pctChg)' },
  { value: 'vol', label: '成交量 (vol)' },
  { value: 'amount', label: '成交额 (amount)' },
];

const RANGE_FIELD_OPTIONS = [
  { value: 'close', label: '区间结束收盘 (close)' },
  { value: 'open', label: '区间起始开盘 (open)' },
  { value: 'preClose', label: '区间起始昨收 (preClose)' },
  { value: 'high', label: '区间最高价 (high)' },
  { value: 'low', label: '区间最低价 (low)' },
  { value: 'pctChg', label: '区间涨跌幅 (pctChg)' },
  { value: 'change', label: '区间涨跌额 (change)' },
  { value: 'vol', label: '区间总成交量 (vol)' },
  { value: 'amount', label: '区间总成交额 (amount)' },
  { value: 'rangeStartPreClose', label: '区间起始昨收 (rangeStartPreClose)' },
  { value: 'rangeStartOpen', label: '区间起始开盘 (rangeStartOpen)' },
  { value: 'rangeStartClose', label: '区间起始收盘 (rangeStartClose)' },
  { value: 'rangeEndOpen', label: '区间结束开盘 (rangeEndOpen)' },
  { value: 'rangeEndClose', label: '区间结束收盘 (rangeEndClose)' },
  { value: 'rangeEndHigh', label: '区间结束最高 (rangeEndHigh)' },
  { value: 'rangeEndLow', label: '区间结束最低 (rangeEndLow)' },
  { value: 'rangeChange', label: '区间涨跌额 (rangeChange)' },
  { value: 'rangeTotalVol', label: '区间总成交量 (rangeTotalVol)' },
  { value: 'rangeTotalAmount', label: '区间总成交额 (rangeTotalAmount)' },
];

const INDICATOR_OPTIONS = [
  { value: 'ma5', label: '5日均线 (ma5)' },
  { value: 'ma10', label: '10日均线 (ma10)' },
  { value: 'ma20', label: '20日均线 (ma20)' },
  { value: 'ma60', label: '60日均线 (ma60)' },
];

const METRIC_OPTIONS = [
  { value: 'pctChgN', label: 'N日涨跌幅 (pctChgN)' },
  { value: 'rangeAvgClose', label: '区间均价 (rangeAvgClose)' },
  { value: 'rangeMaxClose', label: '区间最高收盘价 (rangeMaxClose)' },
  { value: 'rangeMinClose', label: '区间最低收盘价 (rangeMinClose)' },
  { value: 'rangePctChg', label: '区间涨跌幅 (rangePctChg)' },
  { value: 'rangeAmp', label: '区间振幅 (rangeAmp)' },
  { value: 'upDayRatio', label: '区间阳线占比 (upDayRatio)' },
  { value: 'maxDrawdown', label: '区间最大回撤 (maxDrawdown)' },
];

const OPERATOR_OPTIONS = ['>', '>=', '<', '<=', '==', '!='];

const SORT_FIELD_OPTIONS = [
  { value: 'pctChgN', label: '20日涨跌幅 (pctChgN20)' },
  { value: 'close', label: '收盘价 (close)' },
  { value: 'open', label: '开盘价 (open)' },
  { value: 'pctChg', label: '涨跌幅 (pctChg)' },
  { value: 'ma20', label: '20日均线 (ma20)' },
  { value: 'rangeAvgClose', label: '区间均价 (rangeAvgClose)' },
  { value: 'rangeMaxClose', label: '区间最高收盘价 (rangeMaxClose)' },
  { value: 'rangeMinClose', label: '区间最低收盘价 (rangeMinClose)' },
  { value: 'rangePctChg', label: '区间涨跌幅 (rangePctChg)' },
  { value: 'rangeAmp', label: '区间振幅 (rangeAmp)' },
  { value: 'upDayRatio', label: '区间阳线占比 (upDayRatio)' },
  { value: 'maxDrawdown', label: '区间最大回撤 (maxDrawdown)' },
  { value: 'rangeStartPreClose', label: '区间起始昨收 (rangeStartPreClose)' },
  { value: 'rangeStartOpen', label: '区间起始开盘 (rangeStartOpen)' },
  { value: 'rangeEndOpen', label: '区间结束开盘 (rangeEndOpen)' },
  { value: 'rangeEndClose', label: '区间结束收盘 (rangeEndClose)' },
  { value: 'totalMarketCap', label: '总市值 (totalMarketCap)' },
  { value: 'code', label: '代码 (code)' },
  { value: 'name', label: '名称 (name)' },
];

const FIELD_LABEL_MAP = {
  close: '收盘价',
  open: '开盘价',
  high: '最高价',
  low: '最低价',
  preClose: '昨收价',
  change: '涨跌额',
  pctChg: '涨跌幅',
  vol: '成交量',
  amount: '成交额',
  ma5: '5日均线',
  ma10: '10日均线',
  ma20: '20日均线',
  ma60: '60日均线',
  pctChgN: 'N日涨跌幅',
  rangeAvgClose: '区间均价',
  rangeMaxClose: '区间最高收盘价',
  rangeMinClose: '区间最低收盘价',
  rangePctChg: '区间涨跌幅',
  rangeAmp: '区间振幅',
  upDayRatio: '区间阳线占比',
  maxDrawdown: '区间最大回撤',
  rangeStartPreClose: '区间起始昨收',
  rangeStartOpen: '区间起始开盘',
  rangeStartClose: '区间起始收盘',
  rangeEndOpen: '区间结束开盘',
  rangeEndHigh: '区间结束最高',
  rangeEndLow: '区间结束最低',
  rangeEndClose: '区间结束收盘',
  rangeChange: '区间涨跌额',
  rangeTotalVol: '区间总成交量',
  rangeTotalAmount: '区间总成交额',
  totalMarketCap: '总市值',
  code: '代码',
  name: '名称',
};

function formatDateInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function oneMonthAgoInput(baseDate = new Date()) {
  const d = baseDate instanceof Date ? new Date(baseDate) : new Date(baseDate);
  d.setMonth(d.getMonth() - 1);
  return formatDateInput(d);
}

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && String(value).trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toPositiveInt(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.floor(num));
}

function toNonNegativeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

function formatNum(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

function displayFieldName(key = '') {
  const text = String(key || '').trim();
  if (!text) return '--';
  const label = FIELD_LABEL_MAP[text] || text;
  return `${label} (${text})`;
}

function formatRuleToken(type = '', name = '', metricDays = '') {
  if (type === 'metric' && name === 'pctChgN') {
    const days = toPositiveInt(metricDays, 20);
    return `N日涨跌幅(${days}) (pctChgN(${days}))`;
  }
  if (type === 'const') return String(name ?? '--');
  return displayFieldName(name);
}

function formatHitRuleText(ruleText = '') {
  const raw = String(ruleText || '').trim();
  if (!raw) return '--';
  return raw.replace(
    /\bpctChgN\((\d+)\)|\b(rangeAvgClose|rangeMaxClose|rangeMinClose|rangePctChg|rangeAmp|upDayRatio|maxDrawdown|rangeStartPreClose|rangeStartOpen|rangeStartClose|rangeEndOpen|rangeEndHigh|rangeEndLow|rangeEndClose|rangeChange|rangeTotalVol|rangeTotalAmount|ma5|ma10|ma20|ma60|close|open|high|low|preClose|change|pctChg|vol|amount)\b/g,
    (matched, days, token) => {
      if (days) return `N日涨跌幅(${days})`;
      return FIELD_LABEL_MAP[token] || matched;
    },
  );
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[,"\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function createRuleDraft() {
  return {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    leftType: 'field',
    leftName: 'close',
    leftMetricDays: '20',
    operator: '>',
    rightType: 'indicator',
    rightName: 'ma20',
    rightMetricDays: '20',
    rightConstValue: '0',
  };
}

function buildOperand(rule, side = 'left') {
  const type = side === 'left' ? rule.leftType : rule.rightType;
  const name = side === 'left' ? rule.leftName : rule.rightName;
  const metricDays = side === 'left' ? rule.leftMetricDays : rule.rightMetricDays;
  const constValue = side === 'left' ? rule.leftConstValue : rule.rightConstValue;

  if (type === 'field') {
    return {
      type,
      name,
    };
  }

  if (type === 'indicator') {
    return {
      type,
      name,
    };
  }

  if (type === 'metric') {
    const payload = {
      type,
      name,
    };
    if (name === 'pctChgN') {
      payload.args = {
        days: toPositiveInt(metricDays, 20),
      };
    }
    return payload;
  }

  return {
    type: 'const',
    value: Number(constValue || 0),
  };
}

function operandDisplay(rule, side = 'left') {
  const type = side === 'left' ? rule.leftType : rule.rightType;
  const name = side === 'left' ? rule.leftName : rule.rightName;
  const metricDays = side === 'left' ? rule.leftMetricDays : rule.rightMetricDays;
  const constValue = side === 'left' ? rule.leftConstValue : rule.rightConstValue;

  if (type === 'metric' && name === 'pctChgN') return formatRuleToken(type, name, metricDays);
  if (type === 'const') return String(constValue || '0');
  return formatRuleToken(type, name, metricDays);
}

function makeRangeLabel(startDay, endDay) {
  return `${startDay} ~ ${endDay}`;
}

function MultiCheck({ title, options, values, onChange }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <label
              key={option.value}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-sm ${checked ? 'border-primary/70 bg-primary/10' : 'border-border/70'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (checked) {
                    onChange(values.filter((item) => item !== option.value));
                    return;
                  }
                  onChange([...values, option.value]);
                }}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RuleOperandEditor({ rule, side = 'left', onChange, fieldOptions = LATEST_FIELD_OPTIONS }) {
  const typeKey = side === 'left' ? 'leftType' : 'rightType';
  const nameKey = side === 'left' ? 'leftName' : 'rightName';
  const metricDaysKey = side === 'left' ? 'leftMetricDays' : 'rightMetricDays';
  const constValueKey = side === 'left' ? 'leftConstValue' : 'rightConstValue';

  const operandType = rule[typeKey];
  const operandName = rule[nameKey];

  const options = operandType === 'field'
    ? fieldOptions
    : (operandType === 'indicator' ? INDICATOR_OPTIONS : METRIC_OPTIONS);

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        value={operandType}
        onChange={(e) => {
          const nextType = e.target.value;
          const fallbackName = nextType === 'field'
            ? (fieldOptions[0]?.value || 'close')
            : (nextType === 'indicator' ? 'ma20' : (nextType === 'metric' ? 'pctChgN' : ''));
          onChange((prev) => ({
            ...prev,
            [typeKey]: nextType,
            [nameKey]: fallbackName,
          }));
        }}
      >
        <option value="field">字段 (field)</option>
        <option value="indicator">指标 (indicator)</option>
        <option value="metric">度量 (metric)</option>
        <option value="const">常数 (const)</option>
      </select>

      {operandType === 'const' ? (
        <Input
          className="w-28"
          value={rule[constValueKey] || '0'}
          onChange={(e) => onChange((prev) => ({ ...prev, [constValueKey]: e.target.value }))}
          placeholder="常数"
        />
      ) : (
        <>
          <select
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={operandName}
            onChange={(e) => onChange((prev) => ({ ...prev, [nameKey]: e.target.value }))}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {operandType === 'metric' && operandName === 'pctChgN' ? (
            <Input
              className="w-24"
              value={rule[metricDaysKey] || '20'}
              onChange={(e) => onChange((prev) => ({ ...prev, [metricDaysKey]: e.target.value }))}
              placeholder="天数"
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export function StockScreeningPanel() {
  const today = useMemo(() => formatDateInput(new Date()), []);
  const oneMonthAgo = useMemo(() => oneMonthAgoInput(new Date()), []);

  const [querying, setQuerying] = useState(false);
  const [message, setMessage] = useState('');

  const [monitorCategories, setMonitorCategories] = useState([]);
  const [bluechipPools, setBluechipPools] = useState([]);

  const [form, setForm] = useState({
    calculationMode: 'range',
    subMarkets: ['SH', 'SZ'],
    boardSegments: ['MAIN', 'GEM', 'STAR'],
    startDate: oneMonthAgo,
    endDate: today,
    totalMarketCapMin: '',
    totalMarketCapMax: '',
    listingDaysMin: '',
    sortField: 'rangePctChg',
    sortOrder: 'desc',
    limit: '200',
    monitorCategoryId: '',
    bluechipPoolId: '',
  });

  const [rules, setRules] = useState([createRuleDraft()]);

  const [queryState, setQueryState] = useState({
    page: 1,
    total: 0,
    items: [],
    dataAsOf: '',
    warning: '',
    applied: null,
  });

  const [selectedCodes, setSelectedCodes] = useState([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [monitorDialogOpen, setMonitorDialogOpen] = useState(false);
  const [poolDialogOpen, setPoolDialogOpen] = useState(false);
  const [allResultSelected, setAllResultSelected] = useState(false);
  const [creatingPool, setCreatingPool] = useState(false);
  const [newPoolName, setNewPoolName] = useState('');
  const [showPoolCreate, setShowPoolCreate] = useState(false);

  const activeFieldOptions = useMemo(() => (
    form.calculationMode === 'latest' ? LATEST_FIELD_OPTIONS : RANGE_FIELD_OPTIONS
  ), [form.calculationMode]);

  useEffect(() => {
    async function loadDependencies() {
      try {
        const [categoriesRes, poolsRes] = await Promise.all([
          clientApi.stockMonitor.categories(),
          clientApi.strategy.bluechipPools(),
        ]);

        const categories = Array.isArray(categoriesRes?.items) ? categoriesRes.items : [];
        const pools = Array.isArray(poolsRes?.items) ? poolsRes.items : [];

        setMonitorCategories(categories);
        setBluechipPools(pools);
        setForm((prev) => ({
          ...prev,
          monitorCategoryId: prev.monitorCategoryId || (categories[0]?.id ? String(categories[0].id) : ''),
          bluechipPoolId: prev.bluechipPoolId || (pools[0]?.id ? String(pools[0].id) : ''),
        }));
      } catch (error) {
        setMessage(`基础数据加载失败：${error.message || '未知错误'}`);
      }
    }

    loadDependencies().catch(() => {});
  }, []);

  const allCurrentPageSelected = useMemo(() => {
    if (!queryState.items.length) return false;
    const currentCodes = queryState.items.map((item) => item.code);
    return currentCodes.every((code) => selectedCodes.includes(code));
  }, [queryState.items, selectedCodes]);

  useEffect(() => {
    const available = new Set(activeFieldOptions.map((item) => item.value));
    const fallbackField = activeFieldOptions[0]?.value || 'close';
    setRules((prev) => prev.map((rule) => {
      const next = { ...rule };
      if (next.leftType === 'field' && !available.has(next.leftName)) next.leftName = fallbackField;
      if (next.rightType === 'field' && !available.has(next.rightName)) next.rightName = fallbackField;
      return next;
    }));
  }, [activeFieldOptions]);

  function updateRule(ruleId, updater) {
    setRules((prev) => prev.map((item) => {
      if (item.id !== ruleId) return item;
      return typeof updater === 'function' ? updater(item) : updater;
    }));
  }

  function buildQueryPayload(page = 1) {
    const technicalRules = rules
      .map((rule) => ({
        left: buildOperand(rule, 'left'),
        operator: rule.operator,
        right: buildOperand(rule, 'right'),
      }));

    return {
      market: 'A',
      calculationMode: form.calculationMode,
      subMarkets: form.subMarkets,
      boardSegments: form.boardSegments,
      dateRange: {
        startDate: form.startDate,
        endDate: form.endDate,
      },
      fundamentals: {
        totalMarketCapMin: toNumberOrNull(form.totalMarketCapMin),
        totalMarketCapMax: toNumberOrNull(form.totalMarketCapMax),
        listingDaysMin: toNonNegativeInt(form.listingDaysMin, 0),
      },
      technicalRules,
      sort: {
        field: form.sortField,
        order: form.sortOrder,
      },
      page,
      limit: toPositiveInt(form.limit, 50),
    };
  }

  async function runQuery(page = 1) {
    setQuerying(true);
    setMessage('');
    try {
      if (!form.subMarkets.length) {
        throw new Error('请至少勾选一个子市场');
      }
      if (!form.boardSegments.length) {
        throw new Error('请至少勾选一个板块');
      }

      const payload = buildQueryPayload(page);
      const res = await clientApi.stockScreening.query(payload);

      setQueryState({
        page: Number(res?.page || page),
        total: Number(res?.total || 0),
        items: Array.isArray(res?.items) ? res.items : [],
        dataAsOf: String(res?.dataAsOf || ''),
        warning: String(res?.warning || ''),
        applied: res?.applied || null,
      });
      setSelectedCodes([]);
      setAllResultSelected(false);
      setMessage(`筛选完成：共 ${Number(res?.total || 0)} 条`);
    } catch (error) {
      setMessage(`筛选失败：${error.message || '未知错误'}`);
    } finally {
      setQuerying(false);
    }
  }

  function toggleSelectCode(code) {
    setSelectedCodes((prev) => {
      if (prev.includes(code)) {
        return prev.filter((item) => item !== code);
      }
      return [...prev, code];
    });
  }

  function toggleSelectCurrentPage() {
    const currentCodes = queryState.items.map((item) => item.code);
    if (!currentCodes.length) return;

    setSelectedCodes((prev) => {
      if (allCurrentPageSelected) {
        return prev.filter((code) => !currentCodes.includes(code));
      }
      const next = new Set(prev);
      currentCodes.forEach((code) => next.add(code));
      return Array.from(next);
    });
  }

  async function batchAddToMonitor() {
    const categoryId = Number(form.monitorCategoryId);
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      setMessage('请选择监控分类');
      return false;
    }
    if (!selectedCodes.length) {
      setMessage('请先勾选结果中的股票');
      return false;
    }

    setActionBusy(true);
    setMessage('');
    try {
      const chunkSize = 1000;
      let success = 0;
      let skipped = 0;
      let failed = 0;
      for (let i = 0; i < selectedCodes.length; i += chunkSize) {
        const chunk = selectedCodes.slice(i, i + chunkSize);
        const res = await clientApi.stockScreening.addToMonitor({
          categoryId,
          codes: chunk,
        });
        success += Number(res?.success || 0);
        skipped += Number(res?.skipped || 0);
        failed += Number(res?.failed || 0);
      }
      setMessage(`加入监控完成：成功 ${success}，跳过 ${skipped}，失败 ${failed}`);
      return true;
    } catch (error) {
      setMessage(`加入监控失败：${error.message || '未知错误'}`);
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function batchAddToBluechipPool() {
    const poolId = Number(form.bluechipPoolId);
    if (!Number.isFinite(poolId) || poolId <= 0) {
      setMessage('请选择标的池');
      return false;
    }
    if (!selectedCodes.length) {
      setMessage('请先勾选结果中的股票');
      return false;
    }

    setActionBusy(true);
    setMessage('');
    try {
      const chunkSize = 1000;
      let success = 0;
      let skipped = 0;
      let failed = 0;
      for (let i = 0; i < selectedCodes.length; i += chunkSize) {
        const chunk = selectedCodes.slice(i, i + chunkSize);
        const res = await clientApi.stockScreening.addToBluechipPool({
          poolId,
          codes: chunk,
        });
        success += Number(res?.success || 0);
        skipped += Number(res?.skipped || 0);
        failed += Number(res?.failed || 0);
      }
      setMessage(`加入标的池完成：成功 ${success}，跳过 ${skipped}，失败 ${failed}`);
      return true;
    } catch (error) {
      setMessage(`加入标的池失败：${error.message || '未知错误'}`);
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function selectAllResults() {
    if (allResultSelected) {
      setSelectedCodes([]);
      setAllResultSelected(false);
      return;
    }

    if (!queryState.total) {
      setMessage('暂无结果可全选，请先执行筛选');
      return;
    }

    setSelectingAll(true);
    setMessage('');
    try {
      const basePayload = buildQueryPayload(1);
      const pageSize = 200;
      const totalPages = Math.max(1, Math.ceil(Number(queryState.total || 0) / pageSize));
      const allCodes = [];

      for (let page = 1; page <= totalPages; page += 1) {
        const res = await clientApi.stockScreening.query({
          ...basePayload,
          page,
          limit: pageSize,
        });
        const codes = (Array.isArray(res?.items) ? res.items : [])
          .map((item) => String(item?.code || '').trim())
          .filter(Boolean);
        allCodes.push(...codes);
      }

      const uniqueCodes = Array.from(new Set(allCodes));
      setSelectedCodes(uniqueCodes);
      setAllResultSelected(true);
      setMessage(`已全选全部结果：${uniqueCodes.length} 只`);
    } catch (error) {
      setMessage(`全选失败：${error.message || '未知错误'}`);
    } finally {
      setSelectingAll(false);
    }
  }

  async function createBluechipPoolInline() {
    const name = String(newPoolName || '').trim();
    if (!name) {
      setMessage('请填写标的池名称');
      return;
    }

    setCreatingPool(true);
    setMessage('');
    try {
      const created = await clientApi.strategy.createBluechipPool({
        name,
        description: '条件选股页面快捷创建',
        isEnabled: true,
      });

      const poolsRes = await clientApi.strategy.bluechipPools();
      const pools = Array.isArray(poolsRes?.items) ? poolsRes.items : [];
      setBluechipPools(pools);
      setForm((prev) => ({
        ...prev,
        bluechipPoolId: created?.id ? String(created.id) : prev.bluechipPoolId,
      }));
      setNewPoolName('');
      setShowPoolCreate(false);
      setMessage(`标的池已创建并选中：${created?.name || name} (${created?.code || '--'})`);
    } catch (error) {
      setMessage(`创建标的池失败：${error.message || '未知错误'}`);
    } finally {
      setCreatingPool(false);
    }
  }

  async function exportAllResultsCsv() {
    if (!queryState.total) {
      setMessage('暂无结果可导出，请先执行筛选');
      return;
    }

    const headers = [
      '代码(code)',
      '名称(name)',
      '子市场(subMarket)',
      '板块(boardSegment)',
      '交易日(tradeDay)',
      '开盘价(startOpen)',
      '收盘价(close)',
      '20日均线(ma20)',
      '20日涨跌幅(pctChgN20)',
      '区间涨跌幅(rangePctChg)',
      '区间均价(rangeAvgClose)',
      '命中条件(hitRules)',
    ];
    setExportingAll(true);
    setMessage('');
    try {
      const basePayload = buildQueryPayload(1);
      const pageSize = 200;
      const totalPages = Math.max(1, Math.ceil(Number(queryState.total || 0) / pageSize));
      const rows = [];

      for (let page = 1; page <= totalPages; page += 1) {
        const res = await clientApi.stockScreening.query({
          ...basePayload,
          page,
          limit: pageSize,
        });
        rows.push(...(Array.isArray(res?.items) ? res.items : []));
      }

      const lines = [headers.join(',')];
      rows.forEach((item) => {
        const values = [
          item?.code || '',
          item?.name || '',
          item?.subMarket || '',
          item?.boardSegment || '',
          item?.tradeDay || '',
          Number.isFinite(Number(item?.startOpen)) ? Number(item.startOpen) : '',
          Number.isFinite(Number(item?.close)) ? Number(item.close) : '',
          Number.isFinite(Number(item?.ma20)) ? Number(item.ma20) : '',
          Number.isFinite(Number(item?.pctChgN20)) ? Number(item.pctChgN20) : '',
          Number.isFinite(Number(item?.rangePctChg)) ? Number(item.rangePctChg) : '',
          Number.isFinite(Number(item?.rangeAvgClose)) ? Number(item.rangeAvgClose) : '',
          Array.isArray(item?.hitRules) ? item.hitRules.map((ruleText) => formatHitRuleText(ruleText)).join(' | ') : '',
        ];
        lines.push(values.map(csvEscape).join(','));
      });

      const safeStart = String(form.startDate || '').replaceAll('-', '');
      const safeEnd = String(form.endDate || '').replaceAll('-', '');
      const filename = `stock_screening_${safeStart}_${safeEnd}_all.csv`;
      downloadFile(filename, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8');
      setMessage(`已导出全部结果：${rows.length} 条`);
    } catch (error) {
      setMessage(`导出失败：${error.message || '未知错误'}`);
    } finally {
      setExportingAll(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(queryState.total / toPositiveInt(form.limit, 50)));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>筛选条件</CardTitle>
          <CardDescription>仅支持 A 股。先过滤市场范围，再按比较条件筛选命中标的。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <MultiCheck
              title="子市场"
              options={SUB_MARKET_OPTIONS}
              values={form.subMarkets}
              onChange={(nextValues) => setForm((prev) => ({ ...prev, subMarkets: nextValues }))}
            />
            <MultiCheck
              title="板块"
              options={BOARD_SEGMENT_OPTIONS}
              values={form.boardSegments}
              onChange={(nextValues) => setForm((prev) => ({ ...prev, boardSegments: nextValues }))}
            />
          </div>

          <div className="rounded-md border border-border/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 w-48 shrink-0 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.calculationMode}
                onChange={(e) => setForm((prev) => ({ ...prev, calculationMode: e.target.value }))}
              >
                {CALCULATION_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <Input
                className="w-40 shrink-0"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
              />
              <Input
                className="w-40 shrink-0"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
              />
              <Input
                className="w-44 shrink-0"
                value={form.totalMarketCapMin}
                onChange={(e) => setForm((prev) => ({ ...prev, totalMarketCapMin: e.target.value }))}
                placeholder="总市值下限"
              />
              <Input
                className="w-44 shrink-0"
                value={form.totalMarketCapMax}
                onChange={(e) => setForm((prev) => ({ ...prev, totalMarketCapMax: e.target.value }))}
                placeholder="总市值上限"
              />
              <Input
                className="w-36 shrink-0"
                value={form.listingDaysMin}
                onChange={(e) => setForm((prev) => ({ ...prev, listingDaysMin: e.target.value }))}
                placeholder="上市天数下限"
              />
              <select
                className="h-9 w-44 shrink-0 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.sortField}
                onChange={(e) => setForm((prev) => ({ ...prev, sortField: e.target.value }))}
              >
                {SORT_FIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                className="h-9 w-28 shrink-0 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.sortOrder}
                onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
              >
                <option value="desc">降序 (desc)</option>
                <option value="asc">升序 (asc)</option>
              </select>
              <Input
                className="w-24 shrink-0"
                value={form.limit}
                onChange={(e) => setForm((prev) => ({ ...prev, limit: e.target.value }))}
                placeholder="条数"
              />
              <Button className="w-32 shrink-0" onClick={() => runQuery(1).catch(() => {})} disabled={querying}>
                {querying ? '筛选中...' : '执行筛选'}
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">比较条件（AND）</p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setRules((prev) => [...prev, createRuleDraft()])}
                >
                  添加条件
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRules([createRuleDraft()])}
                >
                  重置条件
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {rules.map((rule, idx) => (
                <div key={rule.id} className="overflow-x-auto rounded border border-border/50 p-2">
                  <div className="flex min-w-[900px] items-center gap-2">
                    <span className="w-12 shrink-0 text-xs text-muted-foreground">#{idx + 1}</span>
                    <RuleOperandEditor
                      rule={rule}
                      side="left"
                      fieldOptions={activeFieldOptions}
                      onChange={(updater) => updateRule(rule.id, updater)}
                    />
                    <select
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                      value={rule.operator}
                      onChange={(e) => updateRule(rule.id, (prev) => ({ ...prev, operator: e.target.value }))}
                    >
                      {OPERATOR_OPTIONS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                    <RuleOperandEditor
                      rule={rule}
                      side="right"
                      fieldOptions={activeFieldOptions}
                      onChange={(updater) => updateRule(rule.id, updater)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rules.length <= 1}
                      onClick={() => setRules((prev) => prev.filter((item) => item.id !== rule.id))}
                    >
                      删除
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {operandDisplay(rule, 'left')} {rule.operator} {operandDisplay(rule, 'right')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {queryState.warning ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {queryState.warning}
            </div>
          ) : null}

          {message ? (
            <p className="text-sm text-muted-foreground">{message}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>筛选结果</CardTitle>
          <CardDescription>
            数据基准日：{queryState.dataAsOf || '--'} ｜ 当前范围：{makeRangeLabel(form.startDate, form.endDate)} ｜ 计算口径：{form.calculationMode === 'latest' ? '末日口径' : '区间口径'} ｜ 命中总数：{queryState.total}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-border/60 p-3">
            <div className="flex min-w-[1000px] flex-wrap items-center gap-2">
              <Button
                className="w-40 shrink-0"
                variant="secondary"
                disabled={actionBusy || !selectedCodes.length}
                onClick={() => setMonitorDialogOpen(true)}
              >
                加入监控分类
              </Button>
              <Button
                className="w-40 shrink-0"
                variant="secondary"
                disabled={actionBusy || !selectedCodes.length}
                onClick={() => {
                  setShowPoolCreate(false);
                  setPoolDialogOpen(true);
                }}
              >
                加入标的池
              </Button>
              <Button
                className="w-36 shrink-0"
                variant="outline"
                onClick={() => exportAllResultsCsv().catch(() => {})}
                disabled={!queryState.total || exportingAll}
              >
                {exportingAll ? '导出中...' : '导出全部'}
              </Button>
              <Button
                className="w-40 shrink-0"
                variant="outline"
                onClick={toggleSelectCurrentPage}
                disabled={!queryState.items.length || allResultSelected}
              >
                {allCurrentPageSelected ? '取消本页全选' : '本页全选'}
              </Button>
              <Button
                className="w-44 shrink-0"
                variant="outline"
                onClick={() => selectAllResults().catch(() => {})}
                disabled={!queryState.total || selectingAll}
              >
                {selectingAll ? '全选中...' : (allResultSelected ? '取消全结果全选' : '全结果全选')}
              </Button>
              <span className="text-xs text-muted-foreground">
                已选 {selectedCodes.length} 只{allResultSelected ? ` / 共 ${queryState.total} 只` : ''}
              </span>
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left">选择</th>
                  <th className="px-2 py-1 text-left">代码</th>
                  <th className="px-2 py-1 text-left">名称</th>
                  <th className="px-2 py-1 text-left">子市场</th>
                  <th className="px-2 py-1 text-left">板块</th>
                  <th className="px-2 py-1 text-left">交易日</th>
                  <th className="px-2 py-1 text-left">开盘价 (startOpen)</th>
                  <th className="px-2 py-1 text-left">收盘价 (close)</th>
                  <th className="px-2 py-1 text-left">20日均线 (ma20)</th>
                  <th className="px-2 py-1 text-left">20日涨跌幅 (pctChgN20)</th>
                  <th className="px-2 py-1 text-left">区间涨跌幅 (rangePctChg)</th>
                  <th className="px-2 py-1 text-left">区间均价 (rangeAvgClose)</th>
                  <th className="px-2 py-1 text-left">命中条件</th>
                </tr>
              </thead>
              <tbody>
                {queryState.items.map((item) => {
                  const checked = selectedCodes.includes(item.code);
                  return (
                    <tr key={`${item.code}_${item.tradeDay}`} className="border-t border-border/40">
                      <td className="px-2 py-1">
                        <input type="checkbox" checked={checked} onChange={() => toggleSelectCode(item.code)} />
                      </td>
                      <td className="px-2 py-1 font-mono">{item.code}</td>
                      <td className="px-2 py-1">{item.name}</td>
                      <td className="px-2 py-1">{item.subMarket}</td>
                      <td className="px-2 py-1">{item.boardSegment}</td>
                      <td className="px-2 py-1">{item.tradeDay}</td>
                      <td className="px-2 py-1">{formatNum(item.startOpen)}</td>
                      <td className="px-2 py-1">{formatNum(item.close)}</td>
                      <td className="px-2 py-1">{formatNum(item.ma20)}</td>
                      <td className="px-2 py-1">{formatNum(item.pctChgN20, 2)}</td>
                      <td className="px-2 py-1">{formatNum(item.rangePctChg, 2)}</td>
                      <td className="px-2 py-1">{formatNum(item.rangeAvgClose)}</td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">
                        {Array.isArray(item.hitRules) ? item.hitRules.map((ruleText) => formatHitRuleText(ruleText)).join(' | ') : '--'}
                      </td>
                    </tr>
                  );
                })}
                {!queryState.items.length ? (
                  <tr>
                    <td colSpan={13} className="px-2 py-6 text-center text-muted-foreground">暂无结果，请先执行筛选</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={querying || queryState.page <= 1}
              onClick={() => runQuery(queryState.page - 1).catch(() => {})}
            >
              上一页
            </Button>
            <span className="text-sm text-muted-foreground">第 {queryState.page} / {totalPages} 页</span>
            <Button
              size="sm"
              variant="outline"
              disabled={querying || queryState.page >= totalPages}
              onClick={() => runQuery(queryState.page + 1).catch(() => {})}
            >
              下一页
            </Button>
          </div>
        </CardContent>
      </Card>

      {monitorDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setMonitorDialogOpen(false)}>
          <div className="w-[min(92vw,560px)] rounded-lg border border-border bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3">
              <h3 className="text-base font-semibold">加入监控分类</h3>
              <p className="text-sm text-muted-foreground">已选 {selectedCodes.length} 只股票，请选择目标分类。</p>
            </div>
            <div className="space-y-3">
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.monitorCategoryId}
                onChange={(e) => setForm((prev) => ({ ...prev, monitorCategoryId: e.target.value }))}
              >
                <option value="">监控分类</option>
                {monitorCategories.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setMonitorDialogOpen(false)} disabled={actionBusy}>取消</Button>
                <Button
                  variant="secondary"
                  disabled={actionBusy || !selectedCodes.length}
                  onClick={() => {
                    batchAddToMonitor()
                      .then((ok) => {
                        if (ok) setMonitorDialogOpen(false);
                      })
                      .catch(() => {});
                  }}
                >
                  {actionBusy ? '处理中...' : '确认加入'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {poolDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => {
            setPoolDialogOpen(false);
            setShowPoolCreate(false);
          }}
        >
          <div className="w-[min(92vw,680px)] rounded-lg border border-border bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3">
              <h3 className="text-base font-semibold">加入标的池</h3>
              <p className="text-sm text-muted-foreground">已选 {selectedCodes.length} 只股票，请选择目标标的池。</p>
            </div>
            <div className="space-y-3">
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.bluechipPoolId}
                onChange={(e) => setForm((prev) => ({ ...prev, bluechipPoolId: e.target.value }))}
              >
                <option value="">标的池</option>
                {bluechipPools.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} ({item.code})</option>
                ))}
              </select>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowPoolCreate((prev) => !prev)}
                  disabled={creatingPool}
                >
                  {showPoolCreate ? '取消新建' : '新建标的池'}
                </Button>
                {showPoolCreate ? (
                  <>
                    <Input
                      className="w-56"
                      value={newPoolName}
                      onChange={(e) => setNewPoolName(e.target.value)}
                      placeholder="新池名称"
                    />
                    <Button
                      variant="secondary"
                      disabled={creatingPool}
                      onClick={() => createBluechipPoolInline().catch(() => {})}
                    >
                      {creatingPool ? '创建中...' : '创建并选中'}
                    </Button>
                  </>
                ) : null}
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPoolDialogOpen(false);
                    setShowPoolCreate(false);
                  }}
                  disabled={actionBusy || creatingPool}
                >
                  取消
                </Button>
                <Button
                  variant="secondary"
                  disabled={actionBusy || creatingPool || !selectedCodes.length}
                  onClick={() => {
                    batchAddToBluechipPool()
                      .then((ok) => {
                        if (ok) {
                          setPoolDialogOpen(false);
                          setShowPoolCreate(false);
                        }
                      })
                      .catch(() => {});
                  }}
                >
                  {actionBusy ? '处理中...' : '确认加入'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
