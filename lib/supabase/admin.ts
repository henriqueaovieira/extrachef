import 'server-only';
import { createClient } from '@supabase/supabase-js';

type AdminConfigurationCode = 'missing_credentials' | 'invalid_url' | 'initialization_failed';

export class AdminConfigurationError extends Error {
  constructor(
    public readonly code: AdminConfigurationCode,
    public readonly diagnostics?: ReturnType<typeof getAdminDiagnostics>,
  ) {
    super('Supabase administrative client could not be initialized.');
    this.name = 'AdminConfigurationError';
  }
}

function describe(value: string | undefined) {
  return {
    present: value !== undefined,
    type: typeof value,
    length: value?.length ?? 0,
    empty: value === '',
    whitespaceOnly: Boolean(value?.length && !value.trim()),
    nonEmpty: Boolean(value?.trim()),
    padded: value !== undefined && value !== value.trim(),
  };
}

function readConfiguration() {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serverUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const supabaseUrl = publicUrl?.trim() || serverUrl?.trim();
  const adminKey = serviceRoleKey?.trim() || secretKey?.trim();
  // Compare the build-inlined public URL with the actual function environment.
  const runtimeEnvironment = process.env;
  const runtimePublicUrl = runtimeEnvironment['NEXT_PUBLIC_SUPABASE_URL'];
  let urlValid = false;
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      urlValid = ['http:', 'https:'].includes(url.protocol)
        && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      urlValid = false;
    }
  }
  const diagnostics = {
    version: 'admin-env-v2',
    hasUrl: Boolean(publicUrl),
    hasServiceRole: Boolean(serviceRoleKey),
    urlLength: publicUrl?.length ?? 0,
    serviceRoleLength: serviceRoleKey?.length ?? 0,
    urlValid,
    keysEqual: serviceRoleKey?.trim() && secretKey?.trim()
      ? serviceRoleKey.trim() === secretKey.trim() : null,
    sdkException: null as string | null,
    runtime: {
      nodeVersion: process.version,
      websocketType: typeof globalThis.WebSocket,
      fetchType: typeof globalThis.fetch,
    },
    runtimePublicUrl: describe(runtimePublicUrl),
    buildAndRuntimeUrlMatch: publicUrl !== undefined && runtimePublicUrl !== undefined
      ? publicUrl === runtimePublicUrl : null,
    urlSource: publicUrl?.trim() ? 'NEXT_PUBLIC_SUPABASE_URL' : serverUrl?.trim() ? 'SUPABASE_URL' : null,
    keySource: serviceRoleKey?.trim() ? 'SUPABASE_SERVICE_ROLE_KEY' : secretKey?.trim() ? 'SUPABASE_SECRET_KEY' : null,
    environment: {
      NEXT_PUBLIC_SUPABASE_URL: describe(publicUrl),
      SUPABASE_URL: describe(serverUrl),
      SUPABASE_SERVICE_ROLE_KEY: describe(serviceRoleKey),
      SUPABASE_SECRET_KEY: describe(secretKey),
    },
  };
  return { supabaseUrl, adminKey, diagnostics };
}

export function getAdminDiagnostics() {
  return readConfiguration().diagnostics;
}

function classifySdkError(error: unknown) {
  const message = typeof error === 'object' && error !== null
    && 'message' in error && typeof error.message === 'string' ? error.message : '';
  if (message.includes('native WebSocket not found')) return 'native_websocket_missing';
  if (message.includes('Edge runtime detected')) return 'edge_websocket_unsupported';
  if (message.includes('supabaseKey is required')) return 'sdk_key_required';
  if (message.includes('supabaseUrl')) return 'sdk_url_rejected';
  return 'unclassified_sdk_exception';
}

export function createAdminClient(context: { requestId?: string } = {}) {
  const startedAt = Date.now();
  const { supabaseUrl, adminKey, diagnostics } = readConfiguration();
  const detailed = process.env.PUSH_DIAGNOSTICS_ENABLED === 'true';
  const logDiagnostics = detailed ? diagnostics : {
    urlSource: diagnostics.urlSource,
    keySource: diagnostics.keySource,
    environment: Object.fromEntries(Object.entries(diagnostics.environment).map(([name, value]) => [
      name, { present: value.present, nonEmpty: value.nonEmpty, padded: value.padded },
    ])),
  };
  const fail = (code: AdminConfigurationCode, sdkException?: string): never => {
    const failureDiagnostics = { ...diagnostics, sdkException: sdkException ?? null };
    console.error('supabase_admin_configuration_failed', {
      ...logDiagnostics, requestId: context.requestId, code,
      sdkException: sdkException ?? null, durationMs: Date.now() - startedAt,
    });
    throw new AdminConfigurationError(code, detailed ? failureDiagnostics : undefined);
  };

  if (!supabaseUrl || !adminKey) return fail('missing_credentials');

  if (!diagnostics.urlValid) return fail('invalid_url');
  if (detailed) {
    console.info('supabase_admin_sdk_start', { ...diagnostics, requestId: context.requestId });
  }

  try {
    const client = createClient(supabaseUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.info('supabase_admin_initialized', {
      ...logDiagnostics, requestId: context.requestId, durationMs: Date.now() - startedAt,
    });
    return client;
  } catch (error) {
    // Never log arbitrary SDK messages: use categories derived from known errors.
    return fail('initialization_failed', classifySdkError(error));
  }
}