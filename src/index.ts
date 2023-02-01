import axios from "axios";
import * as dotenv from "dotenv-safe";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { Input, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import YoutubeTranscript from "youtube-transcript";

dotenv.config();

let bot: Telegraf;
let languageMapping = [];

initTelegram();

async function initTelegram() {
  bot = new Telegraf(process.env.TELEGRAM_TOKEN, {
    handlerTimeout: 900_000,
  });
  bot.start((ctx) => ctx.reply("Send me a YouTube Video Link"));
  bot.help((ctx) => ctx.reply("Send me a YouTube Video Link"));

  bot.on(message("text"), async (ctx) => {
    // const audioFile = await microsoftTts("Test");
    // await ctx.replyWithAudio(Input.fromBuffer(audioFile));
    handleMessage(ctx);
  });
  bot.hears("hi", (ctx) => ctx.reply("Hi Ho"));
  bot.launch();

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

async function handleMessage(ctx) {
  console.log("new message from: ", ctx.message.from.username);
  const message = ctx.message.text;
  const found = languageMapping.find((x) => x.id === ctx.message.chat.id);
  if (message.startsWith("/german")) {
    if (found) {
      found.language = "de";
    } else {
      languageMapping.push({
        id: ctx.message.chat.id,
        language: "de",
      });
    }
    await ctx.reply("🐾 Sprache nun auf Deutsch ");
    return;
  }
  if (message.startsWith("/english")) {
    if (found) {
      found.language = "en";
    } else {
      languageMapping.push({
        id: ctx.message.chat.id,
        language: "en",
      });
    }
    await ctx.reply("🐾 Language now English");
    return;
  }
  const regExp =
    /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = message.match(regExp);
  try {
    if (match && match[2].length == 11) {
      const youtubeId = match[2];
      console.log("youtubeId", youtubeId);
      await ctx.reply("🐾 YouTube: Video gefunden");
      const transcriptItems = await YoutubeTranscript.fetchTranscript(
        youtubeId
      );
      let fullText = ``;
      for (const item of transcriptItems) {
        fullText += `${item.text.replace(/\[Musik\]/g, "")} `;
      }
      await ctx.reply("🐾 YouTube: Video geladen");
      await ctx.reply("🐾 Video wird zusammengefasst");
      const prompt = `Schreibe eine Zusammenfassung in der Sprache ${
        found?.language || "de" == "de" ? "Deutsch" : "Englisch"
      } aus folgendem Videotranskript in ca. 600 Wörter:\n"${fullText}"`;
      const answer = await askQuestion(prompt);
      if (answer?.response) {
        await ctx.reply(answer.response);
        await ctx.reply("🐾 ChatGPT: audio wird erstellt");
        const audioFile = await microsoftTts(answer.response);
        await ctx.replyWithVoice(Input.fromBuffer(audioFile));
        await ctx.reply("🐾 ChatGPT: done 😘");
      } else {
        await ctx.reply("🐾 ChatGPT: no response");
      }
    } else {
      await ctx.reply("🐾 YouTube: Kein Video gefunden");
    }
  } catch (error) {
    console.log("error", error);
    if (error.toString().includes("Transcript is disabled on this video")) {
      await ctx.reply(
        "🐾 ChatGPT: Die Transkription ist für dieses Video deaktiviert"
      );
    } else if (error.toString().includes("413")) {
      await ctx.reply("🐾 ChatGPT: Video zu lange");
    } else {
      await ctx.reply("🐾 Interner Fehler 🚨");
    }
  }
}

async function askQuestion(prompt: string) {
  console.log("length", prompt.length);
  const response: any = await axios.post(`http://localhost:3000/sendMessage`, {
    text: prompt,
  });
  return response.text;
}
async function microsoftTts(query: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.SPEECH_KEY,
      process.env.SPEECH_REGION
    );
    // const audioConfig = sdk.AudioConfig.fromAudioFileOutput("output.mp3");
    speechConfig.speechSynthesisVoiceName = "de-DE-ChristophNeural";
    // speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);
    let ssml = `<speak version='1.0' xml:lang='en-US' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts'><voice name='de-DE-ChristophNeural'>`;
    ssml += `<prosody rate="1.2">${query}</prosody>`;
    ssml += `</voice></speak>`;
    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          synthesizer.close();
          resolve(Buffer.from(result.audioData));
        } else {
          reject(result.errorDetails);
        }
      },
      (err) => {
        synthesizer.close();
        reject(err);
      }
    );
  });
}
// GOOGLE TTS
/*
async function textToSpeech(text: string) {
  let ttsClient = new TextToSpeechClient();
  const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest =
    {
      input: { text: text },
      voice: {
        languageCode: "de-DE",
        ssmlGender: "MALE",
        name: "de-DE-Neural2-D",
      },
      audioConfig: { audioEncoding: "MP3", pitch: 1.2, speakingRate: 1.3 },
    };

  const [response] = await ttsClient.synthesizeSpeech(request);
  const writeFile = util.promisify(fs.writeFile);
  await writeFile("output.mp3", response.audioContent, "binary");
  return "output.mp3";
}
*/
