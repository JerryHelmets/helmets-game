import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import GameComponent from "./GameComponent";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GameComponent />} />
        {/* Route away anything else to the game */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
