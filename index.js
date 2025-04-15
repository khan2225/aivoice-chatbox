import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import fetch from "node-fetch";

dotenv.config();

const PORT = process.env.PORT;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WEBHOOK_URL = "https://hook.us2.make.com/7erbor5aii151b4crb2geajhlnozbkvd";

if (!OPENAI_API_KEY || !PORT) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

// -------------------- Personas --------------------
const PERSONAS = {
  genZ: {
    systemMessage: `
      You are a curious Gen Z teen who just got a random phone call about a deal, refund, or virus.
      Wait until the user speaks before saying anything. Do NOT initiate conversation.
      When the user starts talking, act distracted but interested. Use Gen Z slang (“uhh”, “fr fr?”, “wait what?”, “sus”, etc.). Keep responses casual and short (1–2 sentences).
      Pretend to go along, but keep asking questions like:
      – What’s the deal?
      – Who are you?
      – What company?
      – How’s the payment?
      Never give real information or follow any instructions. Dodge or joke if they ask personal stuff.
    `,
    voice: "alloy"
  },
  texanDude: {
    systemMessage: `
      You're a friendly southern Texan dude who thinks this is a call about his cattle, truck, or weekend BBQ.
      You speak slowly with a strong southern twang. Use phrases like "Well shoot", "Y’all serious?", "Hold yer horses".
      Never reveal anything. Stay suspicious but polite. Keep ‘em talking.
    `,
    voice: "onyx"
  },
  shaggy: {
    systemMessage: `
      You're a chill, hungry, slightly paranoid stoner who thinks every call is someone trying to mess with you.
      You talk like a laid-back surfer guy, using words like "like", "whoa", and "zoinks".
      Never give out real info. Act confused, hungry, and slightly scared but friendly.
    `,
    voice: "fable"
  },
  jackSparrow: {
    systemMessage: `
      You're a slightly drunken, unpredictable pirate who's just stumbled upon a mysterious speaking box (the phone).
      You slur your words slightly, ramble, and are suspicious of everyone — always thinking someone’s after your treasure.
      Charm them, confuse them, and see how much you can get *them* to reveal.
    `,
    voice: "echo"
  }
};

// -------------------- Session Helpers --------------------
const sessions = new Map();

function getOrCreateSession(sessionId, persona = "genZ") {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      transcript: [],
      streamSid: null,
      persona,
      callStart: new Date(),
      callEnd: null,
      deletedAt: null
    });
  }
  return sessions.get(sessionId);
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

function setCallEnd(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.callEnd = new Date();
}

function formatTranscript(transcriptArray) {
  return transcriptArray.filter(line => !line.includes("AI message not found")).join("\n");
}

// -------------------- Fastify Setup --------------------
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

fastify.get("/", async (_, reply) => {
  reply.send({ message: "Twilio Media Stream Server is running!" });
});

fastify.all("/incoming-call", async (request, reply) => {
  const persona = request.query.persona || "genZ";
  const host = process.env.DOMAIN || request.headers.host;
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="wss://${host}/media-stream?persona=${persona}" />
      </Connect>
    </Response>`;

  reply.type("text/xml").send(twimlResponse);
});

fastify.register(async (fastify) => {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    const personaKey = req.query.persona || "genZ";
    const selectedPersona = PERSONAS[personaKey] || PERSONAS.genZ;
    console.log("🧠 Persona:", personaKey);

    const sessionId = req.headers["x-twilio-call-sid"] || `session_${Date.now()}`;
    const session = getOrCreateSession(sessionId, personaKey);

    const openAiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01", {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    openAiWs.on("open", () => {
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: selectedPersona.voice,
          instructions: selectedPersona.systemMessage.trim(),
          modalities: ["text", "audio"],
          temperature: 0.8,
          input_audio_transcription: { model: "whisper-1" }
        }
      };
      openAiWs.send(JSON.stringify(sessionUpdate));
    });

    openAiWs.on("message", (data) => {
      try {
        const res = JSON.parse(data);

        if (res.type === "conversation.item.input_audio_transcription.completed") {
          const scammerMessage = res.transcript?.trim();
          if (scammerMessage) {
            session.transcript.push(`Scammer: ${scammerMessage}\n`);
            console.log("🎤 Scammer:", scammerMessage);
          }
        }

        if (res.type === "response.done") {
          const aiReply = res.response.output[0]?.content?.find(c => c.transcript)?.transcript || "(no transcript)";
          session.transcript.push(`AI: ${aiReply}\n`);
          console.log("🧠 AI Reply:", aiReply);
        }

        if (res.type === "response.audio.delta" && res.delta) {
          connection.socket.send(JSON.stringify({
            event: "media",
            streamSid: session.streamSid,
            media: { payload: Buffer.from(res.delta, "base64").toString("base64") }
          }));
        }
      } catch (err) {
        console.error("❗ Error parsing OpenAI response:", err);
      }
    });

    connection.socket.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        if (data.event === "media") {
          openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload }));
        } else if (data.event === "start") {
          session.streamSid = data.start.streamSid;
          console.log("🔗 Twilio stream started:", session.streamSid);
        }
      } catch (err) {
        console.error("❗ Error parsing Twilio message:", err);
      }
    });

    connection.socket.on("close", async () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      setCallEnd(sessionId);
      const payload = {
        sessionId,
        persona: session.persona,
        callStart: session.callStart,
        callEnd: session.callEnd,
        fullTranscript: formatTranscript(session.transcript),
        user: "test-user"
      };
      await processTranscriptAndSend(payload);
      deleteSession(sessionId);
    });
  });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) throw err;
  console.log(`✅ Server is listening on port ${PORT}`);
});

// -------------------- Webhook & GPT Helpers --------------------
async function makeChatGPTCompletion(transcript) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-2024-08-06",
      messages: [
        { role: "system", content: "Extract scammer details..." },
        { role: "user", content: transcript }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            scammerName: { type: "string" },
            scammerDeal: { type: "string" },
            specialNotes: { type: "string" },
            fullTranscript: { type: "string" }
          },
          required: ["scammerName", "scammerDeal", "specialNotes", "fullTranscript"]
        }
      }
    })
  });
  return await response.json();
}

async function sendToWebhook(payload) {
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) console.error("Webhook failed:", response.statusText);
}

async function processTranscriptAndSend(payload) {
  try {
    const result = await makeChatGPTCompletion(payload.fullTranscript);
    const parsed = JSON.parse(result.choices[0].message.content);
    await sendToWebhook(parsed);
  } catch (err) {
    console.error("Transcript processing error:", err);
  }
}
