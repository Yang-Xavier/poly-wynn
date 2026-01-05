import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import "./ReportPage.css";

interface Trade {
  action: string;
  timestamp: number;
  price: number;
  amount: number;
  outcome: string;
}

interface Report {
  timestamp: number;
  traceId: string;
  result: string;
  trades: Trade[];
  balance?: number;
  profit?: number;
}

interface ReportResponse {
  success: boolean;
  data: {
    reports: Report[];
  };
}

function ReportPage() {
  const { dappName, date } = useParams<{ dappName: string; date?: string }>();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 获取当前日期（YYYY-MM-DD格式）
  const getCurrentDate = (): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    const fetchReport = async () => {
      if (!dappName) return;

      setLoading(true);
      setError(null);

      try {
        const reportDate = date || getCurrentDate();
        const response = await axios.get<ReportResponse>(
          `/api/report?appName=${dappName}&date=${reportDate}`
        );

        if (response.data.success && response.data.data.reports) {
          // 按timestamp从新到旧排序
          const sortedReports = [...response.data.data.reports].sort(
            (a, b) => b.timestamp - a.timestamp
          );
          setReports(sortedReports);
        } else {
          setError("报告数据格式错误");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "获取报告失败");
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [dappName, date]);

  // 获取result标签样式
  const getResultBadge = (result: string) => {
    const lowerResult = result.toLowerCase();
    if (lowerResult === "won") {
      return <span className="result-badge result-won">✓ Won</span>;
    } else if (lowerResult === "lost") {
      return <span className="result-badge result-lost">✗ Lost</span>;
    } else if (lowerResult === "sold") {
      return <span className="result-badge result-sold">$ Sold</span>;
    }
    return <span className="result-badge">{result}</span>;
  };

  // 格式化时间戳（北京时间）
  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  // 格式化交易时间戳（简洁格式，北京时间，包含毫秒）
  const formatTradeTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    // 转换为北京时间（UTC+8）
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, "0");
    const day = String(beijingTime.getUTCDate()).padStart(2, "0");
    const hour = String(beijingTime.getUTCHours()).padStart(2, "0");
    const minute = String(beijingTime.getUTCMinutes()).padStart(2, "0");
    const second = String(beijingTime.getUTCSeconds()).padStart(2, "0");
    const millisecond = String(beijingTime.getUTCMilliseconds()).padStart(3, "0");
    return `${month}-${day} ${hour}:${minute}:${second}.${millisecond}`;
  };

  if (loading) {
    return (
      <div className="report-page">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="report-page">
        <div className="error-message">❌ {error}</div>
      </div>
    );
  }

  return (
    <div className="report-page">
      <header className="report-header">
        <h1>报告详情</h1>
        <div className="report-info">
          <span className="info-item">应用: {dappName}</span>
          <span className="info-item">日期: {date || getCurrentDate()}</span>
        </div>
      </header>

      <main className="report-content">
        {reports.length === 0 ? (
          <div className="empty-message">暂无报告数据</div>
        ) : (
          <div className="reports-list">
            {reports.map((report, index) => (
              <div key={`${report.traceId}-${index}`} className="report-item">
                <div className="report-header-row">
                  <span className="trace-id">[{report.traceId}]</span>
                  {getResultBadge(report.result)}
                  {report.balance !== undefined && (
                    <span className="balance">
                      💰 {report.balance.toFixed(2)}
                      {report.profit !== undefined && (
                        <span className="profit">
                          {" "}
                          (收益: {report.profit > 0 ? "+" : ""}
                          {report.profit.toFixed(2)})
                        </span>
                      )}
                    </span>
                  )}
                </div>

                <div className="trades-section">
                  {report.trades?.map((trade, tradeIndex) => (
                    <div key={tradeIndex} className="trade-item">
                      <span className="trade-timestamp">
                        {formatTradeTimestamp(trade.timestamp)}
                      </span>
                      <span className="trade-action" data-action={trade.action.toLowerCase()}>
                        {trade.action}
                      </span>
                      <span className="trade-outcome">{trade.outcome}</span>
                      <span className="trade-details">
                        {trade.amount}@{trade.price.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="report-timestamp">{formatTimestamp(report.timestamp)}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default ReportPage;
