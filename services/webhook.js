import fetch from "node-fetch";
import { WEBHOOK_URL } from "../config/variables.js";
import dotenv from "dotenv";
dotenv.config();

// Function to send data to Make.com webhook
export async function sendToWebhook(payload){
        console.log("Sending data to webhook:", JSON.stringify(payload, null, 2));
        try {
            const response = await fetch(WEBHOOK_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
    
            console.log("Webhook response status:", response.status);
            if (response.ok) {
                console.log("Data successfully sent to webhook.");
            } else {
                console.error(
                    "Failed to send data to webhook:",
                    response.statusText,
                );
            }
        } catch (error) {
            console.error("Error sending data to webhook:", error);
        }
}