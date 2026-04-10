import express from "express";
import cors from "cors";
import cardsRouter from "./routes/cards.js";
import { getCacheStats } from "./cache.js";

const app = express();
const PORT = process.env["PORT"] ?? 3000;

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));
app.use(express.json());

// Routes
app.use("/api/cards", cardsRouter);

// Health + cache stats
app.get("/health", (_req, res) => {
  res.json({ status: "ok", cache: getCacheStats() });
});

app.listen(PORT, () => {
  console.log(`YGO API running on http://localhost:${PORT}`);
});
