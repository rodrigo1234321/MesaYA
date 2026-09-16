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
  instanceMode: 'MULTI_TENANT' | 'SINGLE_RESTAURANT';
  instanceRestaurantId: string | undefined;
  jwtSecret: string;
  encryptionSecret: string;
  staffPinPepper: string;
  staffPinPepperPrevious?: string;
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
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (!isProduction && origins.length === 0) {
    return [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:3000'
    ];
  }
  if (origins.length === 0 || origins.includes('*')) {
    throw new Error('CORS_ORIGIN debe declarar una lista explícita de orígenes; "*" no está permitido.');
  }
  for (const origin of origins) {
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
  const rawInstanceMode = (env.MESAYA_INSTANCE_MODE || 'MULTI_TENANT').trim().toUpperCase();
  if (rawInstanceMode !== 'MULTI_TENANT' && rawInstanceMode !== 'SINGLE_RESTAURANT') {
    throw new Error('MESAYA_INSTANCE_MODE debe ser MULTI_TENANT o SINGLE_RESTAURANT.');
  }
  const instanceRestaurantId = normalizeSecret(env.MESAYA_INSTANCE_RESTAURANT_ID);
  if (rawInstanceMode === 'SINGLE_RESTAURANT' && !instanceRestaurantId) {
    throw new Error('MESAYA_INSTANCE_RESTAURANT_ID es obligatorio en modo SINGLE_RESTAURANT.');
  }
  const jwtSecret = normalizeSecret(env.JWT_SECRET);
  const encryptionSecret = normalizeSecret(env.ENCRYPTION_SECRET_KEY);
  const rawStaffPinPepper = normalizeSecret(env.STAFF_PIN_PEPPER);
  const staffPinPepperPrevious = normalizeSecret(env.STAFF_PIN_PEPPER_PREVIOUS);
  const staffPinPepper = rawStaffPinPepper || encryptionSecret || DEVELOPMENT_ENCRYPTION_SECRET;

  if (isProduction) {
    assertProductionSecret('JWT_SECRET', jwtSecret);
    assertProductionSecret('ENCRYPTION_SECRET_KEY', encryptionSecret);
    if (jwtSecret === encryptionSecret) {
      throw new Error('JWT_SECRET y ENCRYPTION_SECRET_KEY deben ser secretos distintos en producción.');
    }
    if (rawStaffPinPepper) {
      assertProductionSecret('STAFF_PIN_PEPPER', rawStaffPinPepper);
    }
    if (staffPinPepperPrevious) {
      assertProductionSecret('STAFF_PIN_PEPPER_PREVIOUS', staffPinPepperPrevious);
    }
  }

  return {
    isProduction,
    instanceMode: rawInstanceMode,
    instanceRestaurantId,
    jwtSecret: jwtSecret || DEVELOPMENT_JWT_SECRET,
    encryptionSecret: encryptionSecret || DEVELOPMENT_ENCRYPTION_SECRET,
    staffPinPepper,
    staffPinPepperPrevious,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGIN, isProduction),
    // `PILOT_PUBLIC_ONBOARDING_ENABLED` se conserva como alias para no romper
    // instalaciones existentes; las nuevas usan el nombre neutral.
    publicOnboardingEnabled: (env.PUBLIC_ONBOARDING_ENABLED ?? env.PILOT_PUBLIC_ONBOARDING_ENABLED) === 'true'
  };
}

/**
 * Returns whether a tenant may be addressed by this API instance.
 *
 * Public QR/session routes use the same boundary as authenticated routes. In
 * SINGLE_RESTAURANT mode the configured restaurant id is the only tenant that
 * can be resolved; in MULTI_TENANT mode every tenant remains addressable.
 */
export function isRestaurantInConfiguredInstance(
  restaurantId: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const config = getEnvironmentConfig(env);
  return config.instanceMode === 'MULTI_TENANT' || config.instanceRestaurantId === restaurantId;
}
