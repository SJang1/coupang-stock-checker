import Coupang from './coupang.mjs';

const { parseURLfromText, getProductInfo, getCheckoutURL } = Coupang;

const getMessage = async ({
    productInfo, path, cookieJar,
  }) => {
    const {
        itemName, inventory, soldOut, almostSoldOut,
    } = productInfo;
    let message = '';
    if (soldOut) {
        message = `Out of stock: [${itemName}](${PREFIX_URL}/${path})`;
    } else {
        console.info('- in stock');
        // get checkout url
        const checkoutURL = await getCheckoutURL({
        ...productInfo,
        }, cookieJar);
        message = `**👍In stock: [${itemName}](${PREFIX_URL}/${path})**`;
        if (almostSoldOut === true) {
        message += ` ⌛️Almost sold out (${inventory} remains)⌛️`;
        }
        message += `\n${checkoutURL}`;
    }
    return message;
};

const performURLMatches = async (ctx) => {
    console.info('got url entity');
    const {
      update, updateType, updateSubType, match,
    } = ctx;
    console.debug({
      update, updateType, updateSubType, match,
    });
    const { input } = match;
    const ids = parseURLfromText(input);
    if (!ids.productId) {
        ctx.reply('Invalid URL');
        return;
    }
    const {
        vendorItemId, productId,
    } = ids;
    const cookieJar = new CookieJar();

    const productInfo = await getProductInfo({ productId, vendorItemId }, cookieJar);
    if (!productInfo || !productInfo.productId) {
        // product not found
        console.info('- product not found');
        ctx.reply('Product not available or removed. Please check the URL is valid.');
        return;
    }
    if (productInfo.invalid) {
        // product no longer available
        console.info('- product no longer available');
        ctx.reply('Product no longer available.');
        return;
    }
    const message = await getMessage({
        productInfo, inventory,
    });
    ctx.replyWithMarkdown(message);
  };

export default {
    performURLMatches,
}
