#!/usr/bin/env node
/* eslint-disable no-console */
const { checkSchedulerEnv, formatSchedulerEnvReport } = require("../src/utils/schedulerEnvCheck");

const result = checkSchedulerEnv(process.env);
const report = formatSchedulerEnvReport(result);
for (const line of report.lines) console.log(line);
process.exit(result.errors.length ? 1 : 0);
