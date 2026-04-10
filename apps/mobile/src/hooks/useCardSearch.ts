import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchAllCards, searchCards, type CardSearchParams } from "@/lib/ygoproApi";
import type { Card } from "@yugioh/core";

export function useAllCards() {
  return useQuery({
    queryKey: ["cards", "all"],
    queryFn: fetchAllCards,
    staleTime: 1000 * 60 * 60,
  });
}

export function useCardSearch(params: CardSearchParams, enabled = true) {
  const { data: allCards, isLoading: catalogLoading } = useAllCards();

  const localResults = useMemo<Card[] | undefined>(() => {
    if (!allCards) return undefined;
    const { name, type, attribute, level, race, archetype } = params;
    if (!name && !type && !attribute && !level && !race && !archetype) return allCards;
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

  const remoteQuery = useQuery({
    queryKey: ["cards", "search", params],
    queryFn: () => searchCards(params),
    enabled: enabled && !allCards && Object.values(params).some(Boolean),
    placeholderData: keepPreviousData,
  });

  return {
    cards: localResults ?? remoteQuery.data ?? [],
    isLoading: catalogLoading || remoteQuery.isLoading,
  };
}
