import { Routes, Route, NavLink } from "react-router-dom";
import CardSearchPage from "@/features/cards/CardSearchPage";
import DeckBuilderPage from "@/features/deck-builder/DeckBuilderPage";
import RecommenderPage from "@/features/recommender/RecommenderPage";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--color-bg)", color: "var(--color-text)" }}>
      <header className="border-b px-6 py-3 flex items-center gap-6" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}>
        <span className="font-bold text-lg tracking-wide" style={{ color: "var(--color-accent)" }}>
          YGO Deck Manager
        </span>
        <nav className="flex gap-4 text-sm">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? "font-semibold" : "opacity-60 hover:opacity-100"
            }
            style={({ isActive }) => ({ color: isActive ? "var(--color-accent)" : "var(--color-text)" })}
          >
            Card Search
          </NavLink>
          <NavLink
            to="/deck-builder"
            className={({ isActive }) =>
              isActive ? "font-semibold" : "opacity-60 hover:opacity-100"
            }
            style={({ isActive }) => ({ color: isActive ? "var(--color-accent)" : "var(--color-text)" })}
          >
            Deck Builder
          </NavLink>
          <NavLink
            to="/recommender"
            className={({ isActive }) =>
              isActive ? "font-semibold" : "opacity-60 hover:opacity-100"
            }
            style={({ isActive }) => ({ color: isActive ? "var(--color-accent)" : "var(--color-text)" })}
          >
            Recommender
          </NavLink>
        </nav>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<CardSearchPage />} />
          <Route path="/deck-builder" element={<DeckBuilderPage />} />
          <Route path="/recommender" element={<RecommenderPage />} />
        </Routes>
      </main>
    </div>
  );
}
