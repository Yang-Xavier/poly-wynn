import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import "./DataPage.css";

interface DataItem {
  [key: string]: any;
  timestamp: number;
}

interface DataResponse {
  success: boolean;
  data: {
    [dataName: string]: DataItem[];
  };
}

function DataPage() {
  const {
    dappName,
    traceId,
    timestamp: routeTimestamp,
  } = useParams<{
    dappName: string;
    traceId: string;
    timestamp?: string;
  }>();

  const [data, setData] = useState<{ [dataName: string]: DataItem[] }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterTimestamp, setFilterTimestamp] = useState<string>(routeTimestamp || "");
  const [filterRange, setFilterRange] = useState<string>("30");
  const [filteredData, setFilteredData] = useState<{ [dataName: string]: DataItem[] }>({});

  // 获取当前日期（北京时间，格式：YYYY-MM-DD）
  const getCurrentDate = (): string => {
    const now = new Date();
    // 转换为北京时间（UTC+8）
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, "0");
    const day = String(beijingTime.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // 从时间戳（毫秒）计算日期（北京时间，格式：YYYY-MM-DD）
  const getDateFromTimestamp = (timestamp: number | string): string => {
    const ts = typeof timestamp === "string" ? parseInt(timestamp, 10) : timestamp;
    // 转换为北京时间（UTC+8）
    const beijingTime = new Date(ts + 8 * 60 * 60 * 1000);
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, "0");
    const day = String(beijingTime.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!dappName || !traceId) return;

      setLoading(true);
      setError(null);

      try {
        // 优先从路由中的 timestamp 计算日期，如果没有则使用当日日期
        let date: string;
        if (routeTimestamp) {
          date = getDateFromTimestamp(routeTimestamp);
        } else {
          date = getCurrentDate();
        }
        const response = await axios.get<DataResponse>(
          `/api/data?appName=${dappName}&date=${date}&traceId=${traceId}`
        );

        if (response.data.success && response.data.data) {
          setData(response.data.data);
          // 初始加载时，如果有路由 timestamp，自动应用过滤
          if (routeTimestamp) {
            applyFilter(response.data.data, routeTimestamp, filterRange);
          } else {
            setFilteredData(response.data.data);
          }
        } else {
          setError("数据格式错误");
        }
      } catch (err) {
        // 如果是 404 错误，显示友好的提示
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setData({});
          setFilteredData({});
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : "获取数据失败");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dappName, traceId]);

  // 格式化时间戳为北京时间（精确到毫秒）
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    // 转换为北京时间（UTC+8）
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, "0");
    const day = String(beijingTime.getUTCDate()).padStart(2, "0");
    const hour = String(beijingTime.getUTCHours()).padStart(2, "0");
    const minute = String(beijingTime.getUTCMinutes()).padStart(2, "0");
    const second = String(beijingTime.getUTCSeconds()).padStart(2, "0");
    const millisecond = String(beijingTime.getUTCMilliseconds()).padStart(3, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}.${millisecond}`;
  };

  // 应用过滤
  const applyFilter = (
    dataToFilter: { [dataName: string]: DataItem[] },
    timestampStr: string,
    rangeStr: string
  ) => {
    if (!timestampStr || timestampStr.trim() === "") {
      // 如果时间戳为空，展示所有数据
      setFilteredData(dataToFilter);
      return;
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      setError("时间戳格式错误");
      return;
    }

    const range = parseInt(rangeStr, 10) || 5;
    const rangeMs = range * 1000; // 转换为毫秒
    const minTimestamp = timestamp - rangeMs;
    const maxTimestamp = timestamp + rangeMs;

    const filtered: { [dataName: string]: DataItem[] } = {};

    Object.keys(dataToFilter).forEach((dataName) => {
      const items = dataToFilter[dataName].filter((item) => {
        const itemTimestamp = item.timestamp;
        return itemTimestamp >= minTimestamp && itemTimestamp <= maxTimestamp;
      });
      if (items.length > 0) {
        filtered[dataName] = items;
      }
    });

    setFilteredData(filtered);
    setError(null);
  };

  // 处理搜索
  const handleSearch = () => {
    applyFilter(data, filterTimestamp, filterRange);
  };

  // 当路由 timestamp 变化时，更新输入框
  useEffect(() => {
    if (routeTimestamp) {
      setFilterTimestamp(routeTimestamp);
      if (Object.keys(data).length > 0) {
        applyFilter(data, routeTimestamp, filterRange);
      }
    } else {
      // 如果没有路由 timestamp，清空过滤并显示所有数据
      setFilterTimestamp("");
      if (Object.keys(data).length > 0) {
        setFilteredData(data);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTimestamp, data]);

  if (loading) {
    return (
      <div className="data-page">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  if (error && Object.keys(data).length === 0) {
    return (
      <div className="data-page">
        <div className="error-message">❌ {error}</div>
      </div>
    );
  }

  const displayData = Object.keys(filteredData).length > 0 ? filteredData : data;

  return (
    <div className="data-page">
      <header className="data-header">
        <h1>数据详情</h1>
        <div className="data-info">
          <span className="info-item">应用: {dappName}</span>
          <span className="info-item">TraceId: {traceId}</span>
        </div>
      </header>

      <div className="filter-section">
        <div className="filter-inputs">
          <input
            type="text"
            className="filter-input"
            placeholder="时间戳（毫秒）"
            value={filterTimestamp}
            onChange={(e) => setFilterTimestamp(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
          />
          <input
            type="number"
            className="filter-input"
            placeholder="时间范围（秒）"
            value={filterRange}
            onChange={(e) => setFilterRange(e.target.value)}
            min="1"
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
          />
          <button className="search-button" onClick={handleSearch}>
            搜索
          </button>
        </div>
        {error && <div className="filter-error">{error}</div>}
      </div>

      <main className="data-content">
        {Object.keys(displayData).length === 0 ? (
          <div className="empty-message">暂无数据</div>
        ) : (
          Object.keys(displayData).map((dataName) => (
            <div key={dataName} className="data-group">
              <h2 className="data-group-title">{dataName}</h2>
              <div className="data-list">
                {displayData[dataName].map((item, index) => (
                  <div key={index} className="data-item">
                    <span className="data-timestamp">{formatTimestamp(item.timestamp)}</span>
                    <pre className="data-content-json">{JSON.stringify(item, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}

export default DataPage;
