// src/App.tsx
import { Routes, Route } from "react-router-dom";
import GameComponent from "./GameComponent";
import AdminConsole from "./AdminConsole";

export default function App() {
  return (
    <div>
      <Routes>
        <Route path="/" element={<GameComponent />} />
        <Route path="/admin" element={<AdminConsole />} />
      </Routes>
    </div>
  );
}
