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

fastify.get("/test", { websocket: true }, (connection) => {
  console.log("WebSocket /test connected");
  connection.socket.on("message", (msg) => {
    console.log("Message from client:", msg.toString());
    connection.socket.send("Hello from /test WebSocket server!");
  });
});

const PORT = process.env.PORT || 8080;
const WEBHOOK_URL =
  "https://hook.us2.make.com/7erbor5aii151b4crb2geajhlnozbkvd";
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
    const response = await fetch(
      "https://scam-scam-service-185231488037.us-central1.run.app/api/v1/app/pull-call",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const data = await response.json();
    return data.user || "1";
  } catch (err) {
    console.error("Failed to fetch user from call stack:", err);
    return "1";
  }
}

async function fetchUserPreferences(userId) {
  try {
    const response = await fetch(
      "https://scam-scam-service-185231488037.us-central1.run.app/api/v1/app/pull-pref",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownedBy: userId }),
      },
    );

    const data = await response.json();
    return data.result || {};
  } catch (err) {
    console.error("Failed to fetch user preferences:", err);
    return {};
  }
}

/*fastify.all("/incoming-call", async (request, reply) => {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Connect>
            <Stream url="wss://${request.headers.host}/media-stream" />
        </Connect>
    </Response>`;

  reply.type("text/xml").send(twimlResponse);
});*/


fastify.all("/incoming-call", async (request, reply) => {
  const host = request.headers.host; // Get current domain
  const callSid = request.body?.CallSid;
  if (callSid) {
    const userPhone = request.body?.From || "unknown";
    let session = sessions.get(callSid) || {
      transcript: "",
      streamSid: null,
      callStart: new Date().toISOString(),
    };
    session.phoneNumber = userPhone;
    sessions.set(callSid, session);
    console.log("Stored phone number:", userPhone);
  }

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="wss://${host}/media-stream">
          <Parameter name="codec" value="PCMU"/>
        </Stream>
      </Connect>
    </Response>`;
  reply.type("text/xml").send(twimlResponse);
  console.log("Twilio WebSocket connected to /incoming-call");
});




fastify.register(async (fastify) => {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log("Client connected");
    console.log("Twilio WebSocket connected to /media-stream");

    const sessionId =
      req.headers["x-twilio-call-sid"] || `session_${Date.now()}`;
    let session = sessions.get(sessionId);

    if (!session) {
      session = {
        transcript: "",
        streamSid: null,
        callStart: new Date().toISOString(),
      };
      sessions.set(sessionId, session);
    }

    console.log("Pulled session.phoneNumber:", session.phoneNumber);


    // Immediately listen for Twilio events
    connection.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);
        switch (data.event) {
          case "start":
            session.streamSid = data.start.streamSid;
            console.log("Incoming stream has started:", session.streamSid);
            break;

          case "media":
            if (session.openAiWs?.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: "input_audio_buffer.append",
                audio: data.media.payload,
              };
              session.openAiWs.send(JSON.stringify(audioAppend));
            }
            break;

          default:
            console.log("Received non-media event:", data.event);
            break;
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    });

    // Determine which persona to use, then setup OpenAI
    fetchUserFromCallStack().then(async (userId) => {
      const prefs = await fetchUserPreferences(userId);
      const personaKey = prefs.prompt || "genZ";
      const selectedPersona = PERSONAS[personaKey] || PERSONAS.genZ;

      console.log("Fetched prompt:", prefs.prompt);
      console.log("Resolved persona:", personaKey);

      session.userId = userId;
      session.personaKey = personaKey;
      session.voice = selectedPersona.voice;

      const userPhone = req.query?.From || "unknown"; //phonenumber
      session.phoneNumber = userPhone;  

      console.log(`User ID: ${userId}, Persona: ${personaKey}, Phone: ${userPhone}`);
      setupOpenAI(connection, sessionId, session, selectedPersona);
    });

    /* Temporarily force a persona for testing without calling backend
    const personaKey = "texanDude";
     //"genZ"; "shaggy", "texanDude"
    const selectedPersona = PERSONAS[personaKey];

    session.userId = "manual-test";
    session.personaKey = personaKey;
    session.voice = selectedPersona.voice;

    console.log(`Forced Persona: ${personaKey}`);
    setupOpenAI(connection, sessionId, session, selectedPersona); */
  });
});

function setupOpenAI(connection, sessionId, session, selectedPersona) {
  const openAiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    },
  );

  session.openAiWs = openAiWs;

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
        input_audio_transcription: { model: "whisper-1" },
      },
    };
    console.log("Sending session update:", JSON.stringify(sessionUpdate));
    openAiWs.send(JSON.stringify(sessionUpdate));
  };

  openAiWs.on("open", () => {
    console.log("OpenAI WebSocket open!");
    setTimeout(() => {
      console.log("Sending session update...");
      sendSessionUpdate();
    }, 250);
  });

  openAiWs.on("message", (data) => {
    try {
      const response = JSON.parse(data);
      if (LOG_EVENT_TYPES.includes(response.type)) console.log(response);

      if (
        response.type ===
        "conversation.item.input_audio_transcription.completed"
      ) {
        const userMessage = response.transcript.trim();
        session.transcript += `Scammer: ${userMessage}\n`;
      }

      if (response.type === "response.done") {
        const agentMessage = response.response.output[0]?.content?.find(
          (c) => c.transcript,
        )?.transcript;
        if (agentMessage) session.transcript += `AI: ${agentMessage}\n`;
      }

      if (response.type === "response.audio.delta" && response.delta) {
        if (!session.streamSid) {
          console.warn(
            "\u26a0\ufe0f streamSid missing — cannot send audio back",
          );
          return;
        }
        const audioDelta = {
          event: "media",
          streamSid: session.streamSid,
          media: {
            payload: Buffer.from(response.delta, "base64").toString("base64"),
          },
        };
        //console.log("Sending audio back to Twilio:", audioDelta);
        try {
          connection.send(JSON.stringify(audioDelta));
        } catch (e) {
          console.error("\u274c Failed to send audio to Twilio:", e);
        }
      }
    } catch (error) {
      console.error("Failed to process OpenAI message:", error);
    }
  });

  connection.on("close", async () => {
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
    await processTranscriptAndSend(session.transcript, sessionId);
    sessions.delete(sessionId);
  });

  openAiWs.on("close", () => {
    console.log("Disconnected from the OpenAI Realtime API");
  });

  openAiWs.on("error", (error) => {
    console.error("Error in the OpenAI WebSocket:", error);
  });
}

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server running on port ${PORT}`);
});

async function makeChatGPTCompletion(transcript) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-2024-08-06",
      messages: [
        { role: "system", content: "Extract scammer details from transcript." },
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
  });
  return await res.json();
}

async function sendToWebhook(payload) {
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function processTranscriptAndSend(transcript, sessionId) {
  try {
    const result = await makeChatGPTCompletion(transcript);
    const parsedContent = JSON.parse(result.choices[0].message.content);
    const session = sessions.get(sessionId);
    const payload = {
      ...parsedContent,
      persona: session?.personaKey || "unknown",
      voice: session?.voice || "unknown",
      userId: session?.userId || "unknown",
      phoneNumber: session?.phoneNumber || "unknown",
      callStart: session?.callStart || "unknown",
      callEnd: new Date().toISOString(),
    };
    console.log("Sending payload to webhook:", payload);
    await sendToWebhook(payload);
  } catch (err) {
    console.error("Error processing transcript:", err);
  }
} 