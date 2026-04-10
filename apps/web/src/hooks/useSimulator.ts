/**
 * Manages simulation state, the Web Worker, and the interactive hand draw mode.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { expandDeck } from "@yugioh/core";
import type {
  LabeledDeckCard,
  SimulationCondition,
  SimulationResult,
  Card,
} from "@yugioh/core";
import type { WorkerRequest, WorkerResponse } from "@/workers/simulator.worker";

// ─── Hand draw helpers ────────────────────────────────────────────────────────

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

// ─── Session history entry ────────────────────────────────────────────────────

export interface HandRecord {
  id: number;
  hand: Card[];
  conditionsMet: boolean[]; // per condition
  allMet: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseSimulatorReturn {
  // Conditions
  conditions: SimulationCondition[];
  addCondition: (c: Omit<SimulationCondition, "id">) => void;
  updateCondition: (id: string, patch: Partial<SimulationCondition>) => void;
  removeCondition: (id: string) => void;
  clearConditions: () => void;

  // Config
  goingFirst: boolean;
  setGoingFirst: (v: boolean) => void;
  iterations: number;
  setIterations: (n: number) => void;

  // Monte Carlo run
  runMonteCarlo: () => void;
  isRunning: boolean;
  mcResult: SimulationResult | null;

  // Hand draw mode
  drawnHand: Card[];
  drawHand: () => void;
  handHistory: HandRecord[];
  clearHistory: () => void;

  // Derived
  deckIsEmpty: boolean;
}

function evaluateCondition(hand: Card[], c: SimulationCondition): boolean {
  const idSet = new Set(c.cardIds);
  switch (c.type) {
    case "has_card": {
      const count = hand.filter((card) => card.id === c.cardIds[0]).length;
      return count >= c.minCount;
    }
    case "has_any": {
      const count = hand.filter((card) => idSet.has(card.id)).length;
      return count >= c.minCount;
    }
    case "has_all": {
      return c.cardIds.every((id) => hand.some((card) => card.id === id));
    }
    case "has_count": {
      const count = hand.filter((card) => idSet.has(card.id)).length;
      return count >= c.minCount;
    }
    default:
      return false;
  }
}

let handCounter = 0;

export function useSimulator(
  main: LabeledDeckCard[],
  _extra: LabeledDeckCard[]
): UseSimulatorReturn {
  const [conditions, setConditions] = useState<SimulationCondition[]>([]);
  const [goingFirst, setGoingFirst] = useState(true);
  const [iterations, setIterations] = useState(10_000);
  const [isRunning, setIsRunning] = useState(false);
  const [mcResult, setMcResult] = useState<SimulationResult | null>(null);
  const [drawnHand, setDrawnHand] = useState<Card[]>([]);
  const [handHistory, setHandHistory] = useState<HandRecord[]>([]);

  const workerRef = useRef<Worker | null>(null);

  // Lazy-init worker
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/simulator.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === "success") {
        setMcResult(e.data.result);
      }
      setIsRunning(false);
    };

    worker.onerror = () => setIsRunning(false);

    return () => worker.terminate();
  }, []);

  const flatDeck = expandDeck(main.map((dc) => ({ card: dc.card, quantity: dc.quantity })));
  const deckIsEmpty = flatDeck.length === 0;

  // ── Condition actions ──────────────────────────────────────────────────────

  const addCondition = useCallback((c: Omit<SimulationCondition, "id">) => {
    const id = crypto.randomUUID();
    setConditions((prev) => [...prev, { ...c, id }]);
  }, []);

  const updateCondition = useCallback((id: string, patch: Partial<SimulationCondition>) => {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeCondition = useCallback((id: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearConditions = useCallback(() => setConditions([]), []);

  // ── Monte Carlo ────────────────────────────────────────────────────────────

  const runMonteCarlo = useCallback(() => {
    if (deckIsEmpty || !workerRef.current) return;
    setIsRunning(true);
    setMcResult(null);

    const request: WorkerRequest = {
      id: crypto.randomUUID(),
      config: {
        deck: flatDeck,
        handSize: goingFirst ? 5 : 6,
        iterations,
        conditions,
      },
    };
    workerRef.current.postMessage(request);
  }, [flatDeck, goingFirst, iterations, conditions, deckIsEmpty]);

  // ── Hand draw ──────────────────────────────────────────────────────────────

  const drawHand = useCallback(() => {
    if (deckIsEmpty) return;
    const hand = shuffled(flatDeck).slice(0, goingFirst ? 5 : 6);
    setDrawnHand(hand);

    if (conditions.length > 0) {
      const conditionsMet = conditions.map((c) => evaluateCondition(hand, c));
      const allMet = conditionsMet.every(Boolean);
      const record: HandRecord = { id: ++handCounter, hand, conditionsMet, allMet };
      setHandHistory((prev) => [record, ...prev].slice(0, 50)); // keep last 50
    }
  }, [flatDeck, goingFirst, conditions, deckIsEmpty]);

  const clearHistory = useCallback(() => setHandHistory([]), []);

  return {
    conditions,
    addCondition,
    updateCondition,
    removeCondition,
    clearConditions,
    goingFirst,
    setGoingFirst,
    iterations,
    setIterations,
    runMonteCarlo,
    isRunning,
    mcResult,
    drawnHand,
    drawHand,
    handHistory,
    clearHistory,
    deckIsEmpty,
  };
}
