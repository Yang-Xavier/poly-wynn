import { Routes, Route } from "react-router-dom";
import ReportPage from "./pages/ReportPage";
import "./App.css";

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/view/report/:dappName" element={<ReportPage />} />
        <Route path="/view/report/:dappName/:date" element={<ReportPage />} />
        <Route
          path="/"
          element={
            <div className="app">
              <header className="app-header">
                <h1>Poly Wynn Web</h1>
                <p>前后端分离应用示例</p>
              </header>
              <main className="app-main">
                <div className="card">
                  <h2>欢迎</h2>
                  <p>访问 /view/report/:dappName/:date 查看报告</p>
                </div>
              </main>
            </div>
          }
        />
      </Routes>
    </div>
  );
}

export default App;

