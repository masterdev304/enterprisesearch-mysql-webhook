const cron = require("node-cron");
const lastProcessedIdListener = require("./lastProcessedIdListener").lastProcessedIdListener;

// Schedule the cron job to run every 5 minutes
cron.schedule("*/5 * * * *", async () => {
    try {
        console.log("Executing MySQL last processed ID listener job...");
        await lastProcessedIdListener();
        console.log("MySQL last processed ID listener job executed successfully.");
    } catch (error) {
        console.error("Error executing MySQL last processed ID listener job:", error.message);
    }
});

console.log("MySQL Last Processed ID Listener is running...");
