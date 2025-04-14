import fetch from "node-fetch";
import { sendToWebhook } from "./webhook";
import { MODEL_NAME, RESPONSE_SCHEMA } from "../config/variables.js";
import { sessions, setCallEnd, formatTranscript } from "../utils/sessions.js";

// Function to make ChatGPT API completion call with structured outputs
export async function makeChatGPTCompletion(transcript) {
    console.log("Starting ChatGPT API call...");

    try {
        const response = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
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
                            content: "Extract scammer details: name, deal, and any special notes from the transcript.",
                        },
                        { role: "user", content: transcript },
                    ],
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: "scammer_details_extraction",
                            schema: RESPONSE_SCHEMA,
                        },
                    },
                }),
            },
        );

        console.log("ChatGPT API response status:", response.status);
        const data = await response.json();
        console.log("Full ChatGPT API response:", JSON.stringify(data, null, 2));
        return data;
    } catch (error) {
        console.error("Error making ChatGPT completion call:", error);
        throw error;
    }
}

// Main function to extract and send customer details
export async function processTranscriptAndSend(transcript, sessionId = null) {
    console.log(`Starting transcript processing for session ${sessionId}...`);
    try {
        const result = await makeChatGPTCompletion(transcript);

        const returnData = result.choices?.[0]?.message?.content;

        if (!returnData) {
            console.error("Unexpected response structure from ChatGPT API");
            return;
        }

        const scamDetails = JSON.parse(returnData);
        console.log("Parsed scammer details:", scamDetails);

        const session = sessions.get(sessionId);
        setCallEnd(sessionId);
        const formattedTranscript = formatTranscript(session.transcript);

        const finalPayload = {
            ...scamDetails,
            fullTranscript: formattedTranscript,
            personaKey: session.persona,
            callStart: session.callStart,
            callEnd: session.callEnd,
            deletedAt: session.deletedAt,
            user: session.user || "test-user"
        };

        await sendToWebhook(finalPayload);
        console.log("Final data sent to webhook:", finalPayload);
    } catch (error) {
        console.error("Error in processTranscriptAndSend:", error);
    }
}
