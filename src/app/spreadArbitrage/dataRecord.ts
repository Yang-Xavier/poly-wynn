import { DataRecords } from "@shared/DataRecords";

export default new DataRecords({
  appName: "spreadArbitrage",
  bufferSize: 50,
  flushInterval: 1000,
});
