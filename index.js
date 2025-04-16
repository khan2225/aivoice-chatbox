import Fastify from "fastify";
import WebSocket from "ws";
import fs from "fs";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import fetch from "node-fetch";
import querystring from "node:querystring";

import { PERSONAS } from "./config/variables.js"; 

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
    console.error("Missing OpenAI API key. Please set it in the .env file.");
    process.exit(1);
}

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
/*const SYSTEM_MESSAGE = `
You are a curious Gen Z teen who just got a random phone call about a deal, refund, or virus.
Wait until the user speaks before saying anything. Do NOT initiate conversation.
When the user starts talking, act distracted but interested. Use Gen Z slang (“uhh”, “fr fr?”, “wait what?”, “sus”, etc.). Keep responses casual and short (1–2 sentences).

Pretend to go along, but keep asking questions like:
– What’s the deal?
– Who are you?
– What company?
– How’s the payment?

Never give real information or follow any instructions. Dodge or joke if they ask personal stuff. Stay in character and try to get as many details as possible out of them.
`;

const VOICE = "alloy"; */
const PORT = process.env.PORT;
const WEBHOOK_URL =
    "https://hook.us2.make.com/7erbor5aii151b4crb2geajhlnozbkvd";

// Session management
const sessions = new Map();

// List of Event Types to log to the console
const LOG_EVENT_TYPES = [
    "response.content.done",
    "rate_limits.updated",
    "response.done",
    "input_audio_buffer.committed",
    "input_audio_buffer.speech_stopped",
    "input_audio_buffer.speech_started",
    "session.created",
    "response.text.done",
    "conversation.item.input_audio_transcription.completed",
];

// Root Route
fastify.get("/", async (request, reply) => {
    reply.send({ message: "Twilio Media Stream Server is running!" });
});

