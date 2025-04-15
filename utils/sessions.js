import dotenv from "dotenv";
dotenv.config();

export const sessions = new Map();

export function getOrCreateSession(sessionId, persona = "genZ") {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      transcript: [],              // array of lines
      streamSid: null,
      persona,
      callStart: new Date(),
      callEnd: null,
      deletedAt: null
    });
  }
  return sessions.get(sessionId);
}

export function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

export function setCallEnd(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.callEnd = new Date();
}

export function formatTranscript(transcriptArray) {
  return transcriptArray
    .filter((line) => !line.includes("AI message not found"))
    .join("\n");
}

// Example usage when building JSON to send to webhook:
// const session = getOrCreateSession(sessionId);
// const formattedTranscript = formatTranscript(session.transcript);
