import textToSpeech, { protos } from '@google-cloud/text-to-speech';
import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv-safe';
import * as fs from 'fs';
import { Input, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { dynamicImport } from 'tsimportlib';
import * as util from 'util';
import YoutubeTranscript from 'youtube-transcript';

dotenv.config();

@Injectable()
export class AppService {
  telegramBotKey = process.env.TELEGRAM_TOKEN;
  api: any;
  bot: any;

  languageMapping = [];
  ttsClient = new textToSpeech.TextToSpeechClient();

  constructor() {}

  async listVoices() {
    const [result] = await this.ttsClient.listVoices({ languageCode: 'de-DE' });
    console.log('result', result);
  }

  async textToSpeech(text: string) {
    const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest =
      {
        input: { text: text },
        voice: {
          languageCode: 'de-DE',
          ssmlGender: 'MALE',
          name: 'de-DE-Neural2-D',
        },
        audioConfig: { audioEncoding: 'MP3', pitch: 1.2, speakingRate: 1.3 },
      };

    const [response] = await this.ttsClient.synthesizeSpeech(request);
    const writeFile = util.promisify(fs.writeFile);
    await writeFile('output.mp3', response.audioContent, 'binary');
    return 'output.mp3';
  }

  async initChatGPT() {
    const chatgpt = (await dynamicImport(
      'chatgpt',
      module,
    )) as typeof import('chatgpt');
    //const openAIAuth = await chatgpt.getOpenAIAuth(this.config);
    //this.api = new chatgpt.ChatGPTAPI({ ...openAIAuth })
    this.api = new chatgpt.ChatGPTAPIBrowser(this.config);
    await this.api.initSession();
    this.initTelegram();
  }

  async initTelegram() {
    const bot = new Telegraf(this.telegramBotKey, {
      handlerTimeout: 900_000,
    });
    bot.start((ctx) => ctx.reply('Schicke mir ein YouTube Video Link'));
    bot.help((ctx) => ctx.reply('Schicke mir ein YouTube Video Link'));

    bot.on(message('text'), (ctx) => {
      this.handleMessage(ctx);
    });
    bot.hears('hi', (ctx) => ctx.reply('Hello Hello'));
    bot.launch();

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }

  async handleMessage(ctx) {
    console.log('new message from: ', ctx.message.from.username);
    const message = ctx.message.text;
    const found = this.languageMapping.find(
      (x) => x.id === ctx.message.chat.id,
    );
    if (message.startsWith('/german')) {
      if (found) {
        found.language = 'de';
      } else {
        this.languageMapping.push({
          id: ctx.message.chat.id,
          language: 'de',
        });
      }
      await ctx.reply('🐾 Sprache nun auf Deutsch ');
      return;
    }
    if (message.startsWith('/english')) {
      if (found) {
        found.language = 'en';
      } else {
        this.languageMapping.push({
          id: ctx.message.chat.id,
          language: 'en',
        });
      }
      await ctx.reply('🐾 Language now English');
      return;
    }
    const regExp =
      /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = message.match(regExp);
    try {
      if (match && match[2].length == 11) {
        const youtubeId = match[2];
        console.log('youtubeId', youtubeId);
        await ctx.reply('🐾 YouTube: Video gefunden');
        const transcriptItems = await YoutubeTranscript.fetchTranscript(
          youtubeId,
        );
        let fullText = ``;
        for (const item of transcriptItems) {
          fullText += `${item.text.replace(/\[Musik\]/g, '')} `;
        }
        await ctx.reply('🐾 YouTube: Video geladen');
        await ctx.reply('🐾 Video wird zusammengefasst');
        const prompt = `Schreibe eine Zusammenfassung in der Sprache ${
          found?.language || 'de' == 'de' ? 'Deutsch' : 'Englisch'
        } aus folgendem Videotranskript in ca. 600 Wörter:\n"${fullText}"`;
        const answer = await this.askQuestion(prompt);
        if (answer?.response) {
          await ctx.reply(answer.response);
          await ctx.reply('🐾 ChatGPT: audio wird erstellt');
          const audioFile = await this.textToSpeech(answer.response);
          await ctx.replyWithAudio(Input.fromLocalFile(audioFile));
          await fs.unlinkSync(audioFile);
          await ctx.reply('🐾 ChatGPT: done 😘');
        } else {
          await ctx.reply('🐾 ChatGPT: not running');
        }
      } else {
        await ctx.reply('🐾 YouTube: Kein Video gefunden');
      }
    } catch (error) {
      console.log('error', error);
      if (error.toString().includes('Transcript is disabled on this video')) {
        await ctx.reply(
          '🐾 ChatGPT: Die Transkription ist für dieses Video deaktiviert',
        );
      } else if (error.toString().includes('413')) {
        await ctx.reply('🐾 ChatGPT: Video zu lange');
      } else {
        await ctx.reply('🐾 Interner Fehler 🚨');
      }
    }
    console.log('done');
  }

  async askQuestion(prompt) {
    return (
      this.api?.sendMessage(prompt, {
        timeoutMs: 900000,
      }) || null
    );
  }
}
