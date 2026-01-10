import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  additionalInfo?: string;
}

interface ReportResponse {
  success: boolean;
  data: {
    reports: Report[];
  };
}

interface ProcessStatus {
  name: string;
  pid: number;
  pmId: number;
  status: string;
  uptime: number;
  restarts: number;
  cpu: number;
  memory: number;
}

interface ProcessResponse {
  success: boolean;
  appName: string;
  status: string;
  message?: string;
  process: ProcessStatus | null;
}

interface ProcessControlResponse {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  message?: string;
  error?: string;
}

function ReportPage() {
  const { dappName, date } = useParams<{ dappName: string; date?: string }>();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processStatus, setProcessStatus] = useState<ProcessStatus | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);

  // 获取当前日期（YYYY-MM-DD格式）
  const getCurrentDate = (): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // 获取 PM2 进程状态
  const fetchProcessStatus = useCallback(async () => {
    if (!dappName) return;

    setProcessLoading(true);
    setProcessError(null);

    // 将 dappName 映射到 logs 目录中的 appName
    // 例如: crypto15min-eth -> crypto15min (需要根据实际情况调整)
    // 这里先尝试直接使用 dappName，如果失败再尝试映射
    let appName = dappName;
    
    // 如果 dappName 包含 "-"，尝试提取前面的部分作为 appName
    // 例如: crypto15min-eth -> crypto15min
    if (dappName.includes("-")) {
      const parts = dappName.split("-");
      // 尝试使用第一部分作为 appName
      appName = parts[0];
    }

    try {
      const response = await axios.get<ProcessResponse>(
        `/api/process?appName=${appName}`
      );

      if (response.data.success) {
        if (response.data.process) {
          setProcessStatus(response.data.process);
        } else {
          setProcessStatus(null);
        }
      } else {
        setProcessError(response.data.message || "获取进程状态失败");
        setProcessStatus(null);
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        // 如果第一次尝试失败，尝试使用完整的 dappName
        if (dappName !== appName) {
          try {
            const retryResponse = await axios.get<ProcessResponse>(
              `/api/process?appName=${dappName}`
            );
            if (retryResponse.data.success && retryResponse.data.process) {
              setProcessStatus(retryResponse.data.process);
              setProcessError(null);
              setProcessLoading(false);
              return;
            }
          } catch (retryErr) {
            // 忽略重试错误，使用原始错误
          }
        }
        setProcessError(err.response?.data?.error || err.message || "获取进程状态失败");
      } else {
        setProcessError(err instanceof Error ? err.message : "获取进程状态失败");
      }
      setProcessStatus(null);
    } finally {
      setProcessLoading(false);
    }
  }, [dappName]);

  // 控制 PM2 进程（启动/停止）
  const handleProcessControl = async (action: "start" | "stop") => {
    if (!dappName || controlling) return;

    setControlling(true);
    setProcessError(null);

    // 使用与获取状态相同的 appName 映射逻辑
    let appName = dappName;
    if (dappName.includes("-")) {
      const parts = dappName.split("-");
      appName = parts[0];
    }

    try {
      const response = await axios.post<ProcessControlResponse>(
        `/api/process?appName=${appName}`,
        { action }
      );

      if (response.data.success) {
        // 控制成功后，等待 1 秒后重新获取进程状态
        setTimeout(async () => {
          await fetchProcessStatus();
        }, 1000);
      } else {
        // 如果第一次尝试失败，尝试使用完整的 dappName
        if (dappName !== appName) {
          try {
            const retryResponse = await axios.post<ProcessControlResponse>(
              `/api/process?appName=${dappName}`,
              { action }
            );
            if (retryResponse.data.success) {
              setTimeout(async () => {
                await fetchProcessStatus();
              }, 1000);
              setControlling(false);
              return;
            }
          } catch (retryErr) {
            // 忽略重试错误，使用原始错误
          }
        }
        setProcessError(response.data.error || "操作失败");
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setProcessError(err.response?.data?.error || err.message || "操作失败");
      } else {
        setProcessError(err instanceof Error ? err.message : "操作失败");
      }
    } finally {
      setControlling(false);
    }
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
        // 如果是 404 错误，显示友好的提示
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setReports([]);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : "获取报告失败");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [dappName, date]);

  // 获取进程状态
  useEffect(() => {
    fetchProcessStatus();
    // 每 5 秒自动刷新进程状态
    const interval = setInterval(fetchProcessStatus, 5000);
    return () => clearInterval(interval);
  }, [dappName, fetchProcessStatus]);

  // 获取result标签样式
  const getResultBadge = (result: string) => {
    const lowerResult = result.toLowerCase();
    if (lowerResult === "won") {
      return <span className="result-badge result-won">✓ Won</span>;
    } else if (lowerResult === "lost") {
      return <span className="result-badge result-lost">✗ Lost</span>;
    } else if (lowerResult === "sold") {
      return <span className="result-badge result-sold">$ Sold</span>;
    } else if (lowerResult === "hold") {
      return <span className="result-badge result-hold">⏸ Hold</span>;
    } else if (lowerResult === "skipped") {
      return <span className="result-badge result-skipped">⊘ Skipped</span>;
    } else if (lowerResult === "waiting..." || lowerResult === "waiting") {
      return <span className="result-badge result-waiting">⏳ Waiting...</span>;
    } else if (lowerResult === "error") {
      return <span className="result-badge result-error">⚠ Error</span>;
    }
    return <span className="result-badge result-default">{result}</span>;
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

  // 格式化运行时长
  const formatDuration = (seconds: number): string => {
    if (seconds < 0) return "未知";

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) {
      return `${days}天 ${hours}小时 ${minutes}分钟`;
    } else if (hours > 0) {
      return `${hours}小时 ${minutes}分钟 ${secs}秒`;
    } else if (minutes > 0) {
      return `${minutes}分钟 ${secs}秒`;
    } else {
      return `${secs}秒`;
    }
  };

  // 格式化启动时间（北京时间）和运行时长
  const formatUptime = (uptime: number | undefined): string => {
    if (!uptime || uptime === 0 || isNaN(uptime)) return "未运行";
    
    // uptime 是进程启动的时间戳（毫秒）
    const startTime = new Date(uptime);
    
    // 验证日期是否有效
    if (isNaN(startTime.getTime())) {
      return "时间无效";
    }
    
    // 转换为北京时间（UTC+8）
    const startTimeStr = startTime.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    
    // 计算运行时长（秒）
    const now = Date.now();
    const durationSeconds = Math.floor((now - uptime) / 1000);
    const durationStr = formatDuration(durationSeconds);
    
    // 返回：启动时间 (已运行 时长)
    return `${startTimeStr} (已运行 ${durationStr})`;
  };

  // 获取进程状态显示文本
  const getProcessStatusText = (status: string | null): string => {
    if (!status) return "未知";
    
    const statusMap: Record<string, string> = {
      online: "运行中",
      stopping: "停止中",
      stopped: "已停止",
      launching: "启动中",
      errored: "错误",
      "one-launch-status": "单次启动",
      "waiting restart": "等待重启",
      not_found: "未找到",
    };

    return statusMap[status] || status;
  };

  // 判断进程是否运行中
  const isProcessRunning = (status: string | null): boolean => {
    return status === "online" || status === "launching";
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

  // 计算今日总收益
  const totalProfit = useMemo(() => {
    return reports.reduce((sum, report) => {
      return sum + (report.profit ?? 0);
    }, 0);
  }, [reports]);

  // 计算统计数据
  const statistics = useMemo(() => {
    const stats = {
      won: 0,
      lost: 0,
      sold: 0,
      skipped: 0,
      total: reports.length,
    };

    reports.forEach((report) => {
      const result = report.result.toLowerCase();
      if (result === "won") {
        stats.won++;
      } else if (result === "lost") {
        stats.lost++;
      } else if (result === "sold") {
        stats.sold++;
      } else if (result === "skipped") {
        stats.skipped++;
      }
    });

    return stats;
  }, [reports]);

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
        <div className="report-header-top">
          <h1>报告详情</h1>
          <div className="report-info">
            <span className="info-item">应用: {dappName}</span>
            <span className="info-item">日期: {date || getCurrentDate()}</span>
          </div>
        </div>
        <div className="process-status-section">
          <div className="process-status-info">
            {processLoading ? (
              <span className="process-status-loading">加载中...</span>
            ) : processError ? (
              <span className="process-status-error">❌ {processError}</span>
            ) : processStatus ? (
              <>
                <span className="process-status-label">状态:</span>
                <span
                  className={`process-status-badge ${
                    isProcessRunning(processStatus.status) ? "status-online" : "status-stopped"
                  }`}
                >
                  {getProcessStatusText(processStatus.status)}
                </span>
                <span className="process-status-separator">|</span>
                <span className="process-status-label">启动时间:</span>
                <span className="process-status-uptime">
                  {formatUptime(processStatus.uptime)}
                </span>
              </>
            ) : (
              <span className="process-status-label">进程未找到</span>
            )}
          </div>
          <button
            className={`process-control-btn ${
              isProcessRunning(processStatus?.status || null) ? "btn-stop" : "btn-start"
            }`}
            onClick={() =>
              handleProcessControl(
                isProcessRunning(processStatus?.status || null) ? "stop" : "start"
              )
            }
            disabled={processLoading || controlling}
            title={
              processLoading
                ? "加载中..."
                : controlling
                  ? "操作中..."
                  : isProcessRunning(processStatus?.status || null)
                    ? "停止应用"
                    : "启动应用"
            }
          >
            {controlling
              ? "操作中..."
              : isProcessRunning(processStatus?.status || null)
                ? "停止"
                : "启动"}
          </button>
        </div>
      </header>

      <main className="report-content">
        {reports.length === 0 ? (
          <div className="empty-message">暂无报告数据</div>
        ) : (
          <>
            <div className="today-profit-bar">
              <div className="profit-section">
                <div className="today-profit-label">今日收益</div>
                <div className={`today-profit-value ${totalProfit >= 0 ? "positive" : "negative"}`}>
                  {totalProfit > 0 ? "+" : ""}
                  {totalProfit.toFixed(2)}
                </div>
              </div>
              <div className="statistics-section">
                <div className="stat-item">
                  <span className="stat-label">Won</span>
                  <span className="stat-value stat-won">{statistics.won}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Lost</span>
                  <span className="stat-value stat-lost">{statistics.lost}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Sold</span>
                  <span className="stat-value stat-sold">{statistics.sold}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Skipped</span>
                  <span className="stat-value stat-skipped">{statistics.skipped}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">总场次</span>
                  <span className="stat-value stat-total">{statistics.total}</span>
                </div>
              </div>
            </div>
            <div className="reports-list">
              {reports.map((report, index) => (
                <div key={`${report.traceId}-${index}`} className="report-item">
                  <div className="report-header-row">
                    <a
                      href={`https://polymarket.com/event/${report.traceId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="trace-id"
                    >
                      [{report.traceId}]
                    </a>
                    <div className="result-badge-wrapper">
                      {getResultBadge(report.result)}
                      {report.additionalInfo && (
                        <div className="info-tooltip-container">
                          <span className="info-icon">ℹ️</span>
                          <div className="info-tooltip">{report.additionalInfo}</div>
                        </div>
                      )}
                    </div>
                    {report.balance !== undefined && (
                      <span className="balance">
                        💰 {report.balance?.toFixed(2)}
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

                  {report.trades?.length > 0 && (
                    <div className="trades-section">
                      {report.trades.map((trade, tradeIndex) => (
                        <div key={tradeIndex} className="trade-item">
                          <span className="trade-timestamp">
                            {formatTradeTimestamp(trade.timestamp)}
                          </span>
                          <span className="trade-action" data-action={trade.action.toLowerCase()}>
                            {trade.action}
                          </span>
                          <span className="trade-outcome">{trade.outcome}</span>
                          <span className="trade-details">
                            {(trade.amount ?? 0).toFixed(2)}@{(trade.price ?? 0).toFixed(2)}
                          </span>
                          <button
                            className="trade-view-data-btn"
                            onClick={() => {
                              if (dappName) {
                                navigate(`/data/${dappName}/${report.traceId}/${trade.timestamp}`);
                              }
                            }}
                            title="查看数据"
                          >
                            查看数据
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="report-footer">
                    <button
                      className="report-view-log-btn"
                      onClick={() => {
                        if (dappName) {
                          const reportDate = date || getCurrentDate();
                          navigate(`/logs/${dappName}/${reportDate}/${report.traceId}`);
                        }
                      }}
                      title="查看日志"
                    >
                      查看日志
                    </button>
                    <div className="report-timestamp">
                      最后更新时间: {formatTimestamp(report.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default ReportPage;
