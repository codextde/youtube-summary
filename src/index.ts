import { protos, TextToSpeechClient } from "@google-cloud/text-to-speech";
import { Input, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import YoutubeTranscript from "youtube-transcript";
import * as dotenv from "dotenv-safe";
import * as util from "util";
import * as fs from "fs";
import axios from "axios";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

dotenv.config();

const telegramBotKey = process.env.TELEGRAM_TOKEN;
let bot: any;
let languageMapping = [];
let ttsClient = new TextToSpeechClient();
const speechConfig = sdk.SpeechConfig.fromSubscription(
  process.env.SPEECH_KEY,
  process.env.SPEECH_REGION
);
const audioConfig = sdk.AudioConfig.fromAudioFileOutput("output.wav");

// The language of the voice that speaks.
speechConfig.speechSynthesisVoiceName = "de-DE-ChristophNeural";

// Create the speech synthesizer.
var synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

initTelegram();

async function tts(query: string): Promise<string | void> {
  synthesizer.speakTextAsync(
    query,
    (result) => {
      if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
        console.log("synthesis finished.");
        return "output.wav";
      } else {
        console.error(
          "Speech synthesis canceled, " +
            result.errorDetails +
            "\nDid you set the speech resource key and region values?"
        );
      }
      synthesizer.close();
      synthesizer = null;
    },
    (err) => {
      console.trace("err - " + err);
      synthesizer.close();
      synthesizer = null;
    }
  );
}

async function initTelegram() {
  bot = new Telegraf(telegramBotKey, {
    handlerTimeout: 900_000,
  });
  bot.start((ctx) => ctx.reply("Schicke mir ein YouTube Video Link"));
  bot.help((ctx) => ctx.reply("Schicke mir ein YouTube Video Link"));

  bot.on(message("text"), (ctx) => {
    handleMessage(ctx);
  });
  bot.hears("hi", (ctx) => ctx.reply("Hello Hello"));
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
        const audioFile = (await tts(answer.response)) || "output.wav";
        await ctx.replyWithAudio(Input.fromLocalFile(audioFile));
        await fs.unlinkSync(audioFile);
        await ctx.reply("🐾 ChatGPT: done 😘");
      } else {
        await ctx.reply("🐾 ChatGPT: not running");
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

async function textToSpeech(text: string) {
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

async function askQuestion(prompt: string) {
  console.log("length", prompt.length);
  const response = await axios.post(`http://localhost:3000/sendMessage`, {
    text: prompt,
  });
  return response.data;
}
