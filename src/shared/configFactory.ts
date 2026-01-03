export const configFactory = <T>(config: T) => {
  return (path?: string) => {
    // INSERT_YOUR_CODE
    if (!path) {
      return config;
    }
    // 支持通过 'a.b.c' 形式访问配置属性
    const keys = path.split(".");
    let result: any = config;
    for (const key of keys) {
      if (result && typeof result === "object" && key in result) {
        result = result[key];
      } else {
        return undefined;
      }
    }
    return result;
  };
};
