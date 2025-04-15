import WebSocket from "ws";
import { PERSONAS, LOG_EVENT_TYPES } from "../config/variables.js";
import { getOrCreateSession, deleteSession, setCallEnd, formatTranscript } from "../utils/sessions.js";
import { processTranscriptAndSend } from "../services/openai.js";
import dotenv from "dotenv";
dotenv.config();

export function registerMediaStream(fastify) {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    const personaKey = req.query.persona || "genZ"; // Default to genZ if no persona is specified
    const selectedPersona = PERSONAS[personaKey] || PERSONAS.genZ; // Fallback to genZ if the persona is not found
    console.log("🧠 Persona Key:", personaKey);
    console.log("🧠 Selected Persona:", selectedPersona);

    const sessionId = req.headers["x-twilio-call-sid"] || `session_${Date.now()}`;
    const model = req.query.model || "gpt-4o-realtime-preview-2024-10-01";
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY missing in environment");
      connection.socket.close();
      return; // Return if the API key is missing
    }

    if (!selectedPersona?.voice || !selectedPersona?.systemMessage) {
      console.error("❌ Missing voice or systemMessage for persona:", personaKey);
      connection.socket.close();
      return; // Return if persona data is missing
    }

    const session = getOrCreateSession(sessionId, personaKey);
    session.callStart = new Date().toISOString();
    session.persona = personaKey;
    console.log("📞 Session initialized:", { sessionId, personaKey });

    const openAiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, {
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
          instructions: selectedPersona.systemMessage.trim(),
          modalities: ["text", "audio"],
          temperature: 0.8,
          input_audio_transcription: { model: "whisper-1" },
        },
      };

      console.log("🚀 Sending session.update to OpenAI");
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    openAiWs.on("open", () => {
      console.log("✅ Connected to OpenAI Realtime API");
      setTimeout(sendSessionUpdate, 300); // Delay the first session update to ensure WebSocket connection is ready
    });

    openAiWs.on("message", (data) => {
      try {
        const response = JSON.parse(data);
        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log("📩 Event received:", response.type);
        }

        if (response.type === "conversation.item.input_audio_transcription.completed") {
          const scammerMessage = response.transcript?.trim();
          if (scammerMessage) {
            session.transcript.push(`Scammer: ${scammerMessage}\n`);
            console.log("🎤 Scammer:", scammerMessage);
          }
        }

        if (response.type === "response.done") {
          const aiReply = response.response.output[0]?.content?.find(c => c.transcript)?.transcript || "(no transcript)";
          session.transcript.push(`AI: ${aiReply}\n`);
          console.log("🧠 AI Reply:", aiReply);
        }

        if (response.type === "response.audio.delta" && response.delta) {
          connection.socket.send(JSON.stringify({
            event: "media",
            streamSid: session.streamSid,
            media: {
              payload: Buffer.from(response.delta, "base64").toString("base64"),
            },
          }));
        }
      } catch (err) {
        console.error("🚨 Error parsing OpenAI response:", err);
        console.log("📦 Raw Message:", data.toString());
      }
    });

    connection.socket.on("message", (message) => {
      try {
        const data = JSON.parse(message);

        if (data.event === "media") {
          if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({
              type: "input_audio_buffer.append",
              audio: data.media.payload,
            }));
          }
        } else if (data.event === "start") {
          session.streamSid = data.start.streamSid;
          console.log("🔗 Twilio stream started with StreamSid:", session.streamSid);
        } else {
          console.log("📨 Unknown Twilio event:", data.event);
        }
      } catch (err) {
        console.error("❗ Error parsing Twilio message:", err);
        console.log("📝 Raw Message:", message);
      }
    });

    connection.socket.on("close", async () => {
      if (openAiWs.readyState === WebSocket.OPEN || openAiWs.readyState === WebSocket.CONNECTING) {
        openAiWs.close();
      }

      console.log("❎ Disconnected from Twilio. Cleaning up session:", sessionId);
      setCallEnd(sessionId);

      const payload = {
        sessionId,
        persona: session.persona,
        callStart: session.callStart,
        callEnd: session.callEnd,
        fullTranscript: formatTranscript(session.transcript),
        user: session.user || "test-user",
      };

      await processTranscriptAndSend(payload);
      deleteSession(sessionId);
    });

    openAiWs.on("error", (err) => {
      console.error("🧨 WebSocket error from OpenAI:", err);
    });
  });
}
