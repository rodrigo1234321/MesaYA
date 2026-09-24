import { describe, expect, it } from 'vitest';
import { StaffApi } from '../../../staff-panel/src/lib/api';

describe('staff startup session classification', () => {
  it('invalidates only definitive staff authentication failures', () => {
    expect(StaffApi.isUnauthorizedError({ statusCode: 401 })).toBe(true);
    expect(StaffApi.isUnauthorizedError({ code: 'STAFF_UNAUTHORIZED' })).toBe(true);
    expect(StaffApi.isUnauthorizedError({ statusCode: 403 })).toBe(false);
    expect(StaffApi.isUnauthorizedError(new TypeError('Failed to fetch'))).toBe(false);
  });
});
