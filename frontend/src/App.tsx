import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import Gallery from "./components/Gallery";
import MapView from "./components/MapView";
import TripsView from "./components/TripsView";
import PeopleView from "./components/PeopleView";
import KitView from "./components/KitView";
import IndexingPanel from "./components/IndexingPanel";
import MLPanel from "./components/MLPanel";
import TripDetector from "./components/TripDetector";
import type { Trip, Stats } from "./types";
import { getTrips, getStats } from "./api/client";

export default function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showIndexing, setShowIndexing] = useState(false);
  const [showML, setShowML] = useState(false);
  const [showDetector, setShowDetector] = useState(false);
  const navigate = useNavigate();

  const loadTrips = useCallback(async () => {
    try { setTrips(await getTrips()); } catch {}
  }, []);

  const loadStats = useCallback(async () => {
    try { setStats(await getStats()); } catch {}
  }, []);

  useEffect(() => {
    loadTrips();
    loadStats();
  }, [loadTrips, loadStats]);

  const refresh = useCallback(() => { loadTrips(); loadStats(); }, [loadTrips, loadStats]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <nav style={{
        width: "var(--sidebar-width)",
        background: "var(--bg2)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: "18px 16px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 19, fontWeight: 700 }}>🗺️ TripViz</div>
          {stats && (
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 3 }}>
              {stats.total_photos.toLocaleString()} photos · {stats.geotagged.toLocaleString()} geotagged
            </div>
          )}
        </div>

        {/* Primary nav */}
        <div style={{ padding: "6px 0" }}>
          <NavItem to="/" label="Gallery" icon="🖼️" />
          <NavItem to="/map" label="Map" icon="🗺️" />
          <NavItem to="/trips" label="Trips" icon="✈️" />
          <NavItem to="/people" label="People" icon="👥" />
          <NavItem to="/kit" label="Kit List" icon="📷" />
        </div>

        {/* Trip shortcuts */}
        {trips.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 4 }}>
            <div style={{ padding: "8px 16px 2px", fontSize: 10, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              Trips
            </div>
            {trips.slice(0, 8).map(trip => (
              <button
                key={trip.id}
                onClick={() => navigate(`/trips/${trip.id}`)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  width: "100%", padding: "5px 16px",
                  color: "var(--text2)", fontSize: 12, textAlign: "left",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "var(--text)")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--text2)")}
              >
                <span style={{
                  width: 9, height: 9, borderRadius: "50%",
                  background: trip.color, flexShrink: 0,
                }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {trip.name}
                </span>
                <span style={{ fontSize: 10, color: "var(--text2)", flexShrink: 0 }}>
                  {trip.photo_count}
                </span>
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        <div style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => setShowDetector(true)}
            style={{
              width: "100%", padding: "7px 12px",
              borderRadius: "var(--radius)", fontSize: 12, fontWeight: 600,
              border: "1px solid var(--border)", color: "var(--text2)",
            }}
          >
            🔍 Detect Trips
          </button>
          <button
            onClick={() => setShowML(true)}
            style={{
              width: "100%", padding: "7px 12px",
              borderRadius: "var(--radius)", fontSize: 12, fontWeight: 600,
              border: "1px solid var(--border)", color: "var(--text2)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            🤖 ML Features
          </button>
          <button
            onClick={() => setShowIndexing(true)}
            style={{
              width: "100%", background: "var(--accent)", color: "#fff",
              padding: "8px 12px", borderRadius: "var(--radius)",
              fontWeight: 600, fontSize: 13,
            }}
          >
            + Index Photos
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Routes>
          <Route path="/" element={<Gallery trips={trips} onTripChange={loadTrips} onStatsChange={loadStats} />} />
          <Route path="/map" element={<MapView trips={trips} />} />
          <Route path="/trips" element={<TripsView trips={trips} onTripsChange={loadTrips} />} />
          <Route path="/trips/:tripId" element={<TripsView trips={trips} onTripsChange={loadTrips} />} />
          <Route path="/people" element={<PeopleView trips={trips} onTripsChange={loadTrips} />} />
          <Route path="/kit" element={<KitView trips={trips} onTripsChange={loadTrips} />} />
        </Routes>
      </main>

      {showIndexing && (
        <IndexingPanel onClose={() => setShowIndexing(false)} onDone={refresh} />
      )}
      {showML && (
        <MLPanel onClose={() => setShowML(false)} onDone={refresh} />
      )}
      {showDetector && (
        <TripDetector
          trips={trips}
          onClose={() => setShowDetector(false)}
          onTripsCreated={() => { refresh(); setShowDetector(false); }}
        />
      )}
    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      style={({ isActive }) => ({
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 16px",
        color: isActive ? "var(--text)" : "var(--text2)",
        background: isActive ? "var(--bg3)" : "transparent",
        borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
        fontSize: 13, fontWeight: isActive ? 600 : 400,
        transition: "all 0.12s",
      })}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
