/**
 * Política uniforme de PIN de personal (Etapa 01 COCINA-CUENTAS).
 * PIN de 4 a 6 cifras decimales. El servidor valida formato antes de
 * cualquier comparación bcrypt; el hash con sal impide unicidad por DB,
 * por lo que los duplicados por restaurante se rechazan a nivel aplicación
 * (ver StaffService.createStaff). La garantía bajo concurrencia estricta
 * requiere una columna de digest con constraint único (pendiente, etapa 03).
 */

export const PIN_PATTERN = /^\d{4,6}$/;
export const PIN_DUPLICATE_ERROR = 'PIN_DUPLICATE';

export function isValidPin(pin: unknown): pin is string {
  // Rechazo estricto: sólo string de 4–6 dígitos ASCII, sin trim ni
  // normalización. Los espacios exteriores/internos invalidan el PIN para
  // no validar una representación y hashear otra distinta.
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

/** Lanza error 400 si el PIN no cumple la política. No revela secretos. */
export function assertValidPin(pin: unknown, field = 'pin'): asserts pin is string {
  if (!isValidPin(pin)) {
    const error: any = new Error('El PIN debe tener entre 4 y 6 dígitos');
    error.statusCode = 400;
    error.code = 'PIN_INVALID';
    error.field = field;
    throw error;
  }
}

/** Error 409 para PIN ya usado por otro miembro del mismo restaurante. */
export function duplicatePinError(): any {
  const error: any = new Error('Ese PIN ya está en uso en este restaurante');
  error.statusCode = 409;
  error.code = PIN_DUPLICATE_ERROR;
  return error;
}
