import dotenv from 'dotenv';
import got from 'got';

dotenv.config();

const {
    AFFILATE_ID,
} = process.env;

const PREFIX_URL = 'https://www.coupang.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.17; rv:84.0) Gecko/20100101 Firefox/84.0';

const getRedirectAppUrl = ({
    checkoutId, vendorItemId, quantity,
}) => {
    let url = 'https://sjang1.github.io/openApp/coupang/direct-checkout/?' +
      `CID=${checkoutId}` +
      `&VID=${vendorItemId}` +
      `&Q=${quantity}`;

    if (AFFILATE_ID) {
      url += `&R=${AFFILATE_ID}`;
    }

    return url;
};

export default {
    getRedirectAppUrl,
    parseURLfromText: (text) => {
        // if share url, extract ids from URL
        // https://link.coupang.com/re/CSHARESDP?lptag=<lptag>&pageKey=<productId>&itemId=<itemId>&vendorItemId=<vendorItemId>
        const ids = {};
        const coupangURLMatches = text.match(/link\.coupang\.com|m\.coupang\.com\/vm\/|www\.coupang\.com\/vp\//);
        const productIdMatches = text.match(/(pageKey\=|products\/)(?<productId>[0-9]+)/);
        const vendorItemIdMatches = text.match(/vendorItemId\=(?<vendorItemId>[0-9]+)/);

        try {
          if (coupangURLMatches) {
            ids.productId = productIdMatches.groups.productId;
            if (vendorItemIdMatches) {
              ids.vendorItemId = vendorItemIdMatches.groups.vendorItemId;
            }
          }
        } catch (e) {
          console.error(e);
        }

        return ids;
    },
    getProductInfo: async ({
        productId, vendorItemId,
      }, cookieJar = undefined) => {
        console.info('- request');
        try {
          let url = `vp/products/${productId}`;
          if (vendorItemId) {
            url += `?vendorItemId=${vendorItemId}`;
          }
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
            // productId,
            itemId,
            // vendorItemId,
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
    },
    getCheckoutURL: async (options, cookieJar = undefined) => {
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
            var autodetectcheckouturl = getRedirectAppUrl({
              checkoutId: json.orderCheckoutUrl.checkoutId,
              vendorItemId,
              quantity,
            });
            console.log(autodetectcheckouturl);
            return autodetectcheckouturl;
          }

          return null;
        } catch (e) {
          console.error(e);
        }
        return null;
    },
};
