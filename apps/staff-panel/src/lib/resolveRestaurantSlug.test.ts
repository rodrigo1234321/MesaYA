import { describe, expect, it } from 'vitest';
import { resolveRestaurantSlug } from './resolveRestaurantSlug';

describe('resolveRestaurantSlug', () => {
  const restaurants = [
    { id: 'aaa', name: 'Place A', slug: 'place-a' },
    { id: 'bbb', name: 'Place B', slug: 'place-b' },
  ];

  it('preserves a saved restaurant when it matches by slug', () => {
    expect(resolveRestaurantSlug(restaurants, 'place-b')).toBe('place-b');
  });

  it('preserves a saved restaurant when it matches by id', () => {
    expect(resolveRestaurantSlug(restaurants, 'aaa')).toBe('place-a');
  });

  it('falls back to the first restaurant when saved id has no match', () => {
    expect(resolveRestaurantSlug(restaurants, 'nonexistent')).toBe('place-a');
  });

  it('falls back to the first restaurant when saved is null', () => {
    expect(resolveRestaurantSlug(restaurants, null)).toBe('place-a');
  });

  it('falls back to the first restaurant when saved is undefined', () => {
    expect(resolveRestaurantSlug(restaurants, undefined)).toBe('place-a');
  });

  it('returns null for an empty list', () => {
    expect(resolveRestaurantSlug([], null)).toBeNull();
  });

  it('returns null for a null/undefined list', () => {
    expect(resolveRestaurantSlug(null as any, null)).toBeNull();
    expect(resolveRestaurantSlug(undefined as any, null)).toBeNull();
  });

  it('returns the single restaurant slug when list has one entry and no saved', () => {
    expect(resolveRestaurantSlug([{ id: 'x', name: 'Only', slug: 'only-one' }], null)).toBe('only-one');
  });
});
