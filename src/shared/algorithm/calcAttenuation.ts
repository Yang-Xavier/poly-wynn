/**
 * 计算衰减因子：随着 y 坐标的减小，x 坐标要减小得越来越快
 * - 使用「线性 + 幂函数」混合，让开头有一定斜率、越到结尾越陡
 * @param range - 二维数组，range[0] 是 x 轴范围 [x1, x2]，range[1] 是 y 轴范围 [y1, y2]（不要求前小后大）
 * @param y - 输入的 y 坐标值
 * @param power - 幂指数，默认 3；数值越大，越靠近 y 最小值时 x 衰减越快
 * @param mix - 线性与幂函数的混合比例，默认 0.3；越大，前半段越接近线性、下降不至于太慢
 * @returns 计算出的 x 坐标值
 */
export const calcAttenuation = (
  range: number[][],
  y: number,
  power: number = 2,
  mix: number = 0.8
) => {
  const [xRange, yRange] = range;
  const [x1, x2] = xRange;
  const [y1, y2] = yRange;

  // 允许传入 [max, min] 或 [min, max]，这里统一转成 [min, max]
  const xMin = Math.min(x1, x2);
  const xMax = Math.max(x1, x2);
  const yMin = Math.min(y1, y2);
  const yMax = Math.max(y1, y2);

  if (yMax === yMin) {
    return xMin;
  }

  // 将 y 归一化到 [0, 1]，y = yMin -> 0，y = yMax -> 1
  let yNormalized = (y - yMin) / (yMax - yMin);
  // 防止越界
  yNormalized = Math.max(0, Math.min(1, yNormalized));

  // 设计成：y 从大到小（1 -> 0），x 从大到小且越到后面减得越快
  // 使用线性与幂函数的混合：
  //   baseLinear = yNormalized                    （整体平滑）
  //   basePower  = 1 - (1 - yNormalized)^power   （结尾更陡）
  //   xNormalized = mix * baseLinear + (1 - mix) * basePower
  // 这样：
  // - 保证开头不会太平（有线性部分支撑斜率）
  // - 越靠近 yMin，幂函数贡献越大，下降更快
  const baseLinear = yNormalized;
  const basePower = 1 - Math.pow(1 - yNormalized, power);
  const xNormalized = mix * baseLinear + (1 - mix) * basePower;

  // 将归一化的 x 映射回实际范围
  const x = xMin + (xMax - xMin) * xNormalized;

  return x;
};
