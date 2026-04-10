import { Router } from "express";
import { getFullCatalog, searchCards, getCardById } from "../ygoproClient.js";

const router = Router();

/** GET /api/cards — return full catalog */
router.get("/", async (_req, res) => {
  try {
    const cards = await getFullCatalog();
    res.json({ data: cards, count: cards.length });
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch card catalog" });
  }
});

/** GET /api/cards/search?name=&type=&attribute=&level=&race=&archetype= */
router.get("/search", async (req, res) => {
  const allowed = ["fname", "name", "type", "attribute", "level", "race", "archetype"];
  const query: Record<string, string> = {};
  for (const key of allowed) {
    const val = req.query[key];
    if (typeof val === "string" && val) query[key] = val;
  }

  try {
    const cards = await searchCards(query);
    res.json({ data: cards, count: cards.length });
  } catch {
    res.status(502).json({ error: "Failed to search cards" });
  }
});

/** GET /api/cards/:id */
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid card ID" });
    return;
  }

  const card = await getCardById(id);
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  res.json({ data: card });
});

export default router;
