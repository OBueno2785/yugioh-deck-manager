import { useQuery } from "@tanstack/react-query";
import { fetchCardWithSets } from "@/lib/ygoproApi";

/**
 * Fetch full card data including set/rarity info.
 * Only called when a CardDetail modal is opened — not on the catalog.
 * Cached indefinitely per card ID (sets don't change).
 */
export function useCardSets(cardId: number, enabled = true) {
  return useQuery({
    queryKey: ["card", "sets", cardId],
    queryFn: () => fetchCardWithSets(cardId),
    enabled,
    staleTime: Infinity,   // set data never changes
    gcTime: 1000 * 60 * 60 * 24,
  });
}
