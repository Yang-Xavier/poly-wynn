import * as path from "path";
import * as fs from "fs";

/**
 * 数据服务层
 */

/**
 * 获取项目根目录
 */
function getProjectRootDir(): string {
  let currentDir = __dirname;
  const rootDir = path.parse(currentDir).root;
  
  while (currentDir !== rootDir) {
    const dataPath = path.join(currentDir, "data");
    if (fs.existsSync(dataPath)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  
  const cwd = process.cwd();
  const cwdDataPath = path.join(cwd, "data");
  if (fs.existsSync(cwdDataPath)) {
    return cwd;
  }
  
  if (__dirname.includes("dist")) {
    return path.resolve(__dirname, "../..");
  }
  
  return path.resolve(__dirname, "../../../..");
}

/**
 * 读取 data 文件并按 dataName 分类
 * 返回格式: { [dataName]: [{}, {}] }
 */
export function getDataByTraceId(
  appName: string,
  date: string,
  traceId: string
): Record<string, any[]> {
  const projectRoot = getProjectRootDir();
  const dataDir = path.join(projectRoot, "data", appName, date);
  
  if (!fs.existsSync(dataDir)) {
    return {};
  }

  const result: Record<string, any[]> = {};
  
  // 读取目录下所有文件
  const files = fs.readdirSync(dataDir);
  
  // 筛选出匹配 traceId 的文件（格式：traceId_dataName.data）
  const pattern = new RegExp(`^${traceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(.+)\\.data$`);
  
  for (const file of files) {
    const match = file.match(pattern);
    if (match) {
      const dataName = match[1];
      const filePath = path.join(dataDir, file);
      
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter((line) => line.trim());
        
        const dataItems: any[] = [];
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            // 确保每个 item 都有 timestamp
            if (item && typeof item === "object") {
              dataItems.push(item);
            }
          } catch (e) {
            // 忽略解析失败的行
            console.warn(`解析数据行失败: ${line.substring(0, 50)}...`);
          }
        }
        
        if (dataItems.length > 0) {
          result[dataName] = dataItems;
        }
      } catch (e) {
        console.error(`读取文件失败 ${filePath}:`, e);
      }
    }
  }
  
  return result;
}

