import { APP_NAME } from "@crypto15min/constants";
import { DataRecords } from "@shared/DataRecords";

export default new DataRecords({
  appName: process.env.MARKET ? `${APP_NAME}-${process.env.MARKET}` : APP_NAME,
});
