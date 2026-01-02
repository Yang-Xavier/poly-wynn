/**
 * 图片优化对象类型
 */
interface TImageOptimized {
  id: string;
  imageUrlSource: string;
  imageUrlOptimized: string;
  imageSizeKbSource: number;
  imageSizeKbOptimized: number;
  imageOptimizedComplete: boolean;
  imageOptimizedLastUpdated: string;
  relID: number;
  field: string;
  relname: string;
}

/**
 * 标签类型
 */
interface TTag {
  id: string;
  label: string;
  slug: string;
  forceShow: boolean;
  publishedAt: string;
  createdBy: number;
  updatedBy: number;
  createdAt: string;
  updatedAt: string;
  forceHide: boolean;
  isCarousel: boolean;
}

/**
 * 事件类型
 */
interface TEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  resolutionSource: string;
  startDate: string;
  creationDate: string;
  endDate: string;
  image: string;
  icon: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  new: boolean;
  featured: boolean;
  restricted: boolean;
  liquidity: number;
  volume: number;
  openInterest: number;
  sortBy: string;
  category: string;
  subcategory: string;
  isTemplate: boolean;
  templateVariables: string;
  published_at: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  commentsEnabled: boolean;
  competitive: number;
  volume24hr: number;
  volume1wk: number;
  volume1mo: number;
  volume1yr: number;
  featuredImage: string;
  disqusThread: string;
  parentEvent: string;
  enableOrderBook: boolean;
  liquidityAmm: number;
  liquidityClob: number;
  negRisk: boolean;
  negRiskMarketID: string;
  negRiskFeeBips: number;
  commentCount: number;
}

/**
 * Market 响应数据类型
 * 对应 Polymarket API: GET /markets/slug/{slug}
 * 文档: https://docs.polymarket.com/api-reference/markets/get-market-by-slug
 */
export interface TMarketResponseData {
  id: string;
  question: string | null;
  conditionId: string;
  slug: string | null;
  twitterCardImage: string | null;
  resolutionSource: string | null;
  endDate: string | null;
  category: string | null;
  ammType: string | null;
  liquidity: string | null;
  sponsorName: string | null;
  sponsorImage: string | null;
  startDate: string | null;
  xAxisValue: string | null;
  yAxisValue: string | null;
  denominationToken: string | null;
  fee: string | null;
  image: string | null;
  icon: string | null;
  lowerBound: string | null;
  upperBound: string | null;
  description: string | null;
  outcomes: string | null;
  outcomePrices: string | null;
  volume: string | null;
  active: boolean | null;
  marketType: string | null;
  formatType: string | null;
  lowerBoundDate: string | null;
  upperBoundDate: string | null;
  closed: boolean | null;
  marketMakerAddress: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedTime: string | null;
  wideFormat: boolean | null;
  new: boolean | null;
  mailchimpTag: string | null;
  featured: boolean | null;
  archived: boolean | null;
  resolvedBy: string | null;
  restricted: boolean | null;
  marketGroup: number | null;
  groupItemTitle: string | null;
  groupItemThreshold: string | null;
  questionID: string | null;
  umaEndDate: string | null;
  enableOrderBook: boolean | null;
  orderPriceMinTickSize: number | null;
  orderMinSize: number | null;
  umaResolutionStatus: string | null;
  curationOrder: number | null;
  volumeNum: number | null;
  liquidityNum: number | null;
  endDateIso: string | null;
  startDateIso: string | null;
  umaEndDateIso: string | null;
  hasReviewedDates: boolean | null;
  readyForCron: boolean | null;
  commentsEnabled: boolean | null;
  volume24hr: number | null;
  volume1wk: number | null;
  volume1mo: number | null;
  volume1yr: number | null;
  gameStartTime: string | null;
  secondsDelay: number | null;
  clobTokenIds: string | null;
  disqusThread: string | null;
  shortOutcomes: string | null;
  teamAID: string | null;
  teamBID: string | null;
  umaBond: string | null;
  umaReward: string | null;
  fpmmLive: boolean | null;
  volume24hrAmm: number | null;
  volume1wkAmm: number | null;
  volume1moAmm: number | null;
  volume1yrAmm: number | null;
  volume24hrClob: number | null;
  volume1wkClob: number | null;
  volume1moClob: number | null;
  volume1yrClob: number | null;
  volumeAmm: number | null;
  volumeClob: number | null;
  liquidityAmm: number | null;
  liquidityClob: number | null;
  makerBaseFee: number | null;
  takerBaseFee: number | null;
  customLiveness: number | null;
  acceptingOrders: boolean | null;
  notificationsEnabled: boolean | null;
  score: number | null;
  imageOptimized: TImageOptimized | null;
  iconOptimized: TImageOptimized | null;
  events: TEvent[];
  tags: TTag[];
  creator: string | null;
  ready: boolean | null;
  funded: boolean | null;
  pastSlugs: string | null;
  readyTimestamp: string | null;
  fundedTimestamp: string | null;
  acceptingOrdersTimestamp: string | null;
  competitive: number | null;
  rewardsMinSize: number | null;
  rewardsMaxSpread: number | null;
  spread: number | null;
  automaticallyResolved: boolean | null;
  oneDayPriceChange: number | null;
  oneHourPriceChange: number | null;
  oneWeekPriceChange: number | null;
  oneMonthPriceChange: number | null;
  oneYearPriceChange: number | null;
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  automaticallyActive: boolean | null;
  clearBookOnStart: boolean | null;
  chartColor: string | null;
  seriesColor: string | null;
  showGmpSeries: boolean | null;
  showGmpOutcome: boolean | null;
  manualActivation: boolean | null;
  negRiskOther: boolean | null;
  gameId: string | null;
  groupItemRange: string | null;
  sportsMarketType: string | null;
  line: number | null;
  umaResolutionStatuses: string | null;
  pendingDeployment: boolean | null;
  deploying: boolean | null;
  deployingTimestamp: string | null;
  scheduledDeploymentTimestamp: string | null;
  rfqEnabled: boolean | null;
  eventStartTime: string | null;
}
