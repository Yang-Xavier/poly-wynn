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
 * Event 中的 Market 类型
 * 用于 Event 响应数据中的 markets 数组
 */
export interface TEventMarket {
  id: string;
  question: string | null;
  conditionId: string;
  slug: string | null;
  resolutionSource: string | null;
  endDate: string | null;
  liquidity: string | null;
  startDate: string | null;
  image: string | null;
  icon: string | null;
  description: string | null;
  outcomes: string | null;
  outcomePrices: string | null;
  volume: string | null;
  active: boolean | null;
  closed: boolean | null;
  marketMakerAddress: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  new: boolean | null;
  featured: boolean | null;
  submitted_by: string | null;
  archived: boolean | null;
  resolvedBy: string | null;
  restricted: boolean | null;
  groupItemTitle: string | null;
  groupItemThreshold: string | null;
  questionID: string | null;
  enableOrderBook: boolean | null;
  orderPriceMinTickSize: number | null;
  orderMinSize: number | null;
  volumeNum: number | null;
  liquidityNum: number | null;
  endDateIso: string | null;
  startDateIso: string | null;
  hasReviewedDates: boolean | null;
  volume24hr: number | null;
  volume1wk: number | null;
  volume1mo: number | null;
  volume1yr: number | null;
  gameStartTime: string | null;
  secondsDelay: number | null;
  clobTokenIds: string | null;
  umaBond: string | null;
  umaReward: string | null;
  volume24hrClob: number | null;
  volume1wkClob: number | null;
  volume1moClob: number | null;
  volume1yrClob: number | null;
  volumeClob: number | null;
  liquidityClob: number | null;
  customLiveness: number | null;
  acceptingOrders: boolean | null;
  negRisk: boolean | null;
  negRiskRequestID: string | null;
  ready: boolean | null;
  funded: boolean | null;
  acceptingOrdersTimestamp: string | null;
  cyom: boolean | null;
  competitive: number | null;
  pagerDutyNotificationEnabled: boolean | null;
  approved: boolean | null;
  rewardsMinSize: number | null;
  rewardsMaxSpread: number | null;
  spread: number | null;
  oneDayPriceChange: number | null;
  oneHourPriceChange: number | null;
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  automaticallyActive: boolean | null;
  clearBookOnStart: boolean | null;
  manualActivation: boolean | null;
  negRiskOther: boolean | null;
  sportsMarketType: string | null;
  line: number | null;
  umaResolutionStatuses: string | null;
  pendingDeployment: boolean | null;
  deploying: boolean | null;
  deployingTimestamp: string | null;
  rfqEnabled: boolean | null;
  holdingRewardsEnabled: boolean | null;
  feesEnabled: boolean | null;
  requiresTranslation: boolean | null;
}

/**
 * Event 中的 Series 类型
 * 用于 Event 响应数据中的 series 数组
 */
export interface TEventSeries {
  id: string;
  ticker: string | null;
  slug: string | null;
  title: string | null;
  seriesType: string | null;
  recurrence: string | null;
  image: string | null;
  icon: string | null;
  active: boolean | null;
  closed: boolean | null;
  archived: boolean | null;
  featured: boolean | null;
  restricted: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
  volume: number | null;
  liquidity: number | null;
  commentCount: number | null;
  requiresTranslation: boolean | null;
}

/**
 * Event 响应数据类型
 * 对应 Polymarket API: GET /events/slug/{slug}
 * 文档: https://docs.polymarket.com/api-reference/events/get-event-by-slug
 */
export interface TEventResponseData {
  id: string;
  ticker: string | null;
  slug: string | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  resolutionSource: string | null;
  startDate: string | null;
  creationDate: string | null;
  endDate: string | null;
  image: string | null;
  icon: string | null;
  active: boolean | null;
  closed: boolean | null;
  archived: boolean | null;
  new: boolean | null;
  featured: boolean | null;
  restricted: boolean | null;
  liquidity: number | null;
  volume: number | null;
  openInterest: number | null;
  sortBy: string | null;
  category: string | null;
  subcategory: string | null;
  isTemplate: boolean | null;
  templateVariables: string | null;
  published_at: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  commentsEnabled: boolean | null;
  competitive: number | null;
  volume24hr: number | null;
  volume1wk: number | null;
  volume1mo: number | null;
  volume1yr: number | null;
  featuredImage: string | null;
  disqusThread: string | null;
  parentEvent: string | null;
  enableOrderBook: boolean | null;
  liquidityAmm: number | null;
  liquidityClob: number | null;
  negRisk: boolean | null;
  negRiskMarketID: string | null;
  negRiskFeeBips: number | null;
  commentCount: number | null;
  imageOptimized: TImageOptimized | null;
  iconOptimized: TImageOptimized | null;
  featuredImageOptimized: TImageOptimized | null;
  subEvents: string[] | null;
  markets: TEventMarket[] | null;
  series: TEventSeries[] | null;
  categories: any[] | null;
  collections: any[] | null;
  tags: TTag[] | null;
  cyom: boolean | null;
  closedTime: string | null;
  showAllOutcomes: boolean | null;
  showMarketImages: boolean | null;
  automaticallyResolved: boolean | null;
  enableNegRisk: boolean | null;
  automaticallyActive: boolean | null;
  eventDate: string | null;
  startTime: string | null;
  eventWeek: number | null;
  seriesSlug: string | null;
  score: string | null;
  elapsed: string | null;
  period: string | null;
  live: boolean | null;
  ended: boolean | null;
  finishedTimestamp: string | null;
  gmpChartMode: string | null;
  eventCreators: any[] | null;
  tweetCount: number | null;
  chats: any[] | null;
  featuredOrder: number | null;
  estimateValue: boolean | null;
  cantEstimate: boolean | null;
  estimatedValue: string | null;
  templates: any[] | null;
  spreadsMainLine: number | null;
  totalsMainLine: number | null;
  carouselMap: string | null;
  pendingDeployment: boolean | null;
  deploying: boolean | null;
  deployingTimestamp: string | null;
  scheduledDeploymentTimestamp: string | null;
  gameStatus: string | null;
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
