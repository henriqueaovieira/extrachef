import { test } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), quiet: true });

export const PLAYWRIGHT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  "http://localhost:3000";

export function getFinishedOperationUrl() {
  return process.env.OPERATION_FINISHED_URL ?? null;
}

export function getCancelledOperationUrl() {
  return process.env.CANCELLED_OPERATION_URL ?? null;
}

export function hasPlaywrightCredentials() {
  return Boolean(process.env.PLAYWRIGHT_EMAIL?.trim() && process.env.PLAYWRIGHT_PASSWORD?.trim());
}

export function skipIfMissing(value: string | null, message: string): asserts value is string {
  test.skip(value === null || value.trim() === '', message);
}
