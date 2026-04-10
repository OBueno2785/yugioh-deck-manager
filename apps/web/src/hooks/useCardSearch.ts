import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { searchCards, fetchAllCards, type CardSearchParams } from "@/lib/ygoproApi";
import type { Card } from "@yugioh/core";

// ─── Full Catalog (cached 1 hour) ─────────────────────────────────────────────

export function useAllCards() {
  return useQuery({
    queryKey: ["cards", "all"],
    queryFn: fetchAllCards,
    staleTime: 1000 * 60 * 60,
  });
}

// ─── Search (with local filter on cached catalog) ─────────────────────────────

export interface UseCardSearchOptions {
  params: CardSearchParams;
  enabled?: boolean;
}

/**
 * Search cards.
 * - If only `name` is set and catalog is cached: filter locally (instant).
 * - Otherwise: hit the API with filters.
 */
export function useCardSearch({ params, enabled = true }: UseCardSearchOptions) {
  const { data: allCards, isLoading: catalogLoading } = useAllCards();

  // Local filtering when catalog is available and only name is set
  const localResults = useMemo<Card[] | undefined>(() => {
    if (!allCards) return undefined;
    const { name, type, attribute, level, race, archetype } = params;
    // If no filters at all, return all cards
    if (!name && !type && !attribute && !level && !race && !archetype) {
      return allCards;
    }
    return allCards.filter((card) => {
      if (name && !card.name.toLowerCase().includes(name.toLowerCase())) return false;
      if (type && card.type !== type) return false;
      if (attribute && card.attribute !== attribute) return false;
      if (level !== undefined && card.level !== level) return false;
      if (race && card.race !== race) return false;
      if (archetype && card.archetype !== archetype) return false;
      return true;
    });
  }, [allCards, params]);

  // Remote fallback when catalog isn't loaded yet
  const remoteQuery = useQuery({
    queryKey: ["cards", "search", params],
    queryFn: () => searchCards(params),
    enabled: enabled && !allCards && Object.values(params).some(Boolean),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
  });

  return {
    cards: localResults ?? remoteQuery.data ?? [],
    isLoading: catalogLoading || remoteQuery.isLoading,
    isError: remoteQuery.isError,
    error: remoteQuery.error,
  };
}
