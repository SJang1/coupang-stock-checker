import ToughCookie from 'tough-cookie';
import Coupang from './coupang.mjs';

const { CookieJar } = ToughCookie;
const { parseURLfromText, getProductInfo } = Coupang;

const addCommand = async (ctx) => {
    console.info('got add command');
    // get url from chat text
    const text = ctx.message.text.replace(/\/add\s?/, '');
    if (!text || text.length < 22) {
      console.info('- empty text');
      ctx.reply('Please enter the valid Coupang product URL.');
      return;
    }

    const ids = parseURLfromText(text);
    if (!ids || !ids.productId) {
      console.error('- product id not found from URL');
      ctx.reply('Invalid URL');
      return;
    }

    // prepare cookie jar if have one
    let cookieJar;
    if (ctx.session.cookieJar) {
      cookieJar = CookieJar.fromJSON(ctx.session.cookieJar);
    } else {
      cookieJar = new CookieJar();
    }

    // check product info
    const {
      productId, vendorItemId,
    } = ids;
    const productInfo = await getProductInfo({ productId, vendorItemId }, cookieJar);
    if (!productInfo || !productInfo.productId) {
      // product not found
      console.info('- product not found');
      ctx.reply('Product not available or removed. Please check the URL is valid.');
      return;
    } else if (productInfo.invalid) {
      // product no longer available
      console.info('- product no longer available');
      ctx.reply('Product no longer available.');
      return;
    }
    const {
      itemId, itemName, soldOut, inventory,
    } = productInfo;
    if (soldOut) {
      // check product already registered
      const isRegistered = ctx.session.notify.filter((item) => item.vendorItemId === vendorItemId).length > 0;
      // register if it is not registered yet
      if (!isRegistered) {
        console.info('- register new product to notify');
        // save product to notify list
        ctx.session.notify.push({
          productId, itemId, vendorItemId, itemName, chatId: ctx.chat.id,
        });
      } else {
        // already registered
        console.info('- already registered');
      }
    }
    const message = await getMessage({
      productInfo, inventory, cookieJar,
    });
    ctx.replyWithMarkdown(message);
    // save cookies
    ctx.session.cookieJar = cookieJar.toJSON();
};

const delCommand = async (ctx) => {
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
  };

export default {
    addCommand, delCommand,
}