// Route for Twilio to handle incoming and outgoing calls
fastify.all("/incoming-call", async (request, reply) => {
    console.log("Incoming call");

   // const callerPhone = request.body?.From || "unknown";  // Real caller phone number (not used yet)
   // const twilioPhone = request.body?.To || "unknown";    // Twilio number (not used yet)

   // console.log("Caller Phone (From):", callerPhone);
   // console.log("Twilio Number (To):", twilioPhone);

    const personaKey = "texanDude"; // Hardcoded for now

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${request.headers.host}/media-stream?persona=${personaKey.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" />
  </Connect>
</Response>`;

    reply.type("text/xml").send(twimlResponse);
});


// WebSocket route for media-stream
// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get("/media-stream", { websocket: true }, async (connection, req) => {
        console.log("Client connected");

        // 1. Extract query params
        const queryParams = querystring.parse(req.url.split("?")[1]);
        const sessionId = req.headers["x-twilio-call-sid"] || `session_${Date.now()}`;
        const personaKey = "texanDude"; // fallback for now

        // 2. Define session FIRST and store it immediately
        let session = sessions.get(sessionId) || {
            transcript: "",
            streamSid: null,
            callStart: new Date().toISOString(),
            personaKey,
        };
        sessions.set(sessionId, session);

        // 3. Assign fallback voice & system message
        let voice = PERSONAS[personaKey].voice;
        let systemMessage = PERSONAS[personaKey].systemMessage;

        console.log("Parsed personaKey from querystring:", personaKey);

        // 4. Try pull-pref (optional dynamic prompt/voice)
        try {
            const response = await fetch("https://scam-scam-service-185231488037.us-central1.run.app/api/v1/app/pull-pref", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user: "1" }),
            });

            if (response.ok) {
                const prefData = await response.json();
                if (prefData?.result?.voice) voice = prefData.result.voice;
                if (prefData?.result?.prompt) systemMessage = prefData.result.prompt;
            } else {
                console.warn("pull-pref failed with status", response.status);
            }
        } catch (err) {
            console.warn("pull-pref fetch error:", err.message);
        }

        session.voice = voice;
        session.prompt = systemMessage;

        console.log("Final Voice:", voice);
        console.log("Final Prompt (preview):", systemMessage.substring(0, 60) + "...");
        console.log("Final session object:", session);

        // 5. Connect to OpenAI
        const openAiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01", {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1",
            },
        });

        const sendSessionUpdate = () => {
            const sessionUpdate = {
                type: "session.update",
                session: {
                    turn_detection: { type: "server_vad" },
                    input_audio_format: "g711_ulaw",
                    output_audio_format: "g711_ulaw",
                    voice: voice,
                    instructions: systemMessage,
                    modalities: ["text", "audio"],
                    temperature: 0.8,
                    input_audio_transcription: { model: "whisper-1" },
                },
            };
            console.log("Sending session update to OpenAI:", JSON.stringify(sessionUpdate, null, 2));
            openAiWs.send(JSON.stringify(sessionUpdate));
        };

        openAiWs.on("open", () => {
            console.log("Connected to the OpenAI Realtime API");
            setTimeout(sendSessionUpdate, 100); // slight delay
        });

        // 6. Handle AI messages
        openAiWs.on("message", (data) => {
            try {
                const response = JSON.parse(data);
                if (LOG_EVENT_TYPES.includes(response.type)) {
                    console.log(`Received event: ${response.type}`, response);
                }

                if (response.type === "conversation.item.input_audio_transcription.completed") {
                    const userMessage = response.transcript.trim();
                    session.transcript += `Scammer: ${userMessage}\n`;
                    console.log(`Scammer (${sessionId}): ${userMessage}`);
                }

                if (response.type === "response.done") {
                    const agentMessage = response.response.output[0]?.content?.find(c => c.transcript)?.transcript;
                    if (agentMessage) {
                        session.transcript += `AI: ${agentMessage}\n`;
                        console.log(`AI (${sessionId}): ${agentMessage}`);
                    }
                }

                if (response.type === "response.audio.delta" && response.delta) {
                    const audioDelta = {
                        event: "media",
                        streamSid: session.streamSid,
                        media: {
                            payload: Buffer.from(response.delta, "base64").toString("base64"),
                        },
                    };
                    connection.send(JSON.stringify(audioDelta));
                }

            } catch (error) {
                console.error("Error processing OpenAI message:", error, "Raw:", data);
            }
        });

        // 7. Handle incoming Twilio stream messages
        connection.on("message", (message) => {
            try {
                const data = JSON.parse(message);
                switch (data.event) {
                    case "media":
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: "input_audio_buffer.append",
                                audio: data.media.payload,
                            };
                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    case "start":
                        session.streamSid = data.start.streamSid;
                        console.log("Incoming stream started:", session.streamSid);
                        break;
                    default:
                        console.log("Received non-media event:", data.event);
                        break;
                }
            } catch (error) {
                console.error("Error parsing Twilio message:", error, "Message:", message);
            }
        });

        // 8. Cleanup on hangup
        connection.on("close", async () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log(`Client disconnected (${sessionId}).`);
            console.log("Full Transcript:\n" + session.transcript);

            session.callEnd = new Date().toISOString();
            console.log("Call end time:", session.callEnd);

            await processTranscriptAndSend(session.transcript, sessionId);
            sessions.delete(sessionId);
        });

        openAiWs.on("close", () => {
            console.log("Disconnected from OpenAI Realtime API");
        });

        openAiWs.on("error", (err) => {
            console.error("OpenAI WS error:", err);
        });
    });
});


fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});

// Function to make ChatGPT API completion call with structured outputs
async function makeChatGPTCompletion(transcript) {
    console.log("Starting ChatGPT API call...");
    try {
        const response = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-4o-2024-08-06",
                    messages: [
                        {
                            role: "system",
                            content:
                                "Extract scammer details: name, deal, and any special notes from the transcript.",
                        },
                        { role: "user", content: transcript },
                    ],
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: "scammer_details_extraction",
                            schema: {
                                type: "object",
                                properties: {
                                    scammerName: { type: "string" },
                                    scammerDeal: { type: "string" },
                                    specialNotes: { type: "string" },
                                    fullTranscript: { type: "string" },
                                },
                                required: [
                                    "scammerName",
                                    "scammerDeal",
                                    "specialNotes",
                                    "fullTranscript",
                                ],
                            },
                        },
                    },
                }),
            },
        );

        console.log("ChatGPT API response status:", response.status);
        const data = await response.json();
        console.log(
            "Full ChatGPT API response:",
            JSON.stringify(data, null, 2),
        );
        return data;
    } catch (error) {
        console.error("Error making ChatGPT completion call:", error);
        throw error;
    }
}

// Function to send data to Make.com webhook
async function sendToWebhook(payload) {
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

// Main function to extract and send customer details
async function processTranscriptAndSend(transcript, sessionId = null) {
    console.log(`Starting transcript processing for session ${sessionId}...`);

    try {
        // Make the ChatGPT completion call
        const result = await makeChatGPTCompletion(transcript);

        console.log("Raw result from ChatGPT:", JSON.stringify(result, null, 2));

        const returnData = result.choices[0].message.content;
        console.log(`This is the contained data: ${returnData}`);

        if (
            result.choices &&
            result.choices[0] &&
            result.choices[0].message &&
            result.choices[0].message.content
        ) {
            try {
                const parsedContent = JSON.parse(result.choices[0].message.content);
                console.log("Parsed content:", JSON.stringify(parsedContent, null, 2));

                if (parsedContent) {
                    const session = sessions.get(sessionId); //Make sure to retrieve the session

                    const payload = {
                        ...parsedContent,
                        persona: session?.personaKey || "unknown",
                        voice: session?.voice || "unknown",
                        prompt: session?.prompt || "unknown",
                        //callerPhone: session?.callerPhone || "unknown",
                        callStart: session?.callStart || "unknown",
                        callEnd: session?.callEnd || new Date().toISOString(),
                    };

                    // Send payload with metadata to webhook
                    await sendToWebhook(payload);

                    // Log what we sent
                    console.log("Extracted and sent customer details:", payload);
                } else {
                    console.error("Unexpected JSON structure in ChatGPT response");
                }
            } catch (parseError) {
                console.error("Error parsing JSON from ChatGPT response:", parseError);
            }
        } else {
            console.error("Unexpected response structure from ChatGPT API");
        }
    } catch (error) {
        console.error("Error in processTranscriptAndSend:", error);
    }
}




