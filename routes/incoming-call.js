import { PERSONAS } from "../config/variables.js";
import dotenv from "dotenv";
dotenv.config();


 // Route for Twilio to handle incoming and outgoing calls
export function handleIncomingCall(fastify){
    fastify.all("/incoming-call", async (request, reply) => {
        console.log("Incoming call");

        const persona = request.query.persona || "genZ"; //fallback to genz
        const host = process.env.PUBLIC_HOST || request.headers.host;

        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                              <Response>
                                  <Connect>
                                      <Stream url="wss://aivoice-chatbox-185231488037.us-central1.run.app/media-stream?persona=${persona}" />
                                  </Connect>
                              </Response>`;
    
        reply.type("text/xml").send(twimlResponse);
    });
}