import { ScheduledTrigger } from "../dist/core/scheduled-trigger.js";
const t = new ScheduledTrigger();
const r = await t.start();
console.log("SCHEDULED_RESULT:" + r);
