import dotenv from 'dotenv';
import got from 'got';
import ToughCookie from 'tough-cookie';
import telegraf from 'telegraf';
import LocalSession from 'telegraf-session-local';
import { promisify } from 'util';

const { Telegraf } = telegraf;
const { CookieJar } = ToughCookie;
dotenv.config();

const {
  TELEGRAM_BOT_TOKEN
} = process.env;
const PREFIX_URL = 'https://www.coupang.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.17; rv:84.0) Gecko/20100101 Firefox/84.0';
const COUPANG_URL_REGEXPS = [
  /https:\/\/www\.coupang\.com\/vp\//,
  /https:\/\/m\.coupang\.com\/vm\//,
  /https:\/\/link\.coupang\.com\/re\/CSHARESDP/
];

const getProductInfo = async (url, cookieJar = undefined) => {
  console.info('- request');
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
      invalid, // 판매 중지 상품
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
      invalid,
      almostSoldOut
    };
    return productInfo;
  } catch (e) {
    console.error(e);
  }
  return {};
}

const getCheckoutURL = async (options, cookieJar = undefined) => {
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
    if (json.orderCheckoutUrl && json.orderCheckoutUrl.requestUrl) {
      console.info('- got url');
      return json.orderCheckoutUrl.requestUrl;
    }

    return null;
  } catch (e) {
    console.error(e);
  }
  return null;
}

const addCommand = async (ctx) => {
  console.info('got add command');
  // get url from chat text
  const text = ctx.message.text.replace(/\/add(@CoupangStockCheckBot)?/, '').toLowerCase();
  if (!text || text.length < 22) {
    console.info('- empty text');
    ctx.reply('Please enter the valid Coupang product URL.');
    return;
  }
  const matches = text.match(/https?:\/\/(www\.|m\.)?coupang.com\/(v[pm]\/products\/[^\s]+)/);
  if (!matches || matches.length < 1) {
    ctx.reply('Please enter valid URL');
    return;
  }
  const url = matches[0];
  const path = matches[2].replace('vm/', 'vp/'); // convert mobile web link to PC
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
  if (productInfo.invalid) {
    // product no longer available
    console.info('- product no longer available');
    ctx.reply('Product no longer available.');
    return;
  }
  if (!productInfo.productId) {
    // product not found
    console.info('- product not found');
    ctx.reply('Product not available or removed. Please check the URL is valid.');
    return;
  }
  const {
    productId, itemId, vendorItemId, itemName, soldOut,
  } = productInfo;
  if (soldOut) {
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
      ctx.replyWithMarkdown(`Out of stock: [${itemName}](${url})`);
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
    let message = `**👍In stock: [${itemName}](${url})**`;
    if (productInfo.almostSoldOut === true) {
      message += ` ⌛️Almost sold out (${productInfo.inventory} remains)⌛️`;
    }
    message += `[PC Checkout](${checkoutUrl}) [Mobile Checkout]()`;
    ctx.replyWithMarkdown(message);
  }
  // save cookies
  ctx.session.cookieJar = cookieJar.toJSON();
};

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

  bot.command('/del', async (ctx) => {
    // remove item from notify list
    const matches = ctx.message.text.match(/del\ (?<vendorItemId>[0-9]+)/);
    if (!matches.length || !matches.groups.vendorItemId) {
      ctx.reply('Invalid ID');
      return;
    }
    const vendorItemId = parseInt(matches.groups.vendorItemId);
    ctx.session.notify = ctx.session.notify.filter((item) => item.vendorItemId !== vendorItemId);
    // TODO: remove from queue list
    ctx.reply('Item removed');
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

  bot.url(COUPANG_URL_REGEXPS, async (ctx) => {
    console.info('got url entity');
    const {
      update, updateType, updateSubType, match,
    } = ctx;
    console.debug({
      update, updateType, updateSubType, match,
    });
    const { input } = match;
    let path = '';
    // if share url, extract ids from URL
    // https://link.coupang.com/re/CSHARESDP?lptag=<lptag>&pageKey=<productId>&itemId=<itemId>&vendorItemId=<vendorItemId>
    const shareMatches = input.match(/\/re\/C?SHARESDP(OO)?/);
    const mobileMatches = input.match(/m\.coupang\.com\/vm\//);
    if (shareMatches && shareMatches.length > 0) {
      // const lptag = input.match(/lptag\=(?<lptag>[A-Z]{3}[0-9]+)/).groups.lptag;
      const productId = input.match(/productId\=(?<productId>[0-9]+)/).groups.productId;
      // const itemId = input.match(/itemId\=(?<itemId>[0-9]+)/).groups.itemId;
      const vendorItemId = input.match(/vendorItemId\=(?<vendorItemId>[0-9]+)/).groups.vendorItemId;

      // assemble request URL
      path = `https://www.coupang.com/vp/products/${productId}/?vendorItemId=${vendorItemId}`;
    } else if (mobileMatches && mobileMatches.length > 0) {
      path = input.replace('m.coupang.com/vm/', 'www.coupang.com/vp/');
    } else {
      path = input;
    }

    console.debug({ path });
    const productInfo = await getProductInfo(path);
    if (!productInfo || productInfo.invalid) {
      ctx.reply('Invalid product or no longer available');
      return;
    }
  });

  bot.launch();
})();
