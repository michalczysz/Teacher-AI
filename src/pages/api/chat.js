import { fstat } from "fs";

require("dotenv").config({
  path: "./.env",
});

const { Configuration, OpenAIApi } = require("openai");
const { SpeechConfig, AudioConfig, SpeechSynthesizer, ResultReason, SpeechSynthesisOutputFormat } = require("microsoft-cognitiveservices-speech-sdk");
const { BlobServiceClient } = require('@azure/storage-blob');

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  const sessionResponse = {
    transcription: null,
    chatResponse: null,
    audioResponse: null,
    messages: null,
  };

  sessionResponse.messages = req.body.messages;

  try {
    if (req.body.audio) {
      console.log("hey im here")
      const audio = req.body.audio;
      const base64 = audio.split(",")[1];
      const buf = Buffer.from(base64, "base64");
      buf.name = "sound.webm";

      const response = await openai.createTranscription(buf, `whisper-1`);
      sessionResponse.transcription = response.data.text;
      sessionResponse.messages.push({
        role: "user",
        content: sessionResponse.transcription,
      });
    }

    const data = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: sessionResponse.messages,
    });

    sessionResponse.messages.push({
      role: data.data.choices[data.data.choices.length - 1].message.role,
      content: data.data.choices[data.data.choices.length - 1].message.content,
    });
    sessionResponse.chatResponse = data.data.choices;

    let params = {
      Text: data.data.choices[data.data.choices.length - 1].message.content,
      OutputFormat: "mp3",
      VoiceId: req.body.voiceId || "Joanna",
      Engine: "neural",
    };

    // console.log(params);

    // Uncomment the following block if you want to use Polly for speech synthesis
    // const pollyResponse = await synthesizeSpeechWithPolly(params);
    // sessionResponse.audio = pollyResponse;
    // res.status(200).json(sessionResponse);

    const azureResponse = await synthesizeSpeechWithAzure(params.Text)
    sessionResponse.audio = azureResponse
    res.status(200).json(sessionResponse);

  } catch (err) {
    console.error("Error processing chat:", err);
    res.status(500).json({ error: err.message });
  }
}

// Function to synthesize speech using Polly
// async function synthesizeSpeechWithPolly(params) {
//   return new Promise((resolve, reject) => {
//     Polly.synthesizeSpeech(params, (err, data) => {
//       if (err) {
//         console.error("Error synthesizing speech:", err);
//         reject(err);
//       } else {
//         const audioBuffer = Buffer.from(data.AudioStream);
//         const audioDataURI = `data:${data.ContentType};base64,${audioBuffer.toString("base64")}`;
//         data.audioDataURI = audioDataURI;
//         resolve(data);
//       }
//     });
//   });
// }

// Function to synthesize speech using Azure Speech SDK
async function synthesizeSpeechWithAzure(text) {
  // console.log(text)
  const speechConfig = SpeechConfig.fromSubscription(process.env.AZURE_SUBSCRIPTION_KEY, process.env.AZURE_REGION);
  const uniqueBlobName = `${Date.now()}_speech.mp3`;
  const audioConfig = AudioConfig.fromAudioFileOutput(`public/${uniqueBlobName}`);

  // The language of the voice that speaks.
  speechConfig.speechSynthesisVoiceName = "pt-BR-AntonioNeural"; 
  speechConfig.speechSynthesisOutputFormat = SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3;

  const synthesizer = new SpeechSynthesizer(speechConfig, audioConfig);

  return new Promise((resolve, reject) => {
    synthesizer.speakTextAsync(
      text,
      (result) => {
        // Speech synthesis succeeded
        if (result.reason === ResultReason.SynthesizingAudioCompleted) {
          console.log("synthesis finished.");
        }
        //  = result.audioData;
        const audioBuffer = {"audioDataURI": uniqueBlobName}
        synthesizer.close();
        resolve(audioBuffer);
      },
      (error) => {
        // Speech synthesis failed
        console.error('Error synthesizing speech with Azure Speech SDK:', error);
        synthesizer.close();
        reject(error);
      }
    );
  });
}
