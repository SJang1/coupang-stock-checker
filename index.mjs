import dotenv from 'dotenv';
import got from 'got';
import ToughCookie from 'tough-cookie';
import { promisify } from 'util';

const { CookieJar } = ToughCookie;
dotenv.config();

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
      productId,
      itemId,
      vendorItemId,
      preOrderVo,
      buyableQuantity,
      apiUrlMap
    } = sdp;
    return {
      productId,
      itemId,
      vendorItemId,
      isPreOrder: (preOrderVo !== null),
      buyableQuantity,
      apiUrlMap,
    };
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
  const cookieJar = new CookieJar();
  const productInfo = await getProductInfo('vp/products/1944935423?vendorItemId=71289084318', cookieJar);

  console.info('request checkout URL');
  const url = await getCheckoutURL({
    ...productInfo,
  }, cookieJar);
  console.log(`url: ${url}`);
})();
