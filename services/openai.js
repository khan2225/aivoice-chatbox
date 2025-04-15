import fetch from "node-fetch";
import { sendToWebhook } from "./webhook.js";
import { MODEL_NAME, RESPONSE_SCHEMA } from "../config/variables.js";
import { sessions, setCallEnd, formatTranscript } from "../utils/sessions.js";
import dotenv from "dotenv";
dotenv.config();

// Function to call ChatGPT API with transcript and request scammer detail extraction
export async function makeChatGPTCompletion(transcript) {
    console.log("Starting ChatGPT API call...");

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    {
                        role: "system",
                        content:
                            `Extract the following fields from the transcript:\n` +
                            `1. scammerName (string)\n` +
                            `2. scammerDeal (string)\n` +
                            `3. specialNotes (string).\n` +
                            `Return the result as a JSON object matching this schema:\n${JSON.stringify(RESPONSE_SCHEMA)}`,
                    },
                    { role: "scammer", content: transcript },
                ],
                temperature: 0.3,
            }),
        });

        console.log("ChatGPT API response status:", response.status);
        const data = await response.json();
        console.log("Full ChatGPT API response:", JSON.stringify(data, null, 2));
        return data;
    } catch (error) {
        console.error("Error making ChatGPT completion call:", error);
        throw error;
    }
}

// Main handler to process transcript, extract scammer info, and send to webhook
export async function processTranscriptAndSend(transcript, sessionId = null) {
    console.log(`Starting transcript processing for session ${sessionId}...`);

    try {
        const result = await makeChatGPTCompletion(transcript);
        const rawContent = result.choices?.[0]?.message?.content;

        if (!rawContent) {
            console.error("Missing message content in ChatGPT response");
            return;
        }

        let scamDetails;
        try {
            scamDetails = JSON.parse(rawContent);
        } catch (err) {
            console.error("Failed to parse scammer details from JSON:", err);
            return;
        }

        console.log("Parsed scammer details:", scamDetails);

        const session = sessionId ? sessions.get(sessionId) : null;
        if (!session) {
            console.warn(`No session found for sessionId: ${sessionId}`);
            return;
        }

        setCallEnd(sessionId);
        const formattedTranscript = formatTranscript(session.transcript);

        const finalPayload = {
            sessionId,
            user: session.user || "test-user",
            personaKey: session.persona,
            callStart: session.callStart,
            callEnd: session.callEnd,
            deletedAt: session.deletedAt || null,
            fullTranscript: formattedTranscript,
            ...scamDetails,
        };

        await sendToWebhook(finalPayload);
        console.log("Final data sent to webhook:", finalPayload);
    } catch (error) {
        console.error("Error in processTranscriptAndSend:", error);
    }
}
