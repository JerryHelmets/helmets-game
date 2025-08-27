// src/App.tsx
import { Routes, Route } from "react-router-dom";
import GameComponent from "./GameComponent";

export default function App() {
  return (
    <div>
      <Routes>
        <Route path="/" element={<GameComponent />} />
      </Routes>
    </div>
  );
}
