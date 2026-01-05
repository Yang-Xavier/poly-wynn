import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import "./LogPage.css";

interface LogResponse {
  success: boolean;
  data: {
    [logType: string]: string;
  };
  error?: string;
}

function LogPage() {
  const { appName, date, traceId } = useParams<{
    appName: string;
    date: string;
    traceId: string;
  }>();

  const [logs, setLogs] = useState<{ [logType: string]: string }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      if (!appName || !date || !traceId) return;

      setLoading(true);
      setError(null);

      try {
        const response = await axios.get<LogResponse>(
          `/api/log?appName=${appName}&date=${date}&traceId=${traceId}`
        );

        if (response.data.success && response.data.data) {
          setLogs(response.data.data);
        } else {
          setError(response.data.error || "日志数据格式错误");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "获取日志失败");
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [appName, date, traceId]);

  if (loading) {
    return (
      <div className="log-page">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="log-page">
        <div className="error-message">❌ {error}</div>
      </div>
    );
  }

  const logTypes = Object.keys(logs);

  return (
    <div className="log-page">
      <header className="log-header">
        <h1>日志详情</h1>
        <div className="log-info">
          <span className="info-item">应用: {appName}</span>
          <span className="info-item">日期: {date}</span>
          <span className="info-item">TraceId: {traceId}</span>
        </div>
      </header>

      <main className="log-content">
        {logTypes.length === 0 ? (
          <div className="empty-message">暂无日志数据</div>
        ) : (
          <div className="logs-list">
            {logTypes.map((logType) => (
              <div key={logType} className="log-item">
                <h2 className="log-type-title">{logType}</h2>
                <div className="log-content-wrapper">
                  <pre className="log-text">{logs[logType]}</pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default LogPage;

