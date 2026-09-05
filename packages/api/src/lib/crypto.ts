import crypto from 'crypto';
import { getEnvironmentConfig } from './environment';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recomendado para GCM
const TAG_LENGTH = 16; // 128 bits auth tag

/**
 * Obtiene una clave de cifrado separada de la clave JWT. En producción la
 * validación centralizada rechaza ausencias, valores débiles o conocidos.
 */
function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(getEnvironmentConfig().encryptionSecret).digest();
}

export class CryptoService {
  /**
   * Cifra un texto plano usando AES-256-GCM.
   * Retorna una cadena con formato: `${iv}:${tag}:${ciphertext}` (todo en base64).
   */
  static encrypt(plainText: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  }

  /**
   * Descifra una cadena en formato `${iv}:${tag}:${ciphertext}` usando AES-256-GCM.
   * Lanza error si el payload fue manipulado o la clave es incorrecta.
   */
  static decrypt(encryptedPayload: string): string {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Formato de payload cifrado inválido. Se esperaba iv:tag:ciphertext');
    }

    const [ivB64, tagB64, cipherB64] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherB64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
