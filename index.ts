#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

interface CliOptions {
  url: string;
  count: number;
}

interface RequestMetrics {
  bytes: number;
  durationMs: number;
}

const DEFAULT_REQUESTS_COUNT = 10;
const REQUEST_TIMEOUT_MS = 15_000;

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const url = args[0];

  if (!url) {
    console.error('Ошибка: не указан URL для проверки.');
    console.error('Пример запуска: node index.ts https://example.com');
    process.exit(1);
  }

  try {
    new URL(url);
  } catch {
    console.error(`Ошибка: некорректный URL "${url}"`);
    process.exit(1);
  }

  const rawCount = args[1];
  const parsedCount = rawCount ? Number.parseInt(rawCount, 10) : DEFAULT_REQUESTS_COUNT;
  const count =
    Number.isInteger(parsedCount) && parsedCount > 0 ? parsedCount : DEFAULT_REQUESTS_COUNT;

  return { url, count };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(2)} ${units[index]}`;
}

async function measureSingleRequest(url: string, index: number): Promise<RequestMetrics> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const start = performance.now();

  try {
    // Отключаем кэширование через заголовок и query-параметр, чтобы каждый запрос честно качал тело ответа
    const targetUrl = new URL(url);
    targetUrl.searchParams.set('_cb', `${Date.now()}_${index}`);

    const response = await fetch(targetUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    // Дожидаемся полной вычитки тела ответа
    const buffer = await response.arrayBuffer();
    const durationMs = performance.now() - start;

    return {
      bytes: buffer.byteLength,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function run(): Promise<void> {
  const { url, count } = parseArgs(process.argv);

  console.log('Запуск теста скорости скачивания...');
  console.log(`URL: ${url}`);
  console.log(`Количество последовательных запросов: ${count}\n`);

  let totalBytes = 0;
  let totalDurationMs = 0;

  for (let i = 1; i <= count; i += 1) {
    try {
      const { bytes, durationMs } = await measureSingleRequest(url, i);
      totalBytes += bytes;
      totalDurationMs += durationMs;

      const sec = durationMs / 1000;
      const mbps = sec > 0 ? (bytes * 8) / (sec * 1_000_000) : 0;

      console.log(
        `[${i}/${count}] Скачано: ${formatBytes(bytes)} | Время: ${durationMs.toFixed(1)} мс | Скорость: ${mbps.toFixed(2)} Мбит/с`
      );
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const reason =
        err.name === 'AbortError' ? `таймаут (${REQUEST_TIMEOUT_MS} мс)` : err.message;
      console.error(`[${i}/${count}] Ошибка запроса: ${reason}`);
      process.exit(1);
    }
  }

  const avgDurationMs = totalDurationMs / count;
  const totalSeconds = totalDurationMs / 1000;
  const avgSpeedMbps = totalSeconds > 0 ? (totalBytes * 8) / (totalSeconds * 1_000_000) : 0;
  const avgSpeedMBs = totalSeconds > 0 ? totalBytes / (totalSeconds * 1024 * 1024) : 0;

  console.log('\n--- Итоговые результаты ---');
  console.log(`Успешных запросов:     ${count}`);
  console.log(`Общий объём данных:    ${formatBytes(totalBytes)} (${totalBytes} байт)`);
  console.log(`Общее время загрузки:  ${totalSeconds.toFixed(2)} с`);
  console.log(`Среднее время запроса: ${avgDurationMs.toFixed(1)} мс`);
  console.log(`Средняя скорость:      ${avgSpeedMbps.toFixed(2)} Мбит/с (${avgSpeedMBs.toFixed(2)} МБ/с)`);
}

run();
