import { BrowserRouter, Route, Routes } from "react-router-dom";
import TruPublic from "./pages/tru-public";
import TruConsole from "./pages/tru-console";
import { ThemeProvider } from "@/components/theme-provider";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<TruPublic />} />
          <Route path="/console" element={<TruConsole />} />
          <Route path="*" element={<TruPublic />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
