// src/App.tsx
import { useState } from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import GameComponent from "./GameComponent";
import AdminPanel from "./AdminPanel";
import { X } from "lucide-react";

const ADMIN_PASSWORD = "JH88teryy4$!&ret";

function ProtectedAdmin() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const navigate = useNavigate();

  const tryLogin = () => {
    if (password === ADMIN_PASSWORD) {
      setAuthed(true);
    } else {
      alert("Wrong password");
    }
  };

  if (!authed) {
    return (
      <div className="max-w-sm mx-auto p-6">
        <h2 className="text-xl font-bold mb-4">Admin Login</h2>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2 w-full rounded mb-4"
        />
        <button
          onClick={tryLogin}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 mr-2"
        >
          Login
        </button>
        <button
          onClick={() => navigate("/")}
          className="bg-gray-300 px-4 py-2 rounded hover:bg-gray-400"
        >
          Back to Game
        </button>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/"
        className="absolute top-4 right-4 text-gray-600 hover:text-gray-900"
      >
        <X size={24} />
      </Link>
      <AdminPanel />
    </div>
  );
}

export default function App() {
  return (
    <div>
      {/* navigation removed */}

      <Routes>
        <Route path="/" element={<GameComponent />} />
        <Route path="/admin" element={<ProtectedAdmin />} />
      </Routes>
    </div>
  );
}
