import { proxyApi } from '../../cloudflare/api-proxy.mjs';
export const onRequest=({request,env})=>proxyApi(request,env);
