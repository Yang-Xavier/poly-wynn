import { DataRecords } from "@shared/DataRecords";

export default new DataRecords({
  appName: process.env.MARKET ? `crypto15min-${process.env.MARKET}` : "crypto15min",
});
