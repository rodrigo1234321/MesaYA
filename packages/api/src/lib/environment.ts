export const STAFF_JWT_EXPIRES_IN = '12h';

const DEVELOPMENT_JWT_SECRET = 'mesaya_development_jwt_secret_not_for_production';
const DEVELOPMENT_ENCRYPTION_SECRET = 'mesaya_development_encryption_secret_not_for_production';
const MIN_SECRET_LENGTH = 32;

const KNOWN_INSECURE_SECRETS = new Set([
  'mesaya_jwt_secret_dev_key',
  'mesaya_default_crypto_secret_32b!',
  'mesaya_production_jwt_secret_key_change_me_32_chars',
  'mesaya_aes_256_gcm_secret_key_must_be_32_bytes_long!!',
  'replace_with_random_32+_char_secret',
  'replace_with_a_different_random_32+_char_secret'
]);

export type EnvironmentConfig = {
  isProduction: boolean;
  jwtSecret: string;
  encryptionSecret: string;
  corsOrigins: string[];
  publicOnboardingEnabled: boolean;
};

function normalizeSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function assertProductionSecret(name: string, value: string | undefined): asserts value is string {
  if (!value || value.length < MIN_SECRET_LENGTH || KNOWN_INSECURE_SECRETS.has(value.toLowerCase())) {
    throw new Error(`${name} debe estar definido, tener al menos ${MIN_SECRET_LENGTH} caracteres y no usar un valor conocido en producción.`);
  }
}

function parseCorsOrigins(value: string | undefined, isProduction: boolean): string[] {
  const origins = (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!isProduction && origins.length === 0) {
    return ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];
  }
  if (origins.length === 0 || origins.includes('*')) {
    throw new Error('CORS_ORIGIN debe declarar una lista explícita de orígenes; "*" no está permitido.');
  }
  for (const origin of origins) {
    // Cualquier wildcard explícito está prohibido, incluido
    // `https://*.vercel.app` u otros sufijos comodín.
    if (origin.includes('*')) {
      throw new Error(`CORS_ORIGIN no admite comodines (wildcard): ${origin}`);
    }
    let url: URL;
    try {
      url = new URL(origin);
    } catch (_) {
      throw new Error(`CORS_ORIGIN contiene un origen inválido: ${origin}`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(`CORS_ORIGIN debe contener sólo orígenes HTTP(S) explícitos: ${origin}`);
    }
    if (isProduction && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new Error('CORS_ORIGIN no puede incluir localhost en producción.');
    }
  }
  return origins;
}

/** Validates the environment before the API creates a listener. */
export function getEnvironmentConfig(env: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const isProduction = env.NODE_ENV === 'production';
  const jwtSecret = normalizeSecret(env.JWT_SECRET);
  const encryptionSecret = normalizeSecret(env.ENCRYPTION_SECRET_KEY);

  if (isProduction) {
    assertProductionSecret('JWT_SECRET', jwtSecret);
    assertProductionSecret('ENCRYPTION_SECRET_KEY', encryptionSecret);
    if (jwtSecret === encryptionSecret) {
      throw new Error('JWT_SECRET y ENCRYPTION_SECRET_KEY deben ser secretos distintos en producción.');
    }
  }

  return {
    isProduction,
    jwtSecret: jwtSecret || DEVELOPMENT_JWT_SECRET,
    encryptionSecret: encryptionSecret || DEVELOPMENT_ENCRYPTION_SECRET,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGIN, isProduction),
    publicOnboardingEnabled: env.PILOT_PUBLIC_ONBOARDING_ENABLED === 'true'
  };
}
