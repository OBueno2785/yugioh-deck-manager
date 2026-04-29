import express from "express";
import cors from "cors";
import cardsRouter from "./routes/cards.js";
import { metaDecksRouter, recommenderRouter } from "./routes/metaDecks.js";
import { comboRouter } from "./routes/combo.js";
import { recommendRouter } from "./routes/recommend.js";
import { getCacheStats } from "./cache.js";
import { getRecommenderStore } from "./recommender/recommenderStore.js";
import { getGraphStore } from "./recommender/graphStore.js";

const app = express();
const PORT = process.env["PORT"] ?? 3000;

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));
app.use(express.json());

// Routes
app.use("/api/cards", cardsRouter);
app.use("/api/meta-decks", metaDecksRouter);
app.use("/api/recommender", recommenderRouter);
app.use("/api/combo", comboRouter);
app.use("/api/recommend", recommendRouter);

// Health + cache stats
app.get("/health", (_req, res) => {
  res.json({ status: "ok", cache: getCacheStats() });
});

app.listen(PORT, () => {
  console.log(`YGO API running on http://localhost:${PORT}`);
  // Warm up stores in background on startup
  getRecommenderStore().catch((err) => console.error("[recommender] warm-up failed:", err));
  getGraphStore().catch((err) => console.error("[graph] warm-up failed:", err));
});
