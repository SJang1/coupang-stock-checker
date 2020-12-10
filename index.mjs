import dotenv from 'dotenv';
import got from 'got';
import ToughCookie from 'tough-cookie';
import telegraf from 'telegraf';
import LocalSession from 'telegraf-session-local';
import { promisify } from 'util';

const { Telegraf } = telegraf;
//const { LocalSession } = TelegrafSessionLocal;
const { CookieJar } = ToughCookie;
dotenv.config();

const {
  TELEGRAM_BOT_TOKEN
} = process.env;
const PREFIX_URL = 'https://www.coupang.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.17; rv:84.0) Gecko/20100101 Firefox/84.0';

const getProductInfo = async (url, cookieJar) => {
  console.info('- request');
  const setCookie = promisify(cookieJar.setCookie.bind(cookieJar));
  try {
    const { body } = await got(url, {
      http2: true,
      timeout: 1000,
      prefixUrl: PREFIX_URL,
      headers: {
        'user-agent': USER_AGENT,
      },
      cookieJar,
    });

    // get sdp object
    const matches = body.match(/exports\.sdp = (?<sdp>.+);/);
    if (!matches) {
      console.error('SDP not found!');
      return {};
    }
    const json = matches.groups['sdp'];
    if (!json) {
      console.error('SDP not found!');
      console.debug(body);
      return {};
    }

    console.info('- got json');
    const sdp = JSON.parse(json);
    if (!sdp) {
      console.error('JSON parsing error!');
      return {};
    }
    const {
      itemName,
      soldOut,
      productId,
      itemId,
      vendorItemId,
      preOrderVo,
      buyableQuantity,
      apiUrlMap,
      inventory, // almostSoldOut = true일 때 남은 구매가능수량 숫자, false일때 null
      almostSoldOut
    } = sdp;
    const productInfo = {
      itemName,
      soldOut,
      productId,
      itemId,
      vendorItemId,
      isPreOrder: (preOrderVo !== null),
      buyableQuantity,
      apiUrlMap,
      inventory,
      almostSoldOut
    };
    return productInfo;
  } catch (e) {
    console.error(e);
  }
  return {};
}

const getCheckoutURL = async (options, cookieJar) => {
  const {
    productId,
    vendorItemId,
    isPreOrder,
  } = options;
  let {
    quantity
  } = options;

  if (!quantity) {
    quantity = 1;
  }

  try {
    console.info('- request');
    const response = await got.post(`vp/direct-order/${productId}/items`, {
      prefixUrl: PREFIX_URL,
      http2: true,
      timeout: 1000,
      headers: {
        'user-agent': USER_AGENT,
      },
      form: {
        'items[]': `${vendorItemId}:+${quantity}`,
        clickProductId: productId,
        landProductId: productId,
        preOrder: !!isPreOrder,
      },
      responseType: 'json',
      cookieJar,
    });

    const json = response.body;
    if (json.orderCheckoutUrl) {
      console.info('- got url');
      return json.orderCheckoutUrl.requestUrl;
    }

    return null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

(async () => {
  console.info('start');
  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
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

  bot.command(['/add', '/add@CoupangStockCheckBot'], async (ctx) => {
    console.info('got add command');
    // get url from chat text
    const text = ctx.message.text.replace(/\/add(@CoupangStockCheckBot)?/, '').toLowerCase();
    if (!text || text.length < 22) {
      console.info('- empty text');
      ctx.reply('Please enter the valid Coupang product URL.');
      return;
    }
    const matches = text.match(/https?:\/\/(www.)?coupang.com\/(vp\/products\/[^\s]+)/);
    if (!matches || matches.length < 1) {
      ctx.reply('Please enter valid URL');
      return;
    }
    const path = matches[2];
    console.log(`path: ${path}`);

    // prepare cookie jar if have one
    let cookieJar;
    if (ctx.session.cookieJar) {
      cookieJar = CookieJar.fromJSON(ctx.session.cookieJar);
    } else {
      cookieJar = new CookieJar();
    }

    // check product info
    const productInfo = await getProductInfo(path, cookieJar);
    if (productInfo.productId) {
      const {
        productId, itemId, vendorItemId, itemName,
      } = productInfo;
      if (productInfo.soldOut) {
        // check product already registered
        const isRegistered = ctx.session.notify.filter((item) => item.vendorItemId === vendorItemId).length > 0;
        // register if it is not registered yet
        if (!isRegistered) {
          console.info('- register new product to notify');
          // save product to notify list
          ctx.session.notify.push({
            productId, itemId, vendorItemId, itemName,
          });
          // TODO: send product info to global restock check list (with queue worker)
          ctx.reply('We will notify you when the product is restock.');
        } else {
          // already registered
          console.info('- already registered');
          ctx.reply('It already registered.');
        }
      } else {
        console.info('- in stock');
        // get checkout url
        const checkoutUrl = await getCheckoutURL({
          ...productInfo,
        }, cookieJar);
        ctx.replyWithMarkdown(`In Stock: (${productInfo.vendorItemId}) ${productInfo.itemName} - [Checkout](${checkoutUrl})`);
      }
    } else {
      console.info('- product not found');
      // product not found
      ctx.reply('Product not available or removed. Please check the URL is valid.');
    }
    // save cookies
    ctx.session.cookieJar = cookieJar.toJSON();
  });

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

  bot.command('!notify', (ctx) => {
    console.info('got notify command');
  });

  bot.on('text', (ctx) => {
    console.info('got text');
    // Using context shortcut
    ctx.reply(`Hello ${ctx.from.username}`)
  });

  // Handle message update
  bot.on('message', (ctx) => {
    return ctx.reply('Hello')
  });

  bot.launch();
})();
