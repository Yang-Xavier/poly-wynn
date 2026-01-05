import { Routes, Route } from "react-router-dom";
import ReportPage from "./pages/ReportPage";
import DataPage from "./pages/DataPage";
import LogPage from "./pages/LogPage";
import HomePage from "./pages/HomePage";
import "./App.css";

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/report/:dappName" element={<ReportPage />} />
        <Route path="/report/:dappName/:date" element={<ReportPage />} />
        <Route path="/data/:dappName/:traceId" element={<DataPage />} />
        <Route path="/data/:dappName/:traceId/:timestamp" element={<DataPage />} />
        <Route path="/logs/:appName/:date/:traceId" element={<LogPage />} />
        <Route path="/" element={<HomePage />} />
      </Routes>
    </div>
  );
}

export default App;
