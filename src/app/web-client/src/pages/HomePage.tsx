import { useNavigate } from "react-router-dom";
import "./HomePage.css";

function HomePage() {
  const navigate = useNavigate();

  const handleAppClick = (appName: string) => {
    navigate(`/report/${appName}`);
  };

  return (
    <div className="home-page">
      <header className="home-header">
        <h1>Poly Wynn Web</h1>
        <p>选择应用查看报告</p>
      </header>
      <main className="home-main">
        <div className="apps-grid">
          <div className="app-card" onClick={() => handleAppClick("crypto15min")}>
            <div className="app-card-icon">📊</div>
            <h2 className="app-card-title">Crypto 15min</h2>
            <p className="app-card-desc">加密货币15分钟交易策略</p>
          </div>
          <div className="app-card" onClick={() => handleAppClick("spreadArbitrage")}>
            <div className="app-card-icon">⚡</div>
            <h2 className="app-card-title">Spread Arbitrage</h2>
            <p className="app-card-desc">价差套利交易策略</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default HomePage;

