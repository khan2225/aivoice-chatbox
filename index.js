// ✅ Clean single-file working version for Cloud Run
// Includes only one persona (genZ) to keep it simple and verify Cloud Run compatibility

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
  console.error("❌ Missing required environment variables.");
  process.exit(1);
}

const SYSTEM_MESSAGE = `
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

const VOICE = "alloy";
const sessions = new Map();

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

fastify.get("/", async (_, reply) => {
  reply.send({ message: "✅ Twilio Media Stream Server is running" });
});

fastify.all("/incoming-call", async (request, reply) => {
  const host = process.env.DOMAIN || request.headers.host;
  const streamUrl = `wss://${host}/media-stream`;
  const twimlResponse = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Response>
  <Connect>
    <Stream url=\"${streamUrl.replace(/&/g, '&amp;')}\" />
  </Connect>
</Response>`;

  reply.type("text/xml").send(twimlResponse);
});

fastify.get("/media-stream", { websocket: true }, (connection, req) => {
  console.log("✅ /media-stream connection established");
  const sessionId = req.headers["x-twilio-call-sid"] || `session_${Date.now()}`;

  const session = {
    transcript: [],
    streamSid: null,
    callStart: new Date().toISOString(),
    callEnd: null
  };
  sessions.set(sessionId, session);

  const openAiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01", {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  openAiWs.on("open", () => {
    console.log("🔌 Connected to OpenAI Realtime API");
    const sessionUpdate = {
      type: "session.update",
      session: {
        turn_detection: { type: "server_vad" },
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: VOICE,
        instructions: SYSTEM_MESSAGE,
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
        const msg = res.transcript?.trim();
        if (msg) {
          session.transcript.push(`Scammer: ${msg}`);
          console.log("🎤 Scammer:", msg);
        }
      }

      if (res.type === "response.done") {
        const reply = res.response.output[0]?.content?.find(c => c.transcript)?.transcript || "(no transcript)";
        session.transcript.push(`AI: ${reply}`);
        console.log("🧠 AI:", reply);
      }

      if (res.type === "response.audio.delta" && res.delta) {
        const audioDelta = {
          event: "media",
          streamSid: session.streamSid,
          media: {
            payload: Buffer.from(res.delta, "base64").toString("base64")
          }
        };
        connection.socket.send(JSON.stringify(audioDelta));
      }
    } catch (err) {
      console.error("🚨 Error parsing OpenAI message:", err);
    }
  });

  connection.socket.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      if (data.event === "media") {
        openAiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: data.media.payload
        }));
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
    session.callEnd = new Date().toISOString();

    const payload = {
      sessionId,
      callStart: session.callStart,
      callEnd: session.callEnd,
      fullTranscript: session.transcript.join("\n"),
      user: "test-user"
    };
    await sendToWebhook(payload);
    sessions.delete(sessionId);
  });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) throw err;
  console.log(`🚀 Server is listening on port ${PORT}`);
});

async function sendToWebhook(payload) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  console.log("📤 Webhook status:", res.status);
}
