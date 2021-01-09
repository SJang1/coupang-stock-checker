import dotenv from 'dotenv';
import telegraf from 'telegraf';
import LocalSession from 'telegraf-session-local';
import EventEmitter from 'events';
import Coupang from './coupang.mjs';
import Util from './util.mjs';
import Bot from './bot.mjs';

const eventEmitter = new EventEmitter();
const { Telegraf } = telegraf;
dotenv.config();

const { addCommand, delCommand } = Bot;
const { performURLMatches } = Util;

const {
  TELEGRAM_BOT_TOKEN,
} = process.env;
const PREFIX_URL = 'https://www.coupang.com';
const COUPANG_URL_REGEXPS = [
  /https:\/\/www\.coupang\.com\/vp\//,
  /https:\/\/m\.coupang\.com\/vm\//,
  /https:\/\/link\.coupang\.com\/re\/CSHARESDP/
];

const notifyList = [
  /*
  {
    userId: [telegram user id],
    channelId: [telegram channel id],
    target: {
      productId: [coupang product id],
      vendorItemId: [coupang vendor item id]
    }
  }, ...
  */
];
const checkItemList = [];

const { parseURLfromText, getProductInfo, getCheckoutURL } = Coupang;

eventEmitter.on('add', (itemId, vendorItemId) => {
  // add item to check list
});

eventEmitter.on('notify', (receiver, message) => {
  // send message to receiver
});

eventEmitter.on('in_stock', (itemId, vendorItemId) => {
  // notify to user
});

(async () => {
  console.info('start');
  const bot = new Telegraf(TELEGRAM_BOT_TOKEN, {
    channelMode: true,
  });
  bot.use((new LocalSession({ database: 'user_session.json' })).middleware());
  bot.start((ctx) => {
    const { from } = ctx;
    // create empty notification list
    ctx.session.notify = [
      // {
      //   productId: 123,
      //   itemId: 123,
      //   vendorItemId: 123,
      //   itemName: '',
      // },
      // ...
    ];
  });

  bot.command(['/add'], addCommand);

  bot.command('/del', delCommand);

  bot.command('/list', (ctx) => {
    console.info('got list command');
    // show product list
    let text = '';
    ctx.session.notify.forEach((item) => {
      text += `${item.vendorItemId} - ${item.itemName}\n`;
    });
    if (text === '') {
      // notify list is empty
      text = 'List is empty';
    }
    ctx.reply(text);
  });

  bot.url(COUPANG_URL_REGEXPS, performURLMatches);

  bot.launch();

  setInterval(() => {
    // check availablity of product in check list
  }, 1000 * 300);
})();
