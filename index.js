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

 async function fetchUserFromCallStack() {
    try {
        const response = await fetch("https://scam-scam-service-185231488037.us-central1.run.app/api/v1/app/pull-call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });

        const data = await response.json();
        return data.user || "1"; // fallback if needed
    } catch (err) {
        console.error("Failed to fetch user from call stack:", err);
        return "1"; // fallback for testing
    }
}

 
 // Route for Twilio to handle incoming and outgoing calls
 fastify.all("/incoming-call", async (request, reply) => {
     console.log("Incoming call");
 
     //const personaKey = queryParams.persona || "genZ";
     //const personaKey = "texanDude";
 
     const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
     <Response>
         <Connect>
             <Stream url="wss://${request.headers.host}/media-stream" />
         </Connect>
     </Response>`;
 
 
     reply.type("text/xml").send(twimlResponse);
 });
 
 // WebSocket route for media-stream
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
             
             const voice = prefData.result?.voice;
             const prompt = prefData.result?.prompt;
         
             selectedPersona = {
                 systemMessage: prompt || PERSONAS.genZ.systemMessage,
                 voice: voice || PERSONAS.genZ.voice,
             };
         
             session.userId = userId;
             session.personaKey = prompt
                 ? Object.keys(PERSONAS).find(p => PERSONAS[p].systemMessage.includes(prompt)) || "genZ"
                 : "genZ";
         
             console.log(`User ID: ${userId}, Persona: ${session.personaKey}`);
         } catch (err) {
             console.warn("Failed to fetch persona prefs. Using defaults.", err);
         }
         
         console.log("Selected Persona:", session.personaKey);
         console.log("Voice:", selectedPersona.voice);
         console.log("Prompt (preview):", selectedPersona.systemMessage.substring(0, 60) + "...");
         
     // 4. Connect to OpenAI
     const openAiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01", {
         headers: {
             Authorization: `Bearer ${OPENAI_API_KEY}`,
             "OpenAI-Beta": "realtime=v1",
         },
     });
 
     // 5. Send session update when connected
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
         setTimeout(sendSessionUpdate, 250); // slight delay for stability
     });
 
 
         // Listen for messages from the OpenAI WebSocket
         openAiWs.on("message", (data) => {
             try {
                 const response = JSON.parse(data);
 
                 if (LOG_EVENT_TYPES.includes(response.type)) {
                     console.log(`Received event: ${response.type}`, response);
                 }
 
                 // Scammer message transcription handling
                 if (
                     response.type ===
                     "conversation.item.input_audio_transcription.completed"
                 ) {
                     const userMessage = response.transcript.trim();
                     session.transcript += `Scammer: ${userMessage}\n`;
                     console.log(`Scammer (${sessionId}): ${userMessage}`);
                 }
 
                 // AI message handling
                 if (response.type === "response.done") {
                     const agentMessage =
                         response.response.output[0]?.content?.find(
                             (content) => content.transcript,
                         )?.transcript;
                         if(agentMessage){ 
                         session.transcript += `AI: ${agentMessage}\n`;
                         console.log(`AI (${sessionId}): ${agentMessage}`)};
                 }
 
                 if (response.type === "session.updated") {
                     console.log("Session updated successfully:", response);
                 }
 
                 if (
                     response.type === "response.audio.delta" &&
                     response.delta
                 ) {
                     const audioDelta = {
                         event: "media",
                         streamSid: session.streamSid,
                         media: {
                             payload: Buffer.from(
                                 response.delta,
                                 "base64",
                             ).toString("base64"),
                         },
                     };
                     connection.send(JSON.stringify(audioDelta));
                 }
             } catch (error) {
                 console.error(
                     "Error processing OpenAI message:",
                     error,
                     "Raw message:",
                     data,
                 );
             }
         });
 
         // Handle incoming messages from Twilio
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
                         console.log(
                             "Incoming stream has started",
                             session.streamSid,
                         );
                         break;
                     default:
                         console.log("Received non-media event:", data.event);
                         break;
                 }
             } catch (error) {
                 console.error(
                     "Error parsing message:",
                     error,
                     "Message:",
                     message,
                 );
             }
         });
 
         // Handle connection close and log transcript
connection.on("close", async () => {
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();

    const session = sessions.get(sessionId);
    console.log(`Client disconnected (${sessionId}).`);

    if (session) {
        console.log("Full Transcript:");
        console.log(session.transcript);

        session.callEnd = new Date().toISOString();
        console.log("Call end time:", session.callEnd);

        await processTranscriptAndSend(session.transcript, sessionId);
    } else {
        console.warn(`No session found for ${sessionId}, skipping webhook send.`);
    }

    // Clean up the session
    sessions.delete(sessionId);
});

 
         // Handle WebSocket close and errors
         openAiWs.on("close", () => {
             console.log("Disconnected from the OpenAI Realtime API");
         });
 
         openAiWs.on("error", (error) => {
             console.error("Error in the OpenAI WebSocket:", error);
         });
     });
 });



//new routes added here
fastify.post("/api/v1/app/pull-call", async (req, reply) => {
    reply.send({ user: "1" });
});

fastify.post("/api/v1/app/pull-pref", async (req, reply) => {
    const { ownedBy } = req.body;

    // Simulate a user-to-personaKey mapping (in real life, pull from DB)
    const userPersonaMap = {
        "1": "texanDude",
        "2": "genZ",
        "3": "shaggy",
        "4": "jackSparrow"
    };

    const personaKey = userPersonaMap[ownedBy] || "genZ";
    const persona = PERSONAS[personaKey];

    reply.send({
        status: "success",
        result: {
            voice: persona.voice,
            prompt: persona.systemMessage.trim()
        }
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
                         callStart: session?.callStart || "unknown",
                         callEnd: new Date().toISOString(),
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