/**
 * Web Worker — runs Monte Carlo simulation off the main thread.
 * Receives a SimulationConfig, returns a SimulationResult.
 * Keeps the UI fully responsive even at 50,000 iterations.
 */

import { runSimulation } from "@yugioh/core";
import type { SimulationConfig } from "@yugioh/core";

export type WorkerRequest = {
  id: string;
  config: SimulationConfig;
};

export type WorkerResponse =
  | { id: string; type: "success"; result: ReturnType<typeof runSimulation> }
  | { id: string; type: "error"; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, config } = e.data;
  try {
    const result = runSimulation(config);
    const response: WorkerResponse = { id, type: "success", result };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = { id, type: "error", message: String(err) };
    self.postMessage(response);
  }
};
