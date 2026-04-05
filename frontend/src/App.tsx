import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import Gallery from "./components/Gallery";
import MapView from "./components/MapView";
import TripsView from "./components/TripsView";
import IndexingPanel from "./components/IndexingPanel";
import type { Trip, Stats } from "./types";
import { getTrips, getStats } from "./api/client";

export default function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showIndexing, setShowIndexing] = useState(false);
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

  const handleIndexingDone = () => {
    loadStats();
    loadTrips();
  };

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
        <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            🗺️ TripViz
          </div>
          {stats && (
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4 }}>
              {stats.total_photos.toLocaleString()} photos · {stats.geotagged.toLocaleString()} geotagged
            </div>
          )}
        </div>

        {/* Nav links */}
        <div style={{ flex: 1, padding: "8px 0" }}>
          <NavItem to="/" label="Gallery" icon="🖼️" />
          <NavItem to="/map" label="Map" icon="🗺️" />
          <NavItem to="/trips" label="Trips" icon="✈️" />

          {trips.length > 0 && (
            <div style={{ padding: "12px 16px 4px", fontSize: 11, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Trips
            </div>
          )}
          {trips.map(trip => (
            <button
              key={trip.id}
              onClick={() => navigate(`/trips/${trip.id}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "7px 16px",
                color: "var(--text2)",
                fontSize: 13,
                textAlign: "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text2)")}
            >
              <span style={{
                width: 10, height: 10, borderRadius: "50%",
                background: trip.color, flexShrink: 0,
              }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {trip.name}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text2)" }}>
                {trip.photo_count}
              </span>
            </button>
          ))}
        </div>

        {/* Index button */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => setShowIndexing(true)}
            style={{
              width: "100%",
              background: "var(--accent)",
              color: "#fff",
              padding: "8px 12px",
              borderRadius: "var(--radius)",
              fontWeight: 600,
              fontSize: 13,
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
        </Routes>
      </main>

      {/* Indexing modal */}
      {showIndexing && (
        <IndexingPanel onClose={() => setShowIndexing(false)} onDone={handleIndexingDone} />
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
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        color: isActive ? "var(--text)" : "var(--text2)",
        background: isActive ? "var(--bg3)" : "transparent",
        borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        transition: "all 0.15s",
      })}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
