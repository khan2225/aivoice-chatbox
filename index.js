// Entire code from user copied here for better debugging and collaboration
import Fastify from "fastify";
import WebSocket from "ws";
import fs from "fs";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import fetch from "node-fetch";
import querystring from "node:querystring";

import { PERSONAS } from "./config/variables.js";

dotenv.config();
const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) {
    console.error("Missing OpenAI API key. Please set it in the .env file.");
    process.exit(1);
}

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const PORT = process.env.PORT;
const WEBHOOK_URL = "https://hook.us2.make.com/7erbor5aii151b4crb2geajhlnozbkvd";
const sessions = new Map();

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

fastify.get("/", async (request, reply) => {
    reply.send({ message: "Twilio Media Stream Server is running!" });
});

async function fetchUserFromCallStack() {
    try {
        const response = await fetch("https://scam-scam-service-185231488037.us-central1.run.app/api/v1/app/pull-call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        const data = await response.json();
        return data.user || "1";
    } catch (err) {
        console.error("Failed to fetch user from call stack:", err);
        return "1";
    }
}

fastify.all("/incoming-call", async (request, reply) => {
    console.log("Incoming call");
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Connect>
            <Stream url="wss://${request.headers.host}/media-stream" />
        </Connect>
    </Response>`;
    reply.type("text/xml").send(twimlResponse);
});

fastify.register(async (fastify) => {
    fastify.get("/media-stream", { websocket: true }, async (connection, req) => {
        console.log("Client connected");

        const sessionId = req.headers["x-twilio-call-sid"] || `session_${Date.now()}`;
        let session = sessions.get(sessionId) || {
            transcript: "",
            streamSid: null,
            callStart: new Date().toISOString(),
        };
        sessions.set(sessionId, session);

        let selectedPersona = {
            systemMessage: PERSONAS.genZ.systemMessage,
            voice: PERSONAS.genZ.voice,
        };

        try {
            const userId = await fetchUserFromCallStack();
            const prefResponse = await fetch("https://scam-scam-service-185231488037.us-central1.run.app/api/v1/app/pull-pref", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ownedBy: userId }),
            });
        
            const prefData = await prefResponse.json();
            const { voice, prompt, personaKey } = prefData.result || {};
        
            console.log("Fetched persona data:", { userId, personaKey, voice, prompt });
        
            if (PERSONAS[personaKey]) {
                selectedPersona = PERSONAS[personaKey];
                session.personaKey = personaKey;
            } else {
                console.warn("Invalid or missing personaKey, defaulting to genZ");
                selectedPersona = PERSONAS.genZ;
                session.personaKey = "genZ";
            }
        
            session.userId = userId;
            console.log(" Final persona:", session.personaKey);
            console.log(" Using voice:", selectedPersona.voice);
            console.log(" Prompt preview:", selectedPersona.systemMessage.substring(0, 60) + "...");
        } catch (err) {
            console.warn(" Failed to fetch persona prefs. Using default.", err);
            selectedPersona = PERSONAS.genZ;
            session.personaKey = "genZ";
        }
        
 

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
                    voice: selectedPersona.voice,
                    instructions: selectedPersona.systemMessage,
                    modalities: ["text", "audio"],
                    temperature: 0.8,
                    input_audio_transcription: {
                        model: "whisper-1",
                    },
                },
            };
            console.log("Sending session update to OpenAI:", JSON.stringify(sessionUpdate, null, 2));
            openAiWs.send(JSON.stringify(sessionUpdate));
        };

        openAiWs.on("open", () => {
            console.log("Connected to the OpenAI Realtime API");
            setTimeout(sendSessionUpdate, 250);
        });

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
                    const audioBase64 = response.response.output[0]?.audio;
                    if (audioBase64 && session.streamSid && connection.socket.readyState === WebSocket.OPEN) {
                        const audioDelta = {
                            event: "media",
                            streamSid: session.streamSid,
                            media: { payload: audioBase64 },
                        };
                        connection.send(JSON.stringify(audioDelta));
                    }
                }

                if (response.type === "session.updated") {
                    console.log("Session updated successfully:", response);
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
                console.error("Error processing OpenAI message:", error, "Raw message:", data);
            }
        });

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
                        console.log("Incoming stream has started", session.streamSid);
                        break;
                    default:
                        console.log("Received non-media event:", data.event);
                        break;
                }
            } catch (error) {
                console.error("Error parsing message:", error, "Message:", message);
            }
        });

        connection.on("close", async () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            const session = sessions.get(sessionId);
            console.log(`Client disconnected (${sessionId}).`);
            if (session) {
                console.log("Full Transcript:", session.transcript);
                session.callEnd = new Date().toISOString();
                await processTranscriptAndSend(session.transcript, sessionId);
            }
            sessions.delete(sessionId);
        });

        openAiWs.on("close", () => {
            console.log("Disconnected from the OpenAI Realtime API");
        });

        openAiWs.on("error", (error) => {
            console.error("Error in the OpenAI WebSocket:", error);
        });
    });
});

fastify.post("/api/v1/app/pull-call", async (req, reply) => {
    reply.send({ user: "1" });
});

fastify.post("/api/v1/app/pull-pref", async (req, reply) => {
    const { ownedBy } = req.body;
    const userPersonaMap = {
        "1": "texanDude",
        "2": "genZ",
        "3": "shaggy",
        "4": "jackSparrow"
    };
    const personaKey = userPersonaMap[ownedBy] || "genZ";
    const persona = PERSONAS[personaKey];
    reply.send({ status: "success", result: { voice: persona.voice, prompt: persona.systemMessage.trim() } });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});

async function makeChatGPTCompletion(transcript) {
    console.log("Starting ChatGPT API call...");
    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o-2024-08-06",
                messages: [
                    { role: "system", content: "Extract scammer details: name, deal, and any special notes from the transcript." },
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
                            required: ["scammerName", "scammerDeal", "specialNotes", "fullTranscript"],
                        },
                    },
                },
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

async function sendToWebhook(payload) {
    console.log("Sending data to webhook:", JSON.stringify(payload, null, 2));
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        console.log("Webhook response status:", response.status);
        if (response.ok) {
            console.log("Data successfully sent to webhook.");
        } else {
            console.error("Failed to send data to webhook:", response.statusText);
        }
    } catch (error) {
        console.error("Error sending data to webhook:", error);
    }
}

async function processTranscriptAndSend(transcript, sessionId = null) {
    console.log(`Starting transcript processing for session ${sessionId}...`);
    try {
        const result = await makeChatGPTCompletion(transcript);
        console.log("Raw result from ChatGPT:", JSON.stringify(result, null, 2));
        const returnData = result.choices[0].message.content;
        console.log(`This is the contained data: ${returnData}`);
        if (result.choices?.[0]?.message?.content) {
            try {
                const parsedContent = JSON.parse(result.choices[0].message.content);
                const session = sessions.get(sessionId);
                const payload = {
                    ...parsedContent,
                    persona: session?.personaKey || "unknown",
                    callStart: session?.callStart || "unknown",
                    callEnd: new Date().toISOString(),
                };
                await sendToWebhook(payload);
                console.log("Extracted and sent customer details:", payload);
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
