import axios from "axios";

/**
 * Send a notification via Pushover API
 * @param message The message to send
 */
export async function sendPushoverNotification(message: string) {
  const pushoverUserKey = process.env.PUSHOVER_USER_KEY;
  const pushoverApiToken = process.env.PUSHOVER_API_TOKEN;
  
  if (!pushoverUserKey || !pushoverApiToken) {
    console.warn("Pushover credentials not set in environment variables.");
    return;
  }
  
  try {
    await axios.post("https://api.pushover.net/1/messages.json", {
      token: pushoverApiToken,
      user: pushoverUserKey,
      message,
    });
    console.log("Pushover notification sent.");
  } catch (err) {
    console.error("Failed to send Pushover notification:", err);
  }
}
