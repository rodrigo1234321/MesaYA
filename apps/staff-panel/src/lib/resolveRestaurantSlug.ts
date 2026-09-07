export interface RestaurantOption {
  id: string;
  name: string;
  slug: string;
}

/**
 * Given a list of restaurants from the API and a previously saved
 * restaurant id/slug (or null), return the slug to pre-select:
 * - saved match exists → preserve it
 * - no match or no saved → fall back to the first restaurant
 * - empty list → null (nothing to select)
 */
export function resolveRestaurantSlug(
  restaurants: RestaurantOption[],
  savedRestaurantId: string | null | undefined
): string | null {
  if (!restaurants || restaurants.length === 0) return null;

  if (savedRestaurantId) {
    const match = restaurants.find(
      (r) => r.slug === savedRestaurantId || r.id === savedRestaurantId
    );
    if (match) return match.slug;
  }

  return restaurants[0].slug;
}
