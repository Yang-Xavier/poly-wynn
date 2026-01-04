import { Request, Response } from "express";
import { getDataByTraceId } from "../services/dataService";
import { isValidDateString, getTodayDateString } from "../utils/dateUtils";

/**
 * Data 控制器
 */

/**
 * 获取数据
 * GET /data/:appName?date=yyyy-mm-dd&traceId=xxxx
 */
export async function getDataHandler(
  req: Request<{ appName: string }, any, any, { date?: string; traceId?: string; time?: string }>,
  res: Response
): Promise<void> {
  try {
    const { appName } = req.params;
    const { date, traceId, time } = req.query;

    // 参数验证
    if (!traceId) {
      res.status(400).json({ error: "缺少必要参数: traceId" });
      return;
    }

    // 如果没有传 date，使用当天日期（北京时间）
    const targetDate = date && isValidDateString(date) ? date : getTodayDateString();
    
    if (date && !isValidDateString(date)) {
      res.status(400).json({ error: "日期格式错误，应为 yyyy-mm-dd" });
      return;
    }

    // 读取数据
    const data = getDataByTraceId(appName, targetDate, traceId);

    // 将数据转换为 JSON 字符串，注入到页面
    const dataJson = JSON.stringify(data);

    // 返回 HTML 页面
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>数据查看 - ${appName} - ${traceId}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
      background: #1a1a1a;
      min-height: 100vh;
      padding: 20px;
      color: #e0e0e0;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .header {
      background: rgba(30, 30, 30, 0.95);
      padding: 20px 30px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    h1 {
      color: #e0e0e0;
      font-size: 24px;
      margin-bottom: 15px;
    }
    .meta {
      color: #b0b0b0;
      font-size: 14px;
      margin-bottom: 15px;
    }
    .meta strong {
      color: #8b9aff;
      font-weight: 600;
    }
    .search-box {
      display: flex;
      gap: 10px;
      margin-top: 15px;
    }
    .search-input {
      flex: 1;
      padding: 12px 16px;
      background: #2a2a2a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 14px;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    }
    .search-input:focus {
      outline: none;
      border-color: #8b9aff;
      box-shadow: 0 0 0 2px rgba(139, 154, 255, 0.2);
    }
    .search-btn {
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .search-btn:hover {
      background: linear-gradient(135deg, #5568d3 0%, #653a8f 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .data-container {
      display: grid;
      gap: 20px;
    }
    .data-chunk {
      background: rgba(30, 30, 30, 0.95);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .data-chunk-header {
      padding: 15px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-weight: 600;
      font-size: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      transition: background 0.2s ease;
    }
    .data-chunk-header:hover {
      background: linear-gradient(135deg, #5568d3 0%, #653a8f 100%);
    }
    .data-chunk-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .toggle-icon {
      font-size: 14px;
      transition: transform 0.3s ease;
    }
    .data-chunk.collapsed .toggle-icon {
      transform: rotate(-90deg);
    }
    .data-content {
      max-height: 600px;
      overflow-y: auto;
      padding: 15px;
      background: #252525;
      transition: max-height 0.3s ease, padding 0.3s ease;
    }
    .data-chunk.collapsed .data-content {
      max-height: 0;
      padding: 0 15px;
      overflow: hidden;
    }
    .data-count {
      background: rgba(255, 255, 255, 0.2);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
    }
    .data-content {
      max-height: 600px;
      overflow-y: auto;
      padding: 15px;
      background: #252525;
    }
    .data-content::-webkit-scrollbar {
      width: 8px;
    }
    .data-content::-webkit-scrollbar-track {
      background: #1a1a1a;
      border-radius: 4px;
    }
    .data-content::-webkit-scrollbar-thumb {
      background: #555;
      border-radius: 4px;
    }
    .data-content::-webkit-scrollbar-thumb:hover {
      background: #777;
    }
    .data-item {
      margin: 8px 0;
      padding: 12px;
      background: #2a2a2a;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      color: #e0e0e0;
      word-wrap: break-word;
    }
    .data-item:hover {
      background: #333333;
      border-left-color: #8b9aff;
    }
    .data-time {
      color: #9cdcfe;
      font-weight: 600;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .data-json {
      white-space: pre-wrap;
      color: #ce9178;
    }
    .empty-message {
      text-align: center;
      color: #999;
      padding: 40px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 数据查看</h1>
      <div class="meta">
        <strong>应用:</strong> ${appName} | <strong>日期:</strong> ${targetDate} | <strong>TraceID:</strong> ${traceId}
      </div>
      <div class="search-box">
        <input 
          type="text" 
          id="timeInput" 
          class="search-input" 
          placeholder="输入时间 (例如: 2026-01-04 22:13:06.703)"
          value="${time ? time.replace(/"/g, '&quot;') : ''}"
        />
        <button class="search-btn" onclick="searchData()">搜索</button>
      </div>
    </div>
    <div class="data-container" id="dataContainer">
      <!-- 数据将在这里动态渲染 -->
    </div>
  </div>

  <script>
    // 将数据注入到 window.logData
    window.logData = ${dataJson};
    
    // 格式化时间戳为 "yyyy-mm-dd HH:mm:ss.SSS" 格式（北京时间 UTC+8）
    function formatTimestamp(timestamp) {
      if (!timestamp) {
        return 'N/A';
      }
      
      const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp);
      if (isNaN(ts)) {
        return 'N/A';
      }
      
      // 时间戳是 UTC 时间戳（毫秒），需要转换为北京时间（UTC+8）
      // 直接加上 8 小时得到北京时间的时间戳
      const beijingOffset = 8 * 60 * 60 * 1000; // 8小时 = 28800000 毫秒
      const beijingTimestamp = ts + beijingOffset;
      const beijingDate = new Date(beijingTimestamp);
      
      // 使用 UTC 方法获取年月日时分秒（因为 beijingTimestamp 已经是 UTC+8 的时间戳）
      const year = beijingDate.getUTCFullYear();
      const month = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(beijingDate.getUTCDate()).padStart(2, '0');
      const hour = String(beijingDate.getUTCHours()).padStart(2, '0');
      const minute = String(beijingDate.getUTCMinutes()).padStart(2, '0');
      const second = String(beijingDate.getUTCSeconds()).padStart(2, '0');
      const millisecond = String(beijingDate.getUTCMilliseconds()).padStart(3, '0');
      
      return \`\${year}-\${month}-\${day} \${hour}:\${minute}:\${second}.\${millisecond}\`;
    }
    
    // 渲染数据
    function renderData(data) {
      const container = document.getElementById('dataContainer');
      
      if (!data || Object.keys(data).length === 0) {
        container.innerHTML = '<div class="empty-message">暂无数据</div>';
        return;
      }
      
      const html = Object.entries(data)
        .map(([dataName, items], index) => {
          const itemsHtml = items
            .map(item => {
              const timestamp = getTimestamp(item);
              const timeStr = formatTimestamp(timestamp);
              const itemStr = JSON.stringify(item, null, 2);
              return \`
                <div class="data-item">
                  <div class="data-time">\${timeStr}</div>
                  <div class="data-json">\${itemStr}</div>
                </div>
              \`;
            })
            .join('');
          
          return \`
            <div class="data-chunk" id="chunk-\${index}">
              <div class="data-chunk-header" onclick="toggleDataChunk(\${index})">
                <div class="data-chunk-title">
                  <span class="toggle-icon" id="icon-\${index}">▼</span>
                  <span>\${dataName}</span>
                </div>
                <span class="data-count">\${items.length} 条</span>
              </div>
              <div class="data-content" id="content-\${index}">
                \${itemsHtml}
              </div>
            </div>
          \`;
        })
        .join('');
      
      container.innerHTML = html;
    }
    
    // 解析时间字符串为时间戳（毫秒）- 输入时间视为北京时间（UTC+8）
    function parseTimeString(timeStr) {
      // 格式: "2026-01-04 22:13:06.703" 或 "2026-01-04 22:13:06"
      // 支持带毫秒和不带毫秒的格式
      // 输入时间视为北京时间（UTC+8），需要转换为 UTC 时间戳
      let match = timeStr.match(/(\\d{4})-(\\d{2})-(\\d{2})\\s+(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,3}))?/);
      
      if (!match) {
        return null;
      }
      
      const [, year, month, day, hour, minute, second, millisecond = '0'] = match;
      
      // 将输入时间视为北京时间（UTC+8），创建 UTC 时间对象
      // 需要减去 8 小时得到 UTC 时间
      const beijingDate = new Date(
        Date.UTC(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hour),
          parseInt(minute),
          parseInt(second),
          parseInt(millisecond.padEnd(3, '0'))
        )
      );
      
      // 减去 8 小时得到 UTC 时间戳
      const utcTimestamp = beijingDate.getTime() - 8 * 60 * 60 * 1000;
      
      return utcTimestamp;
    }
    
    // 从数据项中提取 timestamp
    function getTimestamp(item) {
      if (item.timestamp) {
        return typeof item.timestamp === 'number' ? item.timestamp : parseInt(item.timestamp);
      }
      return null;
    }
    
    // 搜索数据
    function searchData() {
      const timeInput = document.getElementById('timeInput');
      const timeStr = timeInput.value.trim();
      
      if (!timeStr) {
        // 如果没有输入，显示所有数据
        renderData(window.logData);
        return;
      }
      
      // 解析时间
      const targetTime = parseTimeString(timeStr);
      if (!targetTime) {
        // 如果格式错误，弹出提示
        alert('时间格式错误，请使用格式: 2026-01-04 22:13:06.703');
        return;
      }
      
      // 时间范围：前后 30 秒
      const timeRange = 30 * 1000; // 30 秒 = 30000 毫秒
      const startTime = targetTime - timeRange;
      const endTime = targetTime + timeRange;
      
      // 筛选数据
      const filteredData = {};
      
      for (const [dataName, items] of Object.entries(window.logData)) {
        const filteredItems = items.filter(item => {
          const timestamp = getTimestamp(item);
          if (timestamp === null) {
            return false;
          }
          return timestamp >= startTime && timestamp <= endTime;
        });
        
        if (filteredItems.length > 0) {
          filteredData[dataName] = filteredItems;
        }
      }
      
      renderData(filteredData);
    }
    
    // 切换数据块折叠状态
    function toggleDataChunk(index) {
      const chunk = document.getElementById(\`chunk-\${index}\`);
      const icon = document.getElementById(\`icon-\${index}\`);
      
      if (chunk) {
        chunk.classList.toggle('collapsed');
        if (chunk.classList.contains('collapsed')) {
          icon.textContent = '▶';
        } else {
          icon.textContent = '▼';
        }
      }
    }
    
    // 初始渲染：显示所有数据
    renderData(window.logData);
    
    // 如果 URL 中有 time 参数，自动执行搜索
    const timeInput = document.getElementById('timeInput');
    if (timeInput && timeInput.value.trim()) {
      searchData();
    }
  </script>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    console.error("获取数据失败:", error);
    res.status(500).json({ error: "获取数据失败" });
  }
}

