# simple-koa-shopify-auth

https://www.npmjs.com/package/simple-koa-shopify-auth

#### NOTE: This package is not maintained by or affiliated with Shopify.

## Description:

A better, simplified version of the (no longer supported) [@Shopify/koa-shopify-auth](https://github.com/Shopify/koa-shopify-auth) middleware library. It removes the use of cookies for sessions (which greatly smooths the auth process by requiring fewer redirects in some cases), replaces a deprecated API call, and supports v5 of the official [@shopify/shopify-api](https://github.com/Shopify/shopify-node-api) package.

## Installation:

```
npm i simple-koa-shopify-auth
```

## Requirements:

**This package assumes you have `@shopify/shopify-api` v5 already installed. If you are on a lower version you will need to upgrade to the latest version with `npm i @shopify/shopify-api@latest`.**

#### WARNING:

**Please [check the changelog](https://github.com/Shopify/shopify-api-node/blob/v5.0.1/CHANGELOG.md) to see all the changes, and update your code accordingly.**

## Usage:

The usage is very similar to [@Shopify/koa-shopify-auth](https://github.com/Shopify/koa-shopify-auth#readme) (which you should check for more examples), **but there are a few differences, so it isn't a drop-in replacement.**

### Import the middleware functions (ES6 syntax):

```js
import { createShopifyAuth, verifyRequest } from "simple-koa-shopify-auth";
```

_Importing differs slightly from the official library in that the `createShopifyAuth` function is not a default import here, and has been renamed._

### Using verifyRequest for verifying session token on routes:

#### NOTE:

**If the session is invalid it will return a `401 Unauthorized` status code, that you can handle on the client side. _This is a breaking change from the official library, which returns `403 Forbidden`._**

For requests, create the middleware like this:

```js
// For requests from the frontend, we want to return headers, so we can check if we need to reauth on the client side
const verifyApiRequest = verifyRequest({ returnHeader: true });
const verifyPageRequest = verifyRequest();
```

The `verifyRequest` middleware function only accepts the following parameters (default values shown):

_NOTE: These parameters differ from the ones in the official library._

```js
{
  accessMode: "online",  // The access mode of the token to check
  authRoute: "/auth",  // Where to redirect if the session is invalid
  returnHeader: false,  // If true, set headers instead of redirecting if session is invalid
}
```

#### For more help on how to use the middleware functions, [check the examples](https://github.com/Shopify/koa-shopify-auth#example-app) from the official library.

### Registering middleware for handling auth routes:

The `createShopifyAuth` middleware function only accepts the following parameters (default values shown):

_NOTE: These parameters differ from the ones in the official library._

```js
{
  accessMode: "online",  // What kind of token we want to fetch
  authPath: "/auth",  // The path to handle the request on
  async afterAuth(ctx) { }  // Callback function after auth is completed (the token is available at ctx.state.shopify)
}
```

This is a simple example that you can use to help understand how to implement it.

```js
const server = new Koa();

// Installation route (get offline, permanent access token)
server.use(
  createShopifyAuth({
    accessMode: "offline",
    authPath: "/install/auth",
    async afterAuth(ctx) {
      const { shop, accessToken } = ctx.state.shopify;
      if (!accessToken) {
        // This can happen if the browser interferes with the auth flow
        ctx.response.status = 500;
        ctx.response.body = "Failed to get access token! Please try again.";
        return;
      }
      // Redirect to user auth endpoint, to get user's online token
      ctx.redirect(`/auth?shop=${shop}`);
    },
  })
);

// User auth route (get online session token)
server.use(
  createShopifyAuth({
    accessMode: "online",
    authPath: "/auth",
    async afterAuth(ctx) {
      const { shop } = ctx.state.shopify;
      // Check if the app is installed
      // NOTE: You can replace with your own function to check if the shop is installed, or you can just remove it, but this is an extra check that can help prevent auth issues
      if (isShopActive(shop)) {
        // Redirect to app
        ctx.redirect(`/?shop=${shop}`);
      } else {
        // Redirect to installation endpoint to get permanent access token
        ctx.redirect(`/install/auth/?shop=${shop}`);
      }
    },
  })
);
```
