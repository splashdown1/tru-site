import { BrowserRouter, Route, Routes } from "react-router-dom";
import TruPublic from "./pages/tru-public";
import TruConsole from "./pages/tru-console";
import TruOnboard from "./pages/tru-onboard";
import TruVision from "./pages/tru-vision";
import TruWhitepaper from "./pages/tru-whitepaper";
import TruSovereign from "./pages/tru-sovereign";
import TruMission from "./pages/tru-mission";
import { ThemeProvider } from "@/components/theme-provider";

const basename = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "/";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/" element={<TruPublic />} />
          <Route path="/vision" element={<TruVision />} />
          <Route path="/whitepaper" element={<TruWhitepaper />} />
          <Route path="/mission" element={<TruMission />} />
          <Route path="/onboard" element={<TruOnboard />} />
          <Route path="/console" element={<TruConsole />} />
          <Route path="/sovereign" element={<TruSovereign />} />
          <Route path="*" element={<TruPublic />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
